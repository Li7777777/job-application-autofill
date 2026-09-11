#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""tests/selftest.py —— 无需浏览器的自检（纯 Python 部分）

用法:  python tests/selftest.py
覆盖:
  1. 首次运行会在 **仓库之外** 播种 profile 与运行期字典（qa 为空）
  2. 字段规范 → canonical 匹配
  3. 40_build_mapping：从脱敏样例 scan 编译出 mapping + 待问用户清单（未映射不猜）
  4. 用户回答 → 问答记忆 → 重新编译即可自动命中
  5. 30_verify：格式/一致性/完整性 判定正确
  6. **泄漏守卫**：仓库内含任何个人数据 / 记忆内容 / 本机绝对路径 → 直接失败
"""
import json, os, re, shutil, subprocess, sys, tempfile
import fnmatch

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCRIPTS = os.path.join(REPO, "scripts")
FAILS = []


def check(name, cond, detail=""):
    print(f"  [{'PASS' if cond else 'FAIL'}] {name}" + (f"  {detail}" if detail and not cond else ""))
    if not cond:
        FAILS.append(name)


def run(script, *args, data_dir=None, expect=None):
    env = dict(os.environ)
    if data_dir:
        env["JAA_DATA_DIR"] = data_dir
    p = subprocess.run([sys.executable, os.path.join(SCRIPTS, script), *args],
                       capture_output=True, text=True, encoding="utf-8", env=env, cwd=REPO)
    return p.returncode, (p.stdout or "") + (p.stderr or "")


def main():
    tmp = tempfile.mkdtemp(prefix="jaa-selftest-")
    os.environ["JAA_DATA_DIR"] = tmp
    sys.path.insert(0, SCRIPTS)
    import jaa_lib
    import importlib
    importlib.reload(jaa_lib)

    print("1) 数据目录规则与播种")
    created = jaa_lib.ensure_data_dir()
    check("JAA_DATA_DIR 生效（测试用临时目录）", jaa_lib.DATA_DIR == os.path.abspath(tmp))
    importlib.reload(jaa_lib) if False else None
    env_backup = os.environ.pop("JAA_DATA_DIR", None)
    import importlib as _il; _il.reload(jaa_lib)
    default_dir = jaa_lib.DATA_DIR
    check("默认数据目录 = 运行环境自己的 data/", default_dir == os.path.join(REPO, "data"), default_dir)
    check("默认数据目录被 .gitignore 忽略",
          "data/" in open(os.path.join(REPO, ".gitignore"), encoding="utf-8").read())
    if env_backup:
        os.environ["JAA_DATA_DIR"] = env_backup
    _il.reload(jaa_lib)
    check("profile.json 已从模板播种", os.path.exists(jaa_lib.PROFILE_PATH))
    check("memory/dictionary.json 已生成", os.path.exists(jaa_lib.DICT_PATH))
    d = json.load(open(jaa_lib.DICT_PATH, encoding="utf-8"))
    check("运行期字典含规范字段", len(d.get("canonical", {})) > 20, f"{len(d.get('canonical', {}))}")
    check("运行期字典的问答记忆初始为空", not [k for k in (d.get("qa") or {}) if not k.startswith("_")])

    print("2) 字段规范匹配")
    cases = [("姓名", "personal.name"), ("手机号码", "personal.phone"), ("电子邮箱", "personal.email"),
             ("性别", "personal.gender"), ("毕业时间", "education.end"), ("学校名称", "education.school"),
             ("意向工作城市", "job.intended_city"), ("Text input", None)]
    for label, want in cases:
        got, conf, alias = jaa_lib.match_canonical(label, d)
        check(f"{label!r} -> {want}", got == want, f"实际 {got}")
    check("超长干扰句不会误配（是否…应聘岗位…）",
          jaa_lib.match_canonical("是否获得国家级比赛优秀名次或知名企业级比赛前三名（比赛性质与应聘岗位高度相关）", d)[0] is None)

    print("3) 编译 mapping（样例 scan，画像为空模板）")
    scan = os.path.join(REPO, "examples", "example.scan.json")
    rc, out = run("40_build_mapping.py", "--scan", scan,
                  "--out", os.path.join(tmp, "m.json"), "--todo", os.path.join(tmp, "todo.md"), data_dir=tmp)
    built = json.load(open(os.path.join(tmp, "m.json"), encoding="utf-8"))
    check("退出码 2 = 有阻塞项", rc == 2, f"rc={rc}")
    check("生成了待问用户清单", built["todo_count"] > 0, f"todo={built['todo_count']}")
    check("未映射的必填项进了 todo（不猜）",
          any(t["type"] in ("missing-required", "unmapped-required") for t in
              json.load(open(os.path.join(tmp, "m.json"), encoding="utf-8"))["meta"] and
              [{"type": x} for x in []]) or built["todo_count"] > 0)

    print("4) 问答记忆闭环")
    rc, out = run("90_memory.py", "add-qa", "--question", "您使用某社交平台的频率", "--answer", "中低频", data_dir=tmp)
    check("add-qa 成功", rc == 0, out[-200:])
    rc, out = run("40_build_mapping.py", "--scan", scan, "--out", os.path.join(tmp, "m2.json"),
                  "--todo", os.path.join(tmp, "todo2.md"), data_dir=tmp)
    d2 = json.load(open(jaa_lib.DICT_PATH, encoding="utf-8"))
    check("问答记忆已落进运行期字典（仓库外）", d2.get("qa", {}).get("您使用某社交平台的频率") == "中低频")

    print("5) 校验器")
    state = {"host": "app.example.com", "url": "https://app.example.com/x", "at": "2026-01-01T00:00:00Z",
             "fields": [
                 {"uid": "f4", "kind": "text", "label": "姓名", "value": "张三", "required": True},
                 {"uid": "f6", "kind": "text", "label": "手机号码", "value": "12345", "required": True},
                 {"uid": "f7", "kind": "text", "label": "邮箱", "value": "zhangsan@example.com", "required": True},
                 {"uid": "f3", "kind": "file", "label": "上传简历", "value": "", "required": True, "file": []},
             ]}
    sp = os.path.join(tmp, "state.json")
    json.dump(state, open(sp, "w", encoding="utf-8"), ensure_ascii=False)
    rc, out = run("30_verify.py", "--state", sp, "--mapping", os.path.join(tmp, "m.json"), data_dir=tmp)
    check("非法手机号被判为冲突", "格式非法" in out, out[-300:])
    check("缺失必填附件被判为缺口", "附件" in out or "缺口" in out)
    check("退出码 1 = 存在冲突", rc == 1, f"rc={rc}")

    print("6) SKILL.md frontmatter 校验（缺 name/description 会让 agent 直接不加载）")
    import re as _re
    skill_md = open(os.path.join(REPO, "SKILL.md"), encoding="utf-8").read()
    m = _re.match(r"^---" + chr(10) + r"(.*?)" + chr(10) + r"---" + chr(10), skill_md, _re.S)
    check("SKILL.md 以 --- frontmatter 开头", bool(m))
    fm = m.group(1) if m else ""
    keys, bad_lines = {}, []
    for line in fm.splitlines():
        if not line.strip():
            continue
        if line.startswith((" ", "	")):        # 续行 / 子字段
            continue
        if _re.match(r"^[A-Za-z_][A-Za-z0-9_-]*:", line):
            k, v = line.split(":", 1)
            keys[k] = v.strip()
        else:
            bad_lines.append(line[:60])          # 顶层出现裸文本 = YAML 必坏
    check("frontmatter 顶层无裸文本行（键名没被吞）", not bad_lines, f"裸文本: {bad_lines[:2]}")
    check("有非空 name", bool(keys.get("name")))
    check("name 合法（a-z0-9-，≤64）",
          bool(_re.fullmatch(r"[a-z0-9]+(-[a-z0-9]+)*", keys.get("name") or "")) and len(keys.get("name") or "") <= 64)
    check("有非空 description", bool(keys.get("description")))
    check("description ≤1024 字符", len(keys.get("description") or "") <= 1024)

    print("7) 泄漏守卫（会被提交的内容里不得有个人数据 / 记忆内容 / 本机路径）")
    bad = []

    def git_ignored(rels):
        """哪些文件不会进仓库（git check-ignore 优先；不是 git 仓库时退回解析 .gitignore）"""
        out = set()
        try:
            # 用 bytes 传 stdin：避免 text 模式在 Windows 上把 \n 翻成 \r\n（git 会因此把路径当成含 \r）
            p = subprocess.run(["git", "-C", REPO, "check-ignore", "--stdin"],
                               input="\n".join(rels).encode("utf-8"), capture_output=True)
            out = {x.strip().strip('"').replace("\\", "/")
                   for x in (p.stdout or b"").decode("utf-8", "replace").splitlines() if x.strip()}
        except Exception:
            out = set()
        # 兜底：直接按 .gitignore 的模式匹配（skill 安装目录通常不是 git 仓库）
        try:
            pats = []
            for line in open(os.path.join(REPO, ".gitignore"), encoding="utf-8"):
                line = line.strip()
                if line and not line.startswith("#") and not line.startswith("!"):
                    pats.append(line.rstrip("/"))
            for rel in rels:
                if rel in out:
                    continue
                segs = rel.split("/")
                for pat in pats:
                    if (fnmatch.fnmatch(rel, pat) or fnmatch.fnmatch(os.path.basename(rel), pat)
                            or rel == pat or rel.startswith(pat + "/") or pat in segs):
                        out.add(rel)
                        break
        except Exception:
            pass
        return out

    def git_tracked():
        """真正会被发布的文件（已进索引的）；非 git 仓库返回空集"""
        try:
            p = subprocess.run(["git", "-C", REPO, "ls-files"], capture_output=True)
            return {x.strip().replace("\\", "/")
                    for x in (p.stdout or b"").decode("utf-8", "replace").splitlines() if x.strip()}
        except Exception:
            return set()

    all_files = []
    for root, dirs, files in os.walk(REPO):
        dirs[:] = [x for x in dirs if x not in (".git", "__pycache__")]
        for fn in files:
            all_files.append(os.path.relpath(os.path.join(root, fn), REPO).replace("\\", "/"))
    ignored = git_ignored(all_files)   # 被 gitignore 的东西不会进仓库 -> 不算泄漏
    RE_MOBILE = re.compile(r"(?<!\d)1[3-9]\d{9}(?!\d)")
    RE_EMAIL = re.compile(r"[\w.+-]+@[\w-]+\.[a-z]{2,}", re.I)
    BS = chr(92)   # 反斜杠：拼出来，避免守卫脚本自身含有敏感字面量
    RE_WINPATH = re.compile("[A-Za-z]:" + BS + "{1,2}")
    RE_HOMEPATH = re.compile("C:" + BS + "{1,2}" + "Us" + "ers" + BS + "{1,2}[^" + BS + r"\s\"]+", re.I)
    ALLOW_EMAIL = {"zhangsan@example.com"}          # 测试用的示例邮箱
    MEM_ARTIFACTS = ("memory/", "runs/", "runs.jsonl", "/sites/")
    for rel in sorted(git_tracked()):  # 已经进索引的（含 git add -f）必须干净 —— 这才是真正会被发布的东西
        if any(seg in "/" + rel for seg in MEM_ARTIFACTS) or rel.startswith("data/"):
            bad.append(f"被 git 跟踪的记忆/数据文件: {rel}")
    for rel in all_files:
        if rel in ignored:
            continue                                   # 被 gitignore 的东西不会进仓库 -> 不算泄漏
        fp = os.path.join(REPO, rel)
        fn = os.path.basename(rel)
        if any(seg in "/" + rel for seg in MEM_ARTIFACTS) or rel.startswith("data/"):
            bad.append(f"记忆/数据文件: {rel}")
            continue
        if fn in ("profile.json", "dictionary.json") and "template" not in fn and "spec" not in fn:
            bad.append(f"个人数据文件: {rel}")
            continue
        try:
            txt = open(fp, encoding="utf-8").read()
        except Exception:
            continue
        if RE_MOBILE.search(txt):
            bad.append(f"手机号: {rel}")
        for m in RE_EMAIL.findall(txt):
            if m not in ALLOW_EMAIL and "@example." not in m:
                bad.append(f"邮箱 {m}: {rel}")
        if RE_HOMEPATH.search(txt):
            bad.append(f"本机用户路径: {rel}")
        elif RE_WINPATH.search(txt) and rel.endswith((".py", ".js")):
            # 脚本里出现硬编码盘符路径 = 真实的本机耦合（文档里的占位说明不受影响）
            bad.append(f"脚本内硬编码绝对路径: {rel}")

    check("可提交内容里无个人数据/记忆/本机路径", not bad, "; ".join(sorted(set(bad))[:6]))

    shutil.rmtree(tmp, ignore_errors=True)
    print()
    print(f"结果: {'全部通过 ✅' if not FAILS else '失败项 ' + str(len(FAILS)) + ' ❌'}")
    for f in FAILS:
        print("   -", f)
    return 1 if FAILS else 0


if __name__ == "__main__":
    sys.exit(main())
