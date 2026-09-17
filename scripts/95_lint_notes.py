#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""95_lint_notes.py —— 「可发布文件」里的个人数据检查 / 一键脱敏

为什么要这个脚本（2026-09-18 踩坑）：
写站点 adapter 笔记（references/adapters/*.md）时把手机号、姓名、生日、籍贯、院校、
专业、简历文件名、本机路径直接写了进去 —— 这些文件是**会随 skill 仓库发布**的，
而 tests/selftest.py 的老守卫只扫「手机号/邮箱/本机路径」三种正则，抓不到
「看起来像正常文字」的姓名/生日/院校/籍贯。

现在的做法：**拿 data/profile.json + data/memory/dictionary.json 里的真实取值当黑名单**，
逐个去可发布文件里找（jaa_lib.sensitive_tokens / leak_scan）。想在某一行合法地写真实值
（例如站点公开的「省 → 市」选项表），在该行加标记 `jaa-leak-allow` 显式声明即可。

个人数据的正确去处：
  data/profile.json · data/memory/{dictionary.json,sites/*.json,runs.jsonl} ·
  data/applications/*.json · data/runs/*  —— 都在 .gitignore 里，不会发布。

用法：
  python scripts/95_lint_notes.py                     # 扫描并报告（有命中 → 退出码 2）
  python scripts/95_lint_notes.py --fix               # 自动把命中值换成占位符（跳过 jaa-leak-allow 行）
  python scripts/95_lint_notes.py --paths references/adapters/recruit.sinovatio.com.md
  python scripts/95_lint_notes.py --list-tokens       # 打印「哪些画像取值被当作敏感值」
  python scripts/95_lint_notes.py --json              # 机器可读
"""
import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import jaa_lib  # noqa: E402


def _rel(repo, path):
    try:
        return os.path.relpath(path, repo).replace("\\", "/")
    except Exception:
        return path


def _allow_line_count(repo, files):
    n = 0
    for p in files:
        fp = p if os.path.isabs(p) else os.path.join(repo, p)
        try:
            text = open(fp, encoding="utf-8").read()
        except Exception:
            continue
        n += sum(1 for line in text.splitlines() if jaa_lib.LEAK_ALLOW_MARK in line)
    return n


def _allow_marked_lines(repo, files, tokens):
    """哪些行是靠 jaa-leak-allow 豁免掉的（只看「本来会命中」的行，否则文档里提到这个标记也算，没意义）"""
    n, detail = 0, []
    for p in files:
        fp = p if os.path.isabs(p) else os.path.join(repo, p)
        try:
            text = open(fp, encoding="utf-8").read()
        except Exception:
            continue
        rel = _rel(repo, fp)
        for i, line in enumerate(text.splitlines(), 1):
            if jaa_lib.LEAK_ALLOW_MARK not in line:
                continue
            hit = [t["token"] for t in tokens if t["regex"].search(line)]
            if not hit:
                for kind, rx, _ph in jaa_lib.GENERIC_LEAK_RES:
                    m = rx.search(line)
                    if m and not any(s.search(m.group(0)) for s in jaa_lib.GENERIC_LEAK_SKIP):
                        hit.append(m.group(0))
                        break
            if hit:
                n += 1
                detail.append({"file": rel, "line": i, "token": hit[0][:40]})
    return n, detail


def _dedupe(hits):
    """同一行同一个值可能同时被「画像值」与「通用网则」抓到 → 去重"""
    seen, out = set(), []
    for h in hits:
        key = (h["file"], h["line"], h["token"])
        if key in seen:
            continue
        seen.add(key)
        out.append(h)
    return out


def main():
    ap = argparse.ArgumentParser(description="可发布文件里的个人数据检查 / 脱敏")
    ap.add_argument("--repo", default=jaa_lib.REPO_DIR, help="skill 仓库根目录（默认：本脚本的上级目录）")
    ap.add_argument("--paths", nargs="*", default=None, help="只检查这几个文件（相对仓库或绝对路径）")
    ap.add_argument("--data-dir", default=None, help="画像/记忆所在目录（默认 JAA_DATA_DIR 或 <repo>/data）")
    ap.add_argument("--fix", action="store_true", help="把命中的真实取值替换成占位符（不碰带 %s 的行）" % jaa_lib.LEAK_ALLOW_MARK)
    ap.add_argument("--list-tokens", action="store_true", help="只打印敏感词表（画像 + 问答记忆）")
    ap.add_argument("--json", dest="as_json", action="store_true", help="输出 JSON")
    args = ap.parse_args()

    repo = os.path.abspath(args.repo)
    profile_path = os.path.join(args.data_dir or jaa_lib.DATA_DIR, "profile.json")
    tokens = jaa_lib.sensitive_tokens(data_dir=args.data_dir)

    if args.list_tokens:
        if args.as_json:
            print(json.dumps([{k: t[k] for k in ("token", "kind", "placeholder")} for t in tokens],
                             ensure_ascii=False, indent=1))
        else:
            print("敏感词表：%d 条（来自 %s%s）" % (len(tokens), profile_path,
                                              "" if os.path.exists(profile_path) else "（**不存在**）"))
            for t in tokens:
                print("  %-10s %-34s → %s" % (t["kind"], t["token"][:34], t["placeholder"]))
        return 0

    files = args.paths or jaa_lib.publishable_files(repo)
    hits = jaa_lib.leak_scan(repo_root=repo, tokens=tokens, paths=args.paths)
    hits += jaa_lib.leak_scan_generic(repo_root=repo, paths=args.paths)
    hits = _dedupe(hits)
    allowed, allowed_detail = _allow_marked_lines(repo, files, tokens)

    fixed = []
    if args.fix and hits:
        by_file = {}
        for h in hits:
            by_file.setdefault(h["file"], []).append(h)
        for rel, hs in by_file.items():
            fp = os.path.join(repo, rel)
            try:
                text = open(fp, encoding="utf-8").read()
            except Exception:
                continue
            new, n, detail = jaa_lib.redact_text(text, tokens)
            if n:
                text = new
            gnew, gn, gdetail = jaa_lib.redact_generic(text)
            n += gn
            detail = detail + gdetail
            if n:
                open(fp, "w", encoding="utf-8").write(gnew)
                fixed.append({"file": rel, "replacements": n, "detail": detail})
        # 修完重扫（通用检查里的命中也一并处理）
        hits = _dedupe(jaa_lib.leak_scan(repo_root=repo, tokens=tokens, paths=args.paths)
                       + jaa_lib.leak_scan_generic(repo_root=repo, paths=args.paths))

    if args.as_json:
        print(json.dumps({"files_scanned": len(files), "allow_marked_lines": allowed,
                          "allow_marked": allowed_detail,
                          "hits": hits, "fixed": fixed,
                          "tokens": len(tokens), "profile_exists": os.path.exists(profile_path)},
                         ensure_ascii=False, indent=1))
    else:
        print("可发布文件：%d 个（已排除 .gitignore 命中的 data/、memory/、runs/ 等）" % len(files))
        if not os.path.exists(profile_path):
            print("⚠️ 未找到 %s：只能做通用检查（手机号/邮箱/本机路径）；" % profile_path)
            print("   要启用「按画像取值的检查」，请先准备 data/profile.json（见 assets/profile.template.json）。")
        else:
            print("敏感词表：%d 条（画像 + 问答记忆，含姓名/手机/生日/籍贯/院校/专业/单位/本机路径…）" % len(tokens))
        if allowed:
            print("已豁免 %d 行（带 %s 标记的「真实值」行：作者声明那是公开数据）" % (allowed, jaa_lib.LEAK_ALLOW_MARK))
            for d in allowed_detail[:8]:
                print("    %s:%s  %s" % (d["file"], d["line"], d["token"]))
        if fixed:
            print("\n已脱敏：")
            for f in fixed:
                toks = sorted({d["token"] for d in f["detail"]})
                print("  %-52s %d 处 → %s" % (f["file"], f["replacements"], "、".join(toks[:6])))
        if hits:
            print("\n[FAIL] 发现 %d 处个人数据（%d 个文件）：" % (len(hits), len({h["file"] for h in hits})))
            for h in sorted(hits, key=lambda x: (x["file"], x["line"])):
                print("  %s:%s  %-9s %-26s → %s" % (h["file"], h["line"], h["kind"],
                                                    h["token"][:26], h["placeholder"]))
                print("      %s" % h["text"][:150])
            print("\n处理方式（二选一）：")
            print("  1) 把真实取值换成占位符（推荐）：python scripts/95_lint_notes.py --fix")
            print("  2) 若该行确实是公开数据（站点选项表等），在该行加注释 %s" % jaa_lib.LEAK_ALLOW_MARK)
            print("  真实取值请只写在 data/ 下（profile.json / memory/ / applications/ / runs/，已被 .gitignore 排除）")
        else:
            print("\n[OK] 没有发现个人数据泄漏。")
    return 2 if hits else 0


if __name__ == "__main__":
    sys.exit(main())
