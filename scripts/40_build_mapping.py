#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""40_build_mapping.py —— 把「扫描结果 + 字典 + 画像 + 站点记忆 + 问答记忆」编译成
   ① 20_fill.js 需要的 MAPPING（uid → 值）
   ② 必须去问用户的 TODO 清单（未映射 / 必填缺值 / 判定不确定），**不做猜测**

用法:
    python 40_build_mapping.py --scan data/runs/<host>-scan.json [--out ...] [--todo ...]
    # 用户回答后并进 mapping（可重复）：
    python 40_build_mapping.py --scan ... --answers '{"f15":"高频：≥20天"}'

退出码: 0 = 无阻塞项；2 = 存在必须问用户的阻塞项
"""
import argparse, json, os, re, sys, datetime

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from jaa_lib import (ensure_data_dir, DICT_PATH, PROFILE_PATH, RUNS_DIR, load_json, save_json, dig,
                     match_canonical, match_qa, norm, site_memory_path)

BLOCKING_KINDS = {"file"}
ARRAY_PREFIXES = ("education", "experience", "project")
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


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--scan", required=True)
    ap.add_argument("--out")
    ap.add_argument("--todo")
    ap.add_argument("--answers", default=None, help='JSON: {"uid或字段名": "值"}')
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

    resolved = []      # (field, value, canonical, source)
    notes, fragments = [], []
    arr_counter = {}

    for f in fields:
        uid, label, kind = f["uid"], f.get("label") or "", f.get("kind")
        required = bool(f.get("required"))
        reqconf = f.get("requiredConfidence") or "low"
        reqwhy = f.get("requiredWhy") or "未说明"

        if kind in BLOCKING_KINDS:
            resolved.append((f, None, "file", "file-field"))
            continue

        value, src, key = None, None, None

        # 1) 用户刚给的答案
        if uid in answers or label in answers:
            value, src, key = answers.get(uid, answers.get(label)), "user-answer", "manual"

        # 2) 站点记忆 → 3) 字典
        mem = site_fields.get(label) or {}
        if value is None:
            key = mem.get("canonical") or None
            conf = "high" if key else None
            if not key:
                key, conf, _alias = match_canonical(label, dictionary)

        # 4) 问答记忆
        if value is None and not key:
            qa_val, qconf, q = match_qa(label, dictionary)
            if qa_val is not None:
                value, src, key = qa_val, f"qa({qconf})", "qa:" + q

        # 分片跳过（除非站点记忆/用户明确指定）
        if value is None and not key and FRAGMENT_RE.match(norm(label)):
            fragments.append(label or uid)
            continue

        # 数组型 canonical：按出现顺序取画像数组元素（教育背景/实习经历多条目）
        if value is None and key and not str(key).startswith("qa:") and key.split(".")[0] in ARRAY_PREFIXES:
            arr, leaf = key.split(".", 1)
            idx = arr_counter.get(key, 0)
            arr_counter[key] = idx + 1
            value = dig(profile, f"{arr}.{idx}.{leaf}")
            key = f"{key}#{idx}"
            src = src or ("profile" if value is not None else None)

        if value is None and key and not str(key).startswith("qa:") and "#" not in str(key):
            value = dig(profile, key)
            src = src or ("profile" if value is not None else None)

        resolved.append((f, value, key, src))

    # 同一 canonical 出现多次（标量字段重复）→ 只保留“控件类型最匹配”的那个
    by_key = {}
    for i, (f, v, k, s) in enumerate(resolved):
        if not k or str(k).startswith("qa:") or "#" in str(k):
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
                notes.append(f"[重复 canonical 跳过] {resolved[i][0].get('label')}（{k}）→ 已用 {resolved[keep][0].get('label')}；复合控件分片请人工确认")

    mapping, meta, todo = {}, {}, []
    for i, (f, value, key, src) in enumerate(resolved):
        uid, label, kind = f["uid"], f.get("label") or "", f.get("kind")
        required, reqconf, reqwhy = bool(f.get("required")), f.get("requiredConfidence") or "low", f.get("requiredWhy") or "未说明"
        meta[uid] = {"uid": uid, "label": label, "kind": kind, "required": required,
                     "canonical": key, "source": src, "dropped": i in drop}

        if kind in BLOCKING_KINDS:
            if required:
                todo.append({"uid": uid, "label": label, "type": "file",
                             "question": f"「{label or uid}」是文件上传字段，需要附件路径（用 upload 工具挂）"})
            continue
        if i in drop:
            continue
        if value is None or value == "":
            if required:
                todo.append({"uid": uid, "label": label, "type": "missing-required",
                             "question": f"必填字段「{label or uid}」（{kind}）画像/记忆里没有值，请提供答案"})
            elif kind not in ("custom-select",) or label not in fragments:
                notes.append(f"[选填未填] {label or uid}（{kind}）")
            continue

        if kind in ("select", "custom-select", "radio-group") and f.get("options"):
            opts = [norm(o) for o in f["options"]]
            if opts and not any(norm(value) in o or o in norm(value) for o in opts):
                notes.append(f"[选项不匹配] {label}: 值「{value}」不在页面选项 {'/'.join(f['options'][:6])}… 中 → 需人工确认")
        if required and reqconf != "high":
            notes.append(f"[必填判定存疑/{reqconf}] {label or uid}: {reqwhy} → 请人工确认是否真的必填")
        mapping[uid] = value

    # 未映射且必填 → 必须问用户（去重）
    seen_todo = {(t["uid"]) for t in todo}
    for f in fields:
        uid = f["uid"]
        if uid in mapping or uid in seen_todo or f.get("kind") in BLOCKING_KINDS:
            continue
        if meta.get(uid, {}).get("canonical") is None and f.get("required"):
            todo.append({"uid": uid, "label": f.get("label") or "", "type": "unmapped-required",
                         "question": f"必填字段「{f.get('label') or uid}」（{f.get('kind')}）不在字典/记忆里，请给出答案，我会记进问答记忆"})

    result = {"host": host, "url": scan.get("url"),
              "at": datetime.datetime.now().isoformat(timespec="seconds"),
              "scan": a.scan, "mapping": mapping, "meta": meta,
              "todo_count": len(todo), "note_count": len(notes)}
    save_json(out_path, result)

    lines = [f"# 待确认清单 — {host}", "",
             f"- 扫描字段 {len(fields)} 个｜可直接填 {len(mapping)} 个｜阻塞 {len(todo)} 个｜提示 {len(notes)} 个", ""]
    if todo:
        lines += ["## 必须问用户（未猜）", ""] + [f"- [ ] `{t['uid']}` {t['question']}" for t in todo] + [""]
    if notes:
        lines += ["## 提示（建议核对）", ""] + [f"- {n}" for n in sorted(set(notes))] + [""]
    lines += ["## MAPPING（给 20_fill.js）", "", "```json", json.dumps(mapping, ensure_ascii=False, indent=2), "```", ""]
    os.makedirs(os.path.dirname(todo_path), exist_ok=True)
    open(todo_path, "w", encoding="utf-8").write("\n".join(lines))

    print(f"mapping → {out_path}  ({len(mapping)} 个字段)")
    print(f"todo    → {todo_path}  (阻塞 {len(todo)} / 提示 {len(set(notes))})")
    for t in todo:
        print(f"  ❓ {t['uid']} {t['label']}: {t['question']}")
    for n in sorted(set(notes)):
        print(f"  · {n}")
    return 2 if todo else 0


if __name__ == "__main__":
    sys.exit(main())
