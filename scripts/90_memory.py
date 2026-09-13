#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""90_memory.py —— 持续沉淀“价值对”：站点记忆 + 问答记忆 + 运行日志

用法:
  # 查看某站点已学到的映射与配方
  python 90_memory.py lookup --host app.mokahr.com

  # 一次填充结束后回归：把 label→canonical、控件类型、选项文本记进站点记忆，并追加运行日志
  python 90_memory.py record --host app.mokahr.com \
      --scan data/runs/app.mokahr.com-scan.json \
      --mapping data/runs/app.mokahr.com-mapping.json \
      --fill-result '{"ok":[{"uid":"f13","label":"性别","value":"男"}],"failed":[{"uid":"f7","label":"出生日期","detail":"...阅读器未适配"}]}' \
      --notes "mokahr sd-Select：click label 打开，点文字完全匹配的叶子节点"

  # 记录一条「简历值 → 页面实际选项」的对照（下次同站直接命中，不再需要问）
  python 90_memory.py add-option --host app.mokahr.com \
      --label "意向工作城市" --value "北京" --option "北京市"

  # 把 probeOptions 探测到的选项目录并进站点记忆（下次编译 mapping 时就能做选项闸门）
  python 90_memory.py record-probe --host app.mokahr.com --scan data/runs/app.mokahr.com-scan.json \
      --probe data/runs/app.mokahr.com-probe.json

  # 记录一条问答型“价值对”（站点特有提问）
  python 90_memory.py add-qa --question "您使用微博的频率" --answer "高频：过去30天或自然月的活跃天数≥20天"

  # 给字典补别名（下次同义字段名可直接命中）
  python 90_memory.py add-alias --canonical personal.phone --alias "考生手机号"
"""
import argparse, json, os, sys, datetime

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from jaa_lib import (ensure_data_dir, RUNS_LOG, DICT_PATH, MEM_DIR, RUNS_DIR, load_json, save_json, site_memory_path,
                     match_canonical, norm)



def now():
    return datetime.datetime.now().isoformat(timespec="seconds")


def cmd_lookup(args):
    mem = load_json(site_memory_path(args.host), None)
    if not mem:
        print(f"（{args.host} 还没有记忆）")
        return 0
    print(f"# {args.host}  更新于 {mem.get('updated_at')}  运行次数 {mem.get('run_count', 0)}")
    print(f"最近 URL: {mem.get('last_url')}")
    print(f"\n字段记忆（{len(mem.get('fields', {}))} 条）：")
    for label, v in sorted((mem.get("fields") or {}).items()):
        bar = f"ok{v.get('ok', 0)}/fail{v.get('fail', 0)}"
        dest = v.get('canonical') or (("qa:" + str(v['qa'])) if v.get('qa') else '?')
        print(f"  - {label!r} → {dest}  [{v.get('kind')}] {bar}  {v.get('last_error') or ''}")
    if mem.get("notes"):
        print("\n配方/踩坑：")
        for n in mem["notes"]:
            print(f"  · {n}")
    return 0


def cmd_record(args):
    scan = load_json(args.scan, {}) or {}
    built = load_json(args.mapping, {}) if args.mapping else {}
    host = args.host or scan.get("host") or built.get("host") or "unknown"
    fill = json.loads(args.fill_result) if args.fill_result else {}
    mapping = built.get("mapping", {}) or {}
    meta = built.get("meta", {}) or {}
    by_uid = {f["uid"]: f for f in scan.get("fields", [])}

    ok_uids = {x.get("uid") for x in (fill.get("ok") or [])}
    skip_uids = {x.get("uid") for x in (fill.get("skipped") or [])}
    fail_uids = {x.get("uid") for x in (fill.get("failed") or [])}

    path = site_memory_path(host)
    mem = load_json(path, {}) or {}
    mem.setdefault("fields", {})
    for uid, val in mapping.items():
        f = by_uid.get(uid, {})
        label = f.get("label") or meta.get(uid, {}).get("label") or uid
        if not label:
            continue
        rec = mem["fields"].get(label, {})
        canonical = meta.get(uid, {}).get("canonical")
        if canonical and not str(canonical).startswith("qa:"):
            rec["canonical"] = canonical
        elif canonical and str(canonical).startswith("qa:"):
            rec["qa"] = str(canonical)[3:]
        rec["kind"] = f.get("kind") or rec.get("kind")
        if f.get("section"):
            rec["section"] = f.get("section")
        if f.get("block") is not None and int(f.get("block")) >= 0:
            rec["block"] = int(f.get("block"))
        if f.get("framework"):
            rec["framework"] = f.get("framework")
        if f.get("options"):
            rec["options_sample"] = f["options"][:12]
        if uid in ok_uids:
            rec["ok"] = rec.get("ok", 0) + 1
        elif uid in skip_uids:
            rec["ok"] = rec.get("ok", 0) + 1
        elif uid in fail_uids:
            rec["fail"] = rec.get("fail", 0) + 1
            why = next((x.get("detail") for x in (fill.get("failed") or []) if x.get("uid") == uid), "")
            rec["last_error"] = why
        rec["last_seen"] = now()[:10]
        mem["fields"][label] = rec
    mem["host"] = host
    mem["last_url"] = scan.get("url") or built.get("url")
    mem["updated_at"] = now()
    mem["run_count"] = mem.get("run_count", 0) + 1
    if args.notes:
        mem.setdefault("notes", [])
        if args.notes not in mem["notes"]:
            mem["notes"].append(args.notes)
    save_json(path, mem)

    os.makedirs(MEM_DIR, exist_ok=True)
    with open(RUNS_LOG, "a", encoding="utf-8") as f:
        f.write(json.dumps({
            "at": now(), "host": host, "url": scan.get("url"),
            "fields_filled": len(mapping),
            "ok": len(fill.get("ok") or []), "skipped": len(fill.get("skipped") or []),
            "failed": len(fill.get("failed") or []),
            "notes": args.notes or ""
        }, ensure_ascii=False) + "\n")
    print(f"站点记忆已更新 → {path}（字段 {len(mem['fields'])} 条）")
    print(f"运行日志已追加 → {RUNS_LOG}")
    return 0


def cmd_add_qa(args):
    d = load_json(DICT_PATH, {})
    d.setdefault("qa", {})
    d["qa"][args.question] = args.answer
    d["updated_at"] = now()[:10]
    save_json(DICT_PATH, d)
    print(f"问答记忆已记录：{args.question} → {args.answer}")
    return 0


def cmd_add_alias(args):
    d = load_json(DICT_PATH, {})
    c = d.setdefault("canonical", {}).setdefault(args.canonical, {"type": "text", "aliases": []})
    c.setdefault("aliases", [])
    if args.alias not in c["aliases"]:
        c["aliases"].append(args.alias)
    d["updated_at"] = now()[:10]
    save_json(DICT_PATH, d)
    print(f"别名已记录：{args.canonical} += {args.alias}")
    return 0


def cmd_add_option(args):
    """记录「简历值 → 页面实际选项」的对照。只写站点记忆（仓库外），下次同站自动命中。"""
    path = site_memory_path(args.host)
    mem = load_json(path, {}) or {}
    mem.setdefault("fields", {}).setdefault(args.label, {}).setdefault("option_map", {})
    mem["fields"][args.label]["option_map"][args.value] = args.option
    mem["host"] = args.host
    mem["updated_at"] = now()
    save_json(path, mem)
    print(f"选项对照已记录：{args.host} / {args.label} / {args.value!r} → {args.option!r}")
    return 0


def cmd_record_probe(args):
    """把 20_fill.js 在 probeOptions 模式下产出的 probed（uid → 选项数组）并进站点记忆。"""
    scan = load_json(args.scan, {}) or {}
    probed = load_json(args.probe, {}) or {}
    host = args.host or scan.get("host") or "unknown"
    by_uid = {f["uid"]: f for f in scan.get("fields", [])}
    path = site_memory_path(host)
    mem = load_json(path, {}) or {}
    mem.setdefault("fields", {})
    n = 0
    for uid, opts in (probed or {}).items():
        f = by_uid.get(uid)
        if not f or not opts:
            continue
        label = f.get("label") or uid
        rec = mem["fields"].setdefault(label, {})
        rec["options_sample"] = list(opts)[:40]
        rec["kind"] = f.get("kind") or rec.get("kind")
        rec["section"] = f.get("section") or rec.get("section")
        rec["last_seen"] = now()[:10]
        n += 1
    mem["host"] = host
    mem["last_url"] = scan.get("url")
    mem["updated_at"] = now()
    save_json(path, mem)
    print(f"选项目录已并入站点记忆：{n} 个字段 → {path}")
    return 0


def cmd_suggest(args):
    """给一批字段名，看字典能匹配到什么（用于人工确认映射）"""
    d = load_json(DICT_PATH, {})
    for label in args.labels:
        key, conf, alias = match_canonical(label, d)
        print(f"  {label!r} → {key}  ({conf}, via {alias!r})")
    return 0


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("lookup"); p.add_argument("--host", required=True); p.set_defaults(fn=cmd_lookup)
    p = sub.add_parser("record")
    p.add_argument("--host"); p.add_argument("--scan", required=True); p.add_argument("--mapping")
    p.add_argument("--fill-result"); p.add_argument("--notes"); p.set_defaults(fn=cmd_record)
    p = sub.add_parser("add-qa"); p.add_argument("--question", required=True); p.add_argument("--answer", required=True); p.set_defaults(fn=cmd_add_qa)
    p = sub.add_parser("add-alias"); p.add_argument("--canonical", required=True); p.add_argument("--alias", required=True); p.set_defaults(fn=cmd_add_alias)
    p = sub.add_parser("add-option"); p.add_argument("--host", required=True); p.add_argument("--label", required=True); p.add_argument("--value", required=True); p.add_argument("--option", required=True); p.set_defaults(fn=cmd_add_option)
    p = sub.add_parser("record-probe"); p.add_argument("--host"); p.add_argument("--scan", required=True); p.add_argument("--probe", required=True); p.set_defaults(fn=cmd_record_probe)
    p = sub.add_parser("suggest"); p.add_argument("labels", nargs="+"); p.set_defaults(fn=cmd_suggest)
    ensure_data_dir()
    a = ap.parse_args()
    return a.fn(a)


if __name__ == "__main__":
    sys.exit(main())
