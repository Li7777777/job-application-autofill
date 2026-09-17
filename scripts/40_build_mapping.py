#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""40_build_mapping.py —— 把「扫描结果 + 字典 + 画像 + 站点记忆 + 问答记忆」编译成
   ① 20_fill.js 需要的 MAPPING（uid → 值）
   ② 必须去问用户的 TODO 清单（未映射 / 必填缺值 / 选项对不上），**不做猜测**

本版新增（对照牛客插件的 level1/level2/group 三级定位）：
  · 字段名优先用 `labelNorm`（扫描器已去掉「（必填）/添加/编辑」等噪声）→ 命中率更高
  · **多段经历**按 (区块 section, 重复块 block) 定记录序号，不再靠“出现顺序”硬猜
  · **选项对不上**时只产出「建议值 + 备选」，绝不自动改写（守住铁律 2）
  · 支持把 20_fill.js 的 `OPTS.probeOptions=true` 探测结果并进来（--probe），
    这样自定义下拉也能在填之前就把真实选项拿到手

用法:
    python 40_build_mapping.py --scan data/runs/<host>-scan.json [--out ...] [--todo ...]
    # 用户回答后并进 mapping（可重复）：
    python 40_build_mapping.py --scan ... --answers '{"f15":"高频：≥20天"}'
    # 并入选项目录（先在页面上跑 probe）：
    python 40_build_mapping.py --scan ... --probe data/runs/<host>-probe.json

退出码: 0 = 无阻塞项；2 = 存在必须问用户的阻塞项
"""
import argparse, json, os, re, sys, datetime

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from jaa_lib import (ensure_data_dir, DICT_PATH, PROFILE_PATH, RUNS_DIR, load_json, save_json, dig,
                     match_canonical, match_qa, norm, norm_label, site_memory_path, best_option, rank_options,
                     is_placeholder, resolve_profile_value, satisfies_granularity, date_granularity,
                     coarser_sources)

BLOCKING_KINDS = {"file"}
ARRAY_PREFIXES = ("education", "experience", "project")
# 需要「值必须在选项里」的控件类型
OPTION_KINDS = {"select", "custom-select", "radio-group", "cascader", "tree-select", "popup-picker"}
# 需要做「时间粒度」闸门的控件类型（date-range 的两半各自判定，不在编译期卡）
DATE_KINDS = {"date", "date-picker"}
GRAN_RANK_PY = {"year": 1, "month": 2, "day": 3}
# 复合控件的“分片”（年/月/-至今/裸数字），不是独立字段
FRAGMENT_RE = re.compile(r"^(\d{2,6}|年|月|日|-|—|至|至今|-?\s*至今)$")
# canonical 声明类型 → 可以接受的控件类型（按可信度从高到低）
TYPE_AFFINITY = {
    "text": ("text", "textarea", "date", "select", "date-picker", "custom-select", "popup-picker"),
    "textarea": ("textarea", "text"),
    "choice": ("custom-select", "select", "radio-group", "text"),
    "date": ("date", "date-picker", "text", "custom-select"),
    "checkbox": ("checkbox",),
}


def safe_host(h):
    return re.sub(r"[^A-Za-z0-9._-]", "_", h or "unknown")


def label_of(f):
    """用于匹配与记忆的字段名：优先扫描器给的归一化名"""
    return f.get("labelNorm") or f.get("label") or ""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--scan", required=True)
    ap.add_argument("--out")
    ap.add_argument("--todo")
    ap.add_argument("--answers", default=None, help='JSON: {"uid或字段名": "值"}')
    ap.add_argument("--probe", default=None, help="20_fill.js 在 probeOptions 模式下产出的 probed JSON（uid → 选项数组）")
    ap.add_argument("--profile", default=PROFILE_PATH)
    a = ap.parse_args()

    ensure_data_dir()
    scan = load_json(a.scan, {}) or {}
    host = scan.get("host", "unknown")
    fields = scan.get("fields", [])
    out_path = a.out or os.path.join(RUNS_DIR, f"{safe_host(host)}-mapping.json")
    todo_path = a.todo or os.path.join(RUNS_DIR, f"{safe_host(host)}-todo.md")

    dictionary = load_json(DICT_PATH, {})
    profile = load_json(a.profile, {})
    canon_meta = dictionary.get("canonical") or {}
    site_mem = load_json(site_memory_path(host), {}) or {}
    site_fields = site_mem.get("fields", {}) or {}
    answers = json.loads(a.answers) if a.answers else {}
    probed = load_json(a.probe, {}) if a.probe else {}

    # 把探到的选项并进扫描结果（只在扫描器没给出选项时补）
    for f in fields:
        if not f.get("options") and probed.get(f.get("uid")):
            f["options"] = probed[f["uid"]]
            f["optionsSource"] = "probe"

    resolved = []      # (field, value, canonical, source, extra)
    notes, fragments = [], []
    arr_counter, rec_order, seq = {}, {}, {}
    blk_keys = set()   # 已经在「有 block」的字段里出现过的 canonical key（见 record_index）
    option_blocked = {}
    date_blocked = {}   # uid → {need, have}：页面要求的粒度比画像更细（必须问用户）
    date_gran = {}      # uid → 目标粒度（交给 20_fill.js 截断）

    def record_index(f, prefix, key):
        """多段经历的记录序号：(区块, 重复块) 优先；没有块信息才退回“同 canonical 出现顺序”。

        2026-09-14 修：**同一个 key 不允许混用 blk / seq 两种编号**。
        旧版里「教育背景」的字段有 block=0/1，而别的区块（学生干部经历/项目经验）的无 block 字段
        因为也命中了 education.start 之类 canonical，会被追加成第 3、第 4 条记录，
        于是 education.start#1/#2 指向不存在的记录（整段经历被填串/填空）。
        现在：该 key 已经在别处出现过 block≥0 时，block<0 的字段不再参与数组编号（返回 None → 交上层当未映射）。
        """
        blk = f.get("block")
        blk = -1 if blk is None else int(blk)
        if blk >= 0:
            blk_keys.add(key)
            ident = ("blk", norm_label(f.get("section") or ""), blk)
        else:
            if key in blk_keys:
                return None          # 混合场景：这个字段不属于那条数组记录
            n = seq.get(key, 0)
            seq[key] = n + 1
            ident = ("seq", key, n)
        lst = rec_order.setdefault(prefix, [])
        if ident not in lst:
            lst.append(ident)
        return lst.index(ident)

    # —— 预扫：让所有「有 block」的数组记录先占好序号 ——
    # 不这么做的话，同一个 canonical 的**无 block** 字段（如个人信息区的「毕业时间」也命中 education.end）
    # 会在扫到教育背景之前先占掉 #0，把真·第一段教育挤到 #1（实测 mokahr 上就是这么错的）。
    for f in fields:
        if f.get("block") is None or int(f.get("block")) < 0:
            continue
        lb = label_of(f)
        k = None
        if lb and lb in answers:
            continue
        mem_ = site_fields.get(f.get("label") or "") or site_fields.get(lb) or {}
        k = mem_.get("canonical") or (match_canonical(lb, dictionary)[0] if lb else None)
        if not k or str(k).startswith("qa:") or k.split(".")[0] not in ARRAY_PREFIXES:
            continue
        prefix = k.split(".")[0]
        blk_keys.add(k)
        ident = ("blk", norm_label(f.get("section") or ""), int(f.get("block")))
        lst = rec_order.setdefault(prefix, [])
        if ident not in lst:
            lst.append(ident)

    for f in fields:
        uid, kind = f["uid"], f.get("kind")
        label = f.get("label") or ""
        match_label = label_of(f)
        required = bool(f.get("required"))
        reqconf = f.get("requiredConfidence") or "low"
        reqwhy = f.get("requiredWhy") or "未说明"

        if kind in BLOCKING_KINDS:
            resolved.append((f, None, "file", "file-field", {}))
            continue

        value, src, key = None, None, None

        # 1) 用户刚给的答案（uid 优先，其次原始字段名 / 归一化字段名）
        if uid in answers or label in answers or match_label in answers:
            value = answers.get(uid, answers.get(label, answers.get(match_label)))
            src, key = "user-answer", "manual"

        # 2) 站点记忆 → 3) 字典（按归一化字段名匹配）
        mem = site_fields.get(label) or site_fields.get(match_label) or {}
        if value is None:
            key = mem.get("canonical") or None
            if not key:
                key, _conf, _alias = match_canonical(match_label, dictionary)

        # 4) 问答记忆（只要「画像里没取到值」就查）
        if value is None:
            qa_val, qconf, q = match_qa(match_label, dictionary)
            if qa_val is not None:
                value, src, key = qa_val, f"qa({qconf})", "qa:" + q

        # 分片跳过（除非站点记忆/用户明确指定）
        if value is None and not key and FRAGMENT_RE.match(norm_label(match_label) or norm(match_label)):
            fragments.append(label or uid)
            continue

        # 数组型 canonical：按 (区块, 块) 取画像数组元素（教育背景/实习经历多条目）
        if value is None and key and not str(key).startswith("qa:") and key.split(".")[0] in ARRAY_PREFIXES:
            arr, leaf = key.split(".", 1)
            leaf = leaf.split("#")[0]          # 站点记忆里存的可能是 education.school#1（已带序号）→ 先剥掉，避免 #1#1
            idx = record_index(f, arr, key)
            if idx is None:
                key = None                      # 混合编号场景 → 当未映射，进 todo 问用户
            else:
                value, vsrc = resolve_profile_value(profile, dictionary, f"{arr}.{idx}.{leaf}")
                key = f"{arr}.{leaf}#{idx}"
                if value is not None:
                    src = src or vsrc or "profile"

        if value is None and key and not str(key).startswith("qa:") and "#" not in str(key):
            value, vsrc = resolve_profile_value(profile, dictionary, key)
            if value is not None:
                src = src or vsrc or "profile"

        # 模板占位符（YYYY-MM、<姓名>、TODO…）一律当没值，否则会把占位符填进表单
        if is_placeholder(value):
            value = None

        # —— 时间粒度自适应 ——
        # 画像存最细的；页面要多粗就用多粗（填充时截断）。但页面要得更细（要年月日、画像只有年月）
        # 就无法满足 —— 那是**必须问用户**，绝不能拿 01 当日号去凑。
        if kind in DATE_KINDS:
            canon_key = str(key or "").split("#")[0]
            cm = canon_meta.get(canon_key) or {}
            want_gran = f.get("granularity") or cm.get("granularity")
            if want_gran:
                date_gran[uid] = want_gran
            if value not in (None, "") and want_gran and not satisfies_granularity(value, want_gran):
                # 画像值比页面要求更粗 → 不能凭空补精度
                date_blocked[uid] = {"need": want_gran, "have": date_granularity(value), "value": value}
                value, src = None, None
            elif value in (None, "") and want_gran and cm.get("type") == "date":
                # 细粒度字段画像里没值，但用户填了它的**粗粒度版本**（如 birth_ym）→ 提示可操作的信息
                for ck, cg in coarser_sources(dictionary, canon_key):
                    cv, _csrc = resolve_profile_value(profile, dictionary, ck)
                    if cv is None:
                        continue
                    if GRAN_RANK_PY.get(date_granularity(cv) or "", 0) < GRAN_RANK_PY.get(want_gran, 0):
                        date_blocked[uid] = {"need": want_gran, "have": date_granularity(cv), "value": cv, "from": ck}
                        value, src = None, None
                    break

        # —— 选项闸门（守住「不确定就问」）——
        opts = f.get("options") or []
        if value not in (None, "") and kind in OPTION_KINDS and opts:
            learned = ((mem.get("option_map") or {}).get(str(value)))
            if learned and learned in opts:
                value, src = learned, (src or "") + "+site-option"
            else:
                auto, best, alts = best_option(value, opts)
                if auto:
                    if best != value:
                        value, src = best, (src or "") + "+option-normalized"
                else:
                    option_blocked[uid] = {"suggestions": alts, "options": opts}
                    value = None
                    src = None

        resolved.append((f, value, key, src, {}))

    # 同一 canonical 出现多次（标量字段重复）→ 只保留“控件类型最匹配”的那个
    by_key = {}
    for i, (f, v, k, s, _x) in enumerate(resolved):
        # `manual`（--answers 进来的、站点特有的字段）不是同一个 canonical，
        # 不能按「重复 canonical」去重，否则一次回答多个站点特有字段时只会留下第一个。
        if not k or str(k).startswith("qa:") or str(k) == "manual" or "#" in str(k):
            continue
        by_key.setdefault(k, []).append(i)
    drop = set()
    for k, idxs in by_key.items():
        if len(idxs) < 2:
            continue
        want = (canon_meta.get(k) or {}).get("type", "text")
        order = TYPE_AFFINITY.get(want, ("text",))

        def rank(i):
            kind = resolved[i][0].get("kind")
            return order.index(kind) if kind in order else len(order)

        keep = sorted(idxs, key=rank)[0]
        for i in idxs:
            if i != keep:
                drop.add(i)
                fi = resolved[i][0]
                notes.append(f"[重复 canonical 跳过] {fi.get('label')}"
                             f"（{k}，区块={fi.get('section') or '-'} 块={fi.get('block')}）"
                             f" → 已用 {resolved[keep][0].get('label')}；复合控件分片请人工确认")

    mapping, meta, todo = {}, {}, []
    for i, (f, value, key, src, _x) in enumerate(resolved):
        uid, kind = f["uid"], f.get("kind")
        label = f.get("label") or ""
        required = bool(f.get("required"))
        reqconf = f.get("requiredConfidence") or "low"
        reqwhy = f.get("requiredWhy") or "未说明"
        blk = f.get("block")
        blk = -1 if blk is None else int(blk)
        meta[uid] = {"uid": uid, "label": label, "labelNorm": f.get("labelNorm") or "",
                     "kind": kind, "section": f.get("section") or "", "block": blk,
                     "framework": f.get("framework") or None,
                     "granularity": date_gran.get(uid),
                     "required": required, "canonical": key, "source": src, "dropped": i in drop}

        if kind in BLOCKING_KINDS:
            if required:
                todo.append({"uid": uid, "label": label, "type": "file", "section": f.get("section") or "",
                             "question": f"「{label or uid}」是文件上传字段，需要附件路径（用 upload 工具挂）"})
            continue

        # 页面要求的时间粒度比画像更细 → 必须问用户（不能拿 01 去凑日号）
        if uid in date_blocked:
            info = date_blocked[uid]
            need_cn = {"day": "年月日", "month": "年月"}.get(info["need"], info["need"])
            have_cn = {"year": "年", "month": "年月", "day": "年月日"}.get(info.get("have"), "空")
            todo.append({
                "uid": uid, "label": label, "type": "date-granularity", "section": f.get("section") or "",
                "block": blk, "kind": kind, "need": info["need"], "have": info.get("have"),
                "question": (f"「{label or uid}」页面上要求的是**{need_cn}**，但画像里只有{have_cn}"
                             f"（{info['value']!r}）。请提供更细的日期，否则这个字段填不了")
            })
            continue

        # 选项对不上 → 必须问用户（带建议值，但不自动采用）。放在 drop 之前，
        # 否则「被当成重复 canonical 丢掉」和「选项对不上」会叠在一起反而漏问。
        if uid in option_blocked:
            info = option_blocked[uid]
            sugg = " / ".join(f"{s['text']}（{s['why']}）" for s in info["suggestions"][:5])
            todo.append({
                "uid": uid, "label": label, "type": "option-choice", "section": f.get("section") or "",
                "block": blk, "kind": kind,
                "value": f.get("value") or "",
                "options": info["options"][:30],
                "suggestions": info["suggestions"],
                "question": (f"「{label or uid}」的值在页面选项里没有完全一致的："
                             + (f"简历值是「{f.get('value')}」，候选 → {sugg}" if f.get("value") else "画像/记忆没有值")
                             + "。请确认选用哪个选项（或告诉我该字段在页面上不存在）")
            })
            continue

        if i in drop:
            continue

        if value is None or value == "":
            if required:
                todo.append({"uid": uid, "label": label, "type": "missing-required", "section": f.get("section") or "",
                             "block": blk,
                             "question": f"必填字段「{label or uid}」（{kind}）画像/记忆里没有值，请提供答案"})
            elif kind not in ("custom-select",) or label not in fragments:
                notes.append(f"[选填未填] {label or uid}（{kind}）")
            continue

        if required and reqconf != "high":
            notes.append(f"[必填判定存疑/{reqconf}] {label or uid}: {reqwhy} → 请人工确认是否真的必填")
        # 日期字段：把「目标粒度」一并交给填充器（它按组件自适应截断）
        if uid in date_gran and kind in DATE_KINDS:
            mapping[uid] = {"v": value, "granularity": date_gran[uid]}
        else:
            mapping[uid] = value

    # 未映射且必填 → 必须问用户（去重）
    seen_todo = {t["uid"] for t in todo}
    # 让「时间粒度」也出现在 todo.md 的提示里（选填的日期字段不阻塞，但要说清会被怎么截断）
    for f in fields:
        g = date_gran.get(f["uid"])
        if g and f["uid"] in mapping and isinstance(mapping.get(f["uid"]), dict):
            got = date_granularity(mapping[f["uid"]].get("v"))
            if got and got != g:
                notes.append(f"[时间粒度自适应] {f.get('label') or f['uid']}: 画像给到「{got}」，页面要「{g}」→ 填充时自动截断，多余精度会丢弃")

    for f in fields:
        uid = f["uid"]
        if uid in mapping or uid in seen_todo or f.get("kind") in BLOCKING_KINDS:
            continue
        if meta.get(uid, {}).get("canonical") is None and f.get("required"):
            todo.append({"uid": uid, "label": f.get("label") or "", "type": "unmapped-required",
                         "section": f.get("section") or "", "block": -1 if f.get("block") in (None, -1) else int(f.get("block")),
                         "question": f"必填字段「{f.get('label') or uid}」（{f.get('kind')}）不在字典/记忆里，"
                                     f"请给出答案，我会记进问答记忆"})

    # 多段经历摘要（让人一眼看出识别到了几段）
    records = {}
    for f in fields:
        pref = None
        k = meta.get(f["uid"], {}).get("canonical") or ""
        for p in ARRAY_PREFIXES:
            if str(k).startswith(p + "."):
                pref = p
                break
        if pref:
            records.setdefault(pref, set()).add((f.get("section") or "", -1 if f.get("block") in (None, -1) else int(f.get("block"))))
    record_summary = {p: len(v) for p, v in records.items()}

    result = {"host": host, "url": scan.get("url"),
              "at": datetime.datetime.now().isoformat(timespec="seconds"),
              "platform": scan.get("platform"),
              "scan": a.scan, "probe": a.probe,
              "mapping": mapping, "meta": meta,
              "records": record_summary,
              "todo": todo,
              "todo_count": len(todo), "note_count": len(notes)}
    save_json(out_path, result)

    lines = [f"# 待确认清单 — {host}", "",
             f"- 扫描字段 {len(fields)} 个｜可直接填 {len(mapping)} 个｜阻塞 {len(todo)} 个｜提示 {len(notes)} 个"]
    if record_summary:
        lines.append(f"- 识别到的多段记录：{'、'.join(f'{k}×{v}' for k, v in record_summary.items())}")
    if scan.get("platform", {}).get("framework"):
        lines.append(f"- 组件框架：{scan['platform']['framework']}")
    lines.append("")
    if todo:
        lines += ["## 必须问用户（未猜）", ""]
        for t in todo:
            lines.append(f"- [ ] `{t['uid']}` {t['question']}")
            if t.get("suggestions"):
                lines.append(f"      - 建议（只是建议，不是已采用）：{' / '.join(s['text'] for s in t['suggestions'][:5])}")
            if t.get("options"):
                lines.append(f"      - 页面全部选项：{' / '.join(t['options'][:30])}")
        lines.append("")
    if notes:
        lines += ["## 提示（建议核对）", ""] + [f"- {n}" for n in sorted(set(notes))] + [""]
    lines += ["## MAPPING（给 20_fill.js）", "",
              "```json", json.dumps(mapping, ensure_ascii=False, indent=2), "```", ""]
    os.makedirs(os.path.dirname(todo_path), exist_ok=True)
    open(todo_path, "w", encoding="utf-8").write("\n".join(lines))

    print(f"mapping → {out_path}  ({len(mapping)} 个字段)")
    print(f"todo    → {todo_path}  (阻塞 {len(todo)} / 提示 {len(set(notes))})")
    for t in todo:
        print(f"  ❓ {t['uid']} {t['label']}: {t['question'][:120]}")
        for s in (t.get("suggestions") or [])[:3]:
            print(f"      建议: {s['text']} ({s['why']})")
    for n in sorted(set(notes)):
        print(f"  · {n}")
    return 2 if todo else 0


if __name__ == "__main__":
    sys.exit(main())
