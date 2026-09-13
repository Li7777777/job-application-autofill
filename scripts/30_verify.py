#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""30_verify.py —— 通用校验：页面状态 vs 画像/字典（站点无关）

用法:
    python 30_verify.py --state data/runs/<host>-state.json \
                        [--scan data/runs/<host>-scan.json] \
                        [--mapping data/runs/<host>-mapping.json] \
                        [--profile data/profile.json]

检查:
  A 格式合法性（手机/邮箱/证件/日期）
  B 与画像一致性（能映射到 canonical 的字段）
  C 完整性（必填是否都有值 / 报错提示 / 文件附件）
  D 选项闸门（下拉/单选的值是否真的在页面选项里；不在就报警 —— 不猜）
  E 未映射项（→ 必须去问用户，不许猜）
  报告按「区块 section / 重复块 block」分组，多段经历一眼可见
退出码: 0 = 无硬冲突；1 = 存在不一致
"""
import argparse, os, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from jaa_lib import (ensure_data_dir, DICT_PATH, PROFILE_PATH, load_json, dig, match_canonical,
                     fmt_check, same_value, rank_options, is_placeholder, resolve_profile_value,
                     date_granularity, GRAN_RANK)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--state", required=True)
    ap.add_argument("--scan", help="可选：带 options 的扫描结果 → 启用选项闸门（D）")
    ap.add_argument("--mapping")
    ap.add_argument("--profile", default=PROFILE_PATH)
    a = ap.parse_args()

    ensure_data_dir()
    state = load_json(a.state, {}) or {}
    profile = load_json(a.profile, {})
    dictionary = load_json(DICT_PATH, {})
    built = load_json(a.mapping, {}) if a.mapping else {}
    meta = (built or {}).get("meta", {}) or {}
    scan = load_json(a.scan, {}) if a.scan else {}
    scan_fields = {f["uid"]: f for f in scan.get("fields", [])}

    fields = state.get("fields", [])
    errs, gaps, unmapped, warnings, truncated = [], [], [], [], []

    def key_of(f):
        m = meta.get(f["uid"], {})
        if m.get("canonical"):
            return m["canonical"]
        k, c, al = match_canonical(f.get("labelNorm") or f.get("label"), dictionary)
        return k

    def where(f):
        sec = f.get("section") or meta.get(f["uid"], {}).get("section") or ""
        blk = f.get("block")
        blk = meta.get(f["uid"], {}).get("block") if blk is None else blk
        try:
            blk = int(blk)
        except Exception:
            blk = -1
        parts = []
        if sec:
            parts.append(f"区块:{sec}")
        if blk is not None and blk >= 0:
            parts.append(f"第{blk + 1}段")
        return ("[" + " ".join(parts) + "] ") if parts else ""

    print("=" * 78)
    print(f"站点 {state.get('host')} | {state.get('url')}")
    print(f"字段 {len(fields)} 个 | 快照时间 {state.get('at')}")
    fw = (scan.get("platform") or {}).get("framework") or (state.get("fields") or [{}])[0].get("framework")
    if fw:
        print(f"组件框架 {fw}")
    print("=" * 78)

    print("\nA. 格式合法性")
    for f in fields:
        v = str(f.get("value") or "")
        k = key_of(f)
        if not v:
            continue
        kind = None
        if k:
            kind = ((dictionary.get("canonical") or {}).get(k) or {}).get("format")
        if not kind and k:
            kind = {"phone": "phone", "email": "email", "id": "id"}.get(str(k).split(".")[-1])
        if kind:
            ok, msg = fmt_check(kind, v)
            print(f"  {'OK ' if ok else 'BAD'} {where(f)}[{f['uid']}] {f.get('label') or ''} = {v!r} ({msg})")
            if not ok:
                errs.append((f.get("label") or f["uid"], f"格式非法: {v}"))

    print("\nB. 与画像一致性")
    for f in fields:
        k = key_of(f)
        v = str(f.get("value") or "")
        if not k or not v:
            continue
        if str(k).startswith("qa:"):
            continue
        exp, esrc = resolve_profile_value(profile, dictionary, k)
        if is_placeholder(exp):
            print(f"  --  {where(f)}[{f['uid']}] {f.get('label')} → {k}: 画像无值（表单={v!r}）")
            continue
        if isinstance(exp, bool):
            exp = "是" if exp else "否"
        if same_value(v, exp):
            # 时间粒度自适应：表单比画像粗（1999-09 vs 1999-09-15）是**预期行为**，不是冲突
            gv, ge = date_granularity(v), date_granularity(exp)
            if gv and ge and GRAN_RANK.get(gv, 9) < GRAN_RANK.get(ge, 0):
                print(f"  OK  {where(f)}[{f['uid']}] {f.get('label')} → {k}: {v!r} == 画像 {str(exp)!r}（按组件粒度截断，丢了「{ge}」精度）")
                truncated.append((f.get('label') or f['uid'], f"按页面粒度截断：{exp} → {v}（来源 {esrc or 'profile'}）"))
            else:
                print(f"  OK  {where(f)}[{f['uid']}] {f.get('label')} → {k}: {v!r} == 画像 {str(exp)!r}")
        else:
            print(f"  ≠≠  {where(f)}[{f['uid']}] {f.get('label')} → {k}: 表单 {v!r} != 画像 {str(exp)!r}")
            errs.append((f.get("label") or f["uid"], f"表单={v} 与画像={exp} 不一致"))

    print("\nC. 完整性（必填 / 报错 / 附件）")
    for f in fields:
        req = bool(f.get("required"))
        v = str(f.get("value") or "")
        files = f.get("file") or []
        if f.get("kind") == "file":
            print(f"  {'OK ' if files else ('MISS' if req else 'skip')} {where(f)}[{f['uid']}] {f.get('label')} 附件={files}")
            if req and not files:
                gaps.append((f.get("label") or f["uid"], "必填附件未上传"))
            continue
        if req and not v:
            print(f"  MISS {where(f)}[{f['uid']}] {f.get('label')}（必填）= 空")
            gaps.append((f.get("label") or f["uid"], "必填项未填"))
        elif req:
            print(f"  OK  {where(f)}[{f['uid']}] {f.get('label')}（必填）= {v!r}")
        if f.get("error"):
            print(f"     ⚠ 页面提示: {f['error']}")
            errs.append((f.get("label") or f["uid"], f"页面报错 {f['error']}"))

    print("\nD. 选项闸门（下拉/单选的值必须在页面选项里）")
    checked = 0
    for f in fields:
        v = str(f.get("value") or "")
        if not v:
            continue
        sf = scan_fields.get(f["uid"]) or {}
        opts = sf.get("options") or []
        kind = f.get("kind") or sf.get("kind")
        if not opts or kind not in ("select", "custom-select", "radio-group", "cascader", "tree-select", "popup-picker"):
            continue
        checked += 1
        if any(str(o) == v for o in opts):
            print(f"  OK  {where(f)}[{f['uid']}] {f.get('label')} = {v!r}（在 {len(opts)} 个选项里精确命中）")
            continue
        ranked = rank_options(v, opts, limit=3)
        if ranked and ranked[0]["why"] == "normalized-equal":
            print(f"  ~   {where(f)}[{f['uid']}] {f.get('label')} = {v!r} → 归一化后等于「{ranked[0]['text']}」（组件实际显示为准）")
            warnings.append((f.get("label") or f["uid"], f"选项是归一化命中：{v} ≈ {ranked[0]['text']}"))
        else:
            hint = " / ".join(f"{r['text']}({r['why']})" for r in ranked) or "（无相近项）"
            print(f"  BAD {where(f)}[{f['uid']}] {f.get('label')} = {v!r} 不在页面选项里；候选 → {hint}")
            errs.append((f.get("label") or f["uid"], f"选项对不上：{v}；候选 {hint}"))
    if not checked:
        print(f"  （跳过：{'没给 --scan' if not scan else '扫描结果里没有选项信息'}；"
              f"自定义下拉请先跑 20_fill.js 的 OPTS.probeOptions=true）")

    print("\nE. 未映射字段（必须问用户，不许猜）")
    for f in fields:
        if key_of(f) is None and str(f.get("value") or "") == "":
            tag = "必填" if f.get("required") else "选填"
            print(f"  {'❗' if f.get('required') else '·'} {where(f)}[{f['uid']}] {f.get('label') or '(无标签)'} ({f.get('kind')}, {tag})")
            if f.get("required"):
                unmapped.append((f["uid"], f.get("label") or "(无标签)"))

    print("\n" + "=" * 78)
    print("F. 结论")
    print("=" * 78)
    print(f"  硬冲突 {len(errs)}")
    for a1, b1 in errs:
        print(f"    ! {a1}: {b1}")
    print(f"  待核对 {len(warnings)}")
    for a1, b1 in warnings:
        print(f"    ~ {a1}: {b1}")
    print(f"  时间粒度自适应（已按页面粒度截断，非冲突） {len(truncated)}")
    for a1, b1 in truncated:
        print(f"    ⤵ {a1}: {b1}")
    print(f"  缺口 {len(gaps)}")
    for a1, b1 in gaps:
        print(f"    - {a1} ({b1})")
    print(f"  未映射必填 {len(unmapped)}")
    for uid, lb in unmapped:
        print(f"    ? {uid} {lb}")
    print()
    if errs:
        print("  >>> 存在不一致 / 页面报错：必须人工逐项确认。")
    else:
        print("  >>> 已填部分无冲突。")
    return 1 if errs else 0


if __name__ == "__main__":
    sys.exit(main())
