#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""30_verify.py —— 通用校验：页面状态 vs 画像/字典（站点无关）

用法:
    python 30_verify.py --state data/runs/<host>-state.json \
                        [--mapping data/runs/<host>-mapping.json] \
                        [--profile data/profile.json]

检查:
  A 格式合法性（手机/邮箱/证件/日期）
  B 与画像一致性（能映射到 canonical 的字段）
  C 完整性（必填是否都有值 / 报错提示 / 文件附件）
  D 未映射项（→ 必须去问用户，不许猜）
退出码: 0 = 无硬冲突；1 = 存在不一致
"""
import argparse, os, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from jaa_lib import (ensure_data_dir, DICT_PATH, PROFILE_PATH, load_json, dig, match_canonical, match_qa,
                     norm, fmt_check, same_value, normalize_date)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--state", required=True)
    ap.add_argument("--mapping")
    ap.add_argument("--profile", default=PROFILE_PATH)
    a = ap.parse_args()

    ensure_data_dir()
    state = load_json(a.state, {}) or {}
    profile = load_json(a.profile, {})
    dictionary = load_json(DICT_PATH, {})
    built = load_json(a.mapping, {}) if a.mapping else {}
    meta = (built or {}).get("meta", {}) or {}

    fields = state.get("fields", [])
    errs, gaps, unmapped = [], [], []

    def key_of(f):
        m = meta.get(f["uid"], {})
        if m.get("canonical"):
            return m["canonical"]
        k, c, al = match_canonical(f.get("label"), dictionary)
        return k

    print("=" * 78)
    print(f"站点 {state.get('host')} | {state.get('url')}")
    print(f"字段 {len(fields)} 个 | 快照时间 {state.get('at')}")
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
            kind = {"phone": "phone", "email": "email", "id": "id"}.get(k.split(".")[-1])
        if kind:
            ok, msg = fmt_check(kind, v)
            print(f"  {'OK ' if ok else 'BAD'} [{f['uid']}] {f.get('label') or ''} = {v!r} ({msg})")
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
        exp = dig(profile, k)
        if exp is None:
            print(f"  --  [{f['uid']}] {f.get('label')} → {k}: 画像无值（表单={v!r}）")
            continue
        if isinstance(exp, bool):
            exp = "是" if exp else "否"
        if same_value(v, exp):
            print(f"  OK  [{f['uid']}] {f.get('label')} → {k}: {v!r} == 画像 {str(exp)!r}")
        else:
            print(f"  ≠≠  [{f['uid']}] {f.get('label')} → {k}: 表单 {v!r} != 画像 {str(exp)!r}")
            errs.append((f.get("label") or f["uid"], f"表单={v} 与画像={exp} 不一致"))

    print("\nC. 完整性（必填 / 报错 / 附件）")
    for f in fields:
        req = bool(f.get("required"))
        v = str(f.get("value") or "")
        files = f.get("file") or []
        if f.get("kind") == "file":
            print(f"  {'OK ' if files else ('MISS' if req else 'skip')} [{f['uid']}] {f.get('label')} 附件={files}")
            if req and not files:
                gaps.append((f.get("label") or f["uid"], "必填附件未上传"))
            continue
        if req and not v:
            print(f"  MISS [{f['uid']}] {f.get('label')}（必填）= 空")
            gaps.append((f.get("label") or f["uid"], "必填项未填"))
        elif req:
            print(f"  OK  [{f['uid']}] {f.get('label')}（必填）= {v!r}")
        if f.get("error"):
            print(f"     ⚠ 页面提示: {f['error']}")
            errs.append((f.get("label") or f["uid"], f"页面报错 {f['error']}"))

    print("\nD. 未映射字段（必须问用户，不许猜）")
    for f in fields:
        if key_of(f) is None and str(f.get("value") or "") == "":
            tag = "必填" if f.get("required") else "选填"
            print(f"  {'❗' if f.get('required') else '·'} [{f['uid']}] {f.get('label') or '(无标签)'} ({f.get('kind')}, {tag})")
            if f.get("required"):
                unmapped.append((f["uid"], f.get("label") or "(无标签)"))

    print("\n" + "=" * 78)
    print("E. 结论")
    print("=" * 78)
    print(f"  硬冲突 {len(errs)}")
    for a1, b1 in errs:
        print(f"    ! {a1}: {b1}")
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
