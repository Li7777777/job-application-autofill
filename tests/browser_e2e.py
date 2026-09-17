#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""tests/browser_e2e.py —— 真机端到端自检（需要一个开着 CDP 端口的浏览器）

用 tests/fixtures/form-lab.html（合成页面：mokahr 式 sd-Select、antd 式 ant-select/ant-picker、
原生 select、两段教育背景、一个提交按钮）跑完整链路：

    10_scan_form.js → 40_build_mapping.py → 20_fill.js → 15_dump_state.js → 30_verify.py

断言（这些是纯 Python 单测覆盖不到的部分）：
  · 组件框架识别（mokahr / antd 混在一页上也能分开）
  · 区块 section 与「重复块按字段名重复切分成记录」（两段教育背景 → block 0/1）
  · 多段经历各自取到画像的第 1/2 条
  · 自定义下拉真的被打开并选对；弹层里的选项没有被误点（只点精确匹配）
  · 只读日期框 → 日历面板 → 年 → 月 → 日，最后真的落到目标日期
  · 提交按钮一次都没被点（window.__submits 必须为 0）
  · 页面上确实出现了期望的值

没有 node / 没有可用的浏览器时自动 SKIP（退出码 0），不阻塞无浏览器的环境。
用法:  python tests/browser_e2e.py [--keep-open]
"""
import argparse, json, os, re, shutil, subprocess, sys, tempfile, datetime
import urllib.request

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCRIPTS = os.path.join(REPO, "scripts")
CDP = os.path.join(SCRIPTS, "cdp.mjs")
FIXTURE = os.path.join(REPO, "tests", "fixtures", "form-lab.html")
FAILS, SKIPS = [], []


def check(name, cond, detail=""):
    print(f"  [{'PASS' if cond else 'FAIL'}] {name}" + (f"  {detail}" if detail and not cond else ""))
    if not cond:
        FAILS.append(name)


def skip(name, why):
    print(f"  [SKIP] {name}  ({why})")
    SKIPS.append(name)


def cdp(*args, timeout=240):
    p = subprocess.run(["node", CDP, *args], capture_output=True, text=True,
                       encoding="utf-8", errors="replace", cwd=REPO, timeout=timeout)
    return p.returncode, ((p.stdout or "") + (p.stderr or "")).strip()


def read_json_out(text):
    i, j = text.find("{"), text.rfind("}")
    if i < 0 or j < 0:
        raise ValueError("no JSON in output: " + text[:400])
    return json.loads(text[i:j + 1])


def wrap_body(src):
    """把页面脚本包成「返回 JSON 对象」的可 eval 表达式"""
    return ("const __body = async () => {\n" + src +
            "\n};\nconst __r = await __body();\n"
            "return typeof __r === 'string' ? JSON.parse(__r) : __r;\n")


FAKE_PROFILE = {
    "_comment": "browser_e2e 用的合成画像：全部是假数据，不含任何真实个人信息",
    "personal": {"name": "测试用户", "name_en": "", "phone_country_code": "+86", "phone": "", "email": "",
                 "gender": "男", "birth_date": "1999-09-15", "birth_ym": "1999-09", "id_number": None,
                 "location": "", "address": None, "political_status": None, "marital_status": None,
                 "height": None, "wechat": None, "qq": None, "highest_degree": "硕士"},
    "job": {"intended_city": "北京市", "intended_role": "", "expected_salary": None, "available_from": None,
            "referral_code": "JAA-TEST", "source_channel": ""},
    "education": [{"school": "甲大学", "major": "甲专业", "degree": "本科", "start": "2023-09"},
                  {"school": "乙大学", "major": "乙专业", "degree": "硕士"}],
    "experience": [], "projects": [], "skills": []
}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--keep-open", action="store_true", help="跑完不关标签页（调试用）")
    a = ap.parse_args()

    print("0) 环境准备")
    if not shutil.which("node"):
        skip("浏览器端到端", "本机没有 node")
        return 0
    rc, port = cdp("port")
    if rc != 0:
        skip("浏览器端到端", f"读不到 CDP 端口: {port[:120]}")
        return 0
    port = port.strip().splitlines()[-1].strip()
    before = []
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/json/list", timeout=5) as r:
            before = [t for t in json.load(r) if t.get("type") == "page"]
    except Exception as e:
        skip("浏览器端到端", f"CDP 端口 {port} 连不上: {e}")
        return 0
    print(f"  CDP 端口 {port}，当前 {len(before)} 个页面；将新开一个页跑测试，结束后关掉")

    tmp = tempfile.mkdtemp(prefix="jaa-e2e-")
    profile_path = os.path.join(tmp, "profile.json")
    json.dump(FAKE_PROFILE, open(profile_path, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    url = "file:///" + FIXTURE.replace("\\", "/")
    target = None
    try:
        rc, out = cdp("open", url)
        if rc != 0 or not out:
            skip("浏览器端到端", f"打不开测试页: {out[:160]}")
            return 0
        target = out.strip().splitlines()[-1].strip()

        print("\n1) 扫描（10_scan_form.js）")
        f = os.path.join(tmp, "step_scan.js")
        open(f, "w", encoding="utf-8").write(wrap_body(open(os.path.join(SCRIPTS, "10_scan_form.js"), encoding="utf-8").read()))
        rc, out = cdp("eval", target, f)
        if rc != 0:
            check("扫描脚本执行成功", False, out[:400])
            return 1
        scan = read_json_out(out)
        scan_path = os.path.join(tmp, "scan.json")
        json.dump(scan, open(scan_path, "w", encoding="utf-8"), ensure_ascii=False, indent=2)

        by_label = {}
        for fl in scan["fields"]:
            by_label.setdefault((fl.get("label"), fl.get("section"), fl.get("block")), []).append(fl)

        def find(label, section=None, block=None):
            hits = [x for x in scan["fields"]
                    if x.get("label") == label
                    and (section is None or x.get("section") == section)
                    and (block is None or x.get("block") == block)]
            return hits[0] if hits else None

        check("页面级框架识别为 mokahr（该页 mokahr 控件最多）",
              scan.get("platform", {}).get("framework") == "mokahr", str(scan.get("platform", {}).get("framework")))
        secs = set(scan["summary"]["bySection"])
        check("四个区块都被识别出来", {"申请信息", "个人信息", "教育背景", "附加信息"} <= secs, str(sorted(secs)))
        check("混合框架：sd-Select 判为 mokahr", (find("性别") or {}).get("framework") == "mokahr")
        check("混合框架：ant-select 判为 antd", (find("是否同意调剂") or {}).get("framework") == "antd")
        check("控件类型：sd-Select → custom-select", (find("意向工作城市") or {}).get("kind") == "custom-select",
              str((find("意向工作城市") or {}).get("kind")))
        check("控件类型：只读日期框 → date-picker", (find("出生日期 (年龄)") or {}).get("kind") == "date-picker",
              str((find("出生日期 (年龄)") or {}).get("kind")))
        check("必填识别（required-asterisk）", (find("姓名") or {}).get("required") is True)
        check("非必填不误报", (find("推荐码") or {}).get("required") is False)

        s0, s1 = find("学校名称", "教育背景", 0), find("学校名称", "教育背景", 1)
        check("两段教育背景切分成 block 0 / 1", s0 is not None and s1 is not None, str([f.get("block") for f in scan["fields"] if f.get("label") == "学校名称"]))
        m0 = find("专业名称", "教育背景", 0)
        check("同一条记录内的不同字段共享同一个 block（不被兄弟下标带偏）",
              m0 is not None and m0.get("block") == 0, str((m0 or {}).get("block")))
        check("blockCount = 2", (s0 or {}).get("blockCount") == 2, str((s0 or {}).get("blockCount")))

        print("\n2) 编译映射（40_build_mapping.py）")
        env = dict(os.environ); env["JAA_DATA_DIR"] = os.path.join(tmp, "data")
        p = subprocess.run([sys.executable, os.path.join(SCRIPTS, "40_build_mapping.py"),
                            "--scan", scan_path, "--out", os.path.join(tmp, "mapping.json"),
                            "--todo", os.path.join(tmp, "todo.md"), "--profile", profile_path],
                           capture_output=True, text=True, encoding="utf-8", errors="replace", env=env)
        built = json.load(open(os.path.join(tmp, "mapping.json"), encoding="utf-8"))
        mp = built["mapping"]

        def uid_of(label, section=None, block=None):
            x = find(label, section, block)
            return x["uid"] if x else None

        def mval(uid):
            """mapping 的值可能是字符串，也可能是 {v, granularity} 对象"""
            v = mp.get(uid)
            return v.get("v") if isinstance(v, dict) else v

        check("姓名 → 画像值", mval(uid_of("姓名")) == "测试用户", str(mp.get(uid_of("姓名"))))
        check("意向工作城市 → 画像值（选项精确命中）",
              mval(uid_of("意向工作城市")) == "北京市", str(mp.get(uid_of("意向工作城市"))))
        check("出生日期 → 画像值（带目标粒度提示）",
              mval(uid_of("出生日期 (年龄)")) == "1999-09-15"
              and (mp.get(uid_of("出生日期 (年龄)")) or {}).get("granularity"),
              str(mp.get(uid_of("出生日期 (年龄)"))))
        check("第 1 段教育 → 画像 education[0]",
              mval(uid_of("学校名称", "教育背景", 0)) == "甲大学"
              and mval(uid_of("专业名称", "教育背景", 0)) == "甲专业"
              and mval(uid_of("学历", "教育背景", 0)) == "本科",
              json.dumps({k: v for k, v in mp.items()}, ensure_ascii=False))
        check("第 2 段教育 → 画像 education[1]（不靠出现顺序硬猜）",
              mval(uid_of("学校名称", "教育背景", 1)) == "乙大学"
              and mval(uid_of("专业名称", "教育背景", 1)) == "乙专业"
              and mval(uid_of("学历", "教育背景", 1)) == "硕士",
              json.dumps({k: v for k, v in mp.items()}, ensure_ascii=False))
        check("未映射的必填进 todo（不猜）",
              any(t["uid"] == uid_of("是否同意调剂") for t in built.get("todo", [])))

        # 3b) 「年+月」分片控件：站点是复合控件，由 adapter/人工在 mapping 上标 mode:'period'
        enroll_uid = uid_of("入学时间", "教育背景", 0)
        frag_uids = [x["uid"] for x in scan["fields"] if x["label"] == "入学时间" and x.get("block") == 0]
        check("分片控件被拆成两个 uid（同字段名多控件）", len(frag_uids) == 2, str(frag_uids))
        if enroll_uid and len(frag_uids) == 2:
            for other in frag_uids[1:]:
                mp.pop(other, None)
            mp[enroll_uid] = {"v": "2023-09", "mode": "period"}
        check("年月自适应：页面只要 month → mapping 里带上 month 粒度提示",
              (mp.get(uid_of("出生年月")) or {}).get("granularity") == "month",
              json.dumps(mp.get(uid_of("出生年月")), ensure_ascii=False))

        print("\n3) 填充（20_fill.js）")
        src = open(os.path.join(SCRIPTS, "20_fill.js"), encoding="utf-8").read()
        if "const MAPPING = {};" not in src:
            check("20_fill.js 的 MAPPING 声明形状可注入", False)
            return 1
        src = src.replace("const MAPPING = {};",
                          "const MAPPING = " + json.dumps(mp, ensure_ascii=False) + ";", 1)
        f = os.path.join(tmp, "step_fill.js")
        open(f, "w", encoding="utf-8").write(wrap_body(src))
        rc, out = cdp("eval", target, f, timeout=300)
        if rc != 0:
            check("填充脚本执行成功", False, out[:400])
            return 1
        fill = read_json_out(out)
        ok_labels = {x["label"] for x in fill.get("ok", [])}
        fail_msgs = {x["label"]: x.get("detail") for x in fill.get("failed", [])}
        check("填充返回 ok/skipped/failed/suggestions 四组", all(k in fill for k in ("ok", "skipped", "failed", "suggestions")))
        check("自定义下拉「意向工作城市」填成功", "意向工作城市" in ok_labels, str(fail_msgs.get("意向工作城市")))
        check("自定义下拉「性别」填成功", "性别" in ok_labels, str(fail_msgs.get("性别")))
        check("只读日期框（日历年→月→日）填成功", "出生日期 (年龄)" in ok_labels, str(fail_msgs.get("出生日期 (年龄)")))
        edu_ok = [x for x in fill.get("ok", []) if x.get("section") == "教育背景"]
        check("教育背景 6 个字段 + 1 个分片控件全部填成功",
              {"学校名称", "专业名称", "学历", "入学时间"} <= {x["label"] for x in edu_ok} and len(edu_ok) == 7,
              json.dumps([(x["label"], x.get("block")) for x in edu_ok], ensure_ascii=False))
        check("纯文本字段填成功（姓名 / 推荐码）", {"姓名", "推荐码"} <= ok_labels, str(fail_msgs))
        check("年月粒度自适应：组件只要年月 → 截断到 1999-09（不报错、不编造日）",
              "出生年月" in ok_labels
              and any("1999-09" in str(x.get("detail") or "") for x in fill.get("ok", []) if x.get("label") == "出生年月"),
              str(fail_msgs.get("出生年月")) or json.dumps([x for x in fill.get("ok", []) if x.get("label") == "出生年月"], ensure_ascii=False))
        check("「年+月」分片控件被逐段填入", "入学时间" in ok_labels, str(fail_msgs.get("入学时间")))

        print("\n4) 页面副作用（提交拦截 / 误点检查）")
        f = os.path.join(tmp, "step_probe.js")
        open(f, "w", encoding="utf-8").write(
            "return { submits: window.__submits, clicks: window.__optionClicks, opens: window.__panelOpens };")
        rc, out = cdp("eval", target, f)
        side = read_json_out(out)
        check("提交按钮一次都没被点（window.__submits === 0）", side.get("submits") == 0, str(side.get("submits")))
        clicked = [c.get("text") for c in (side.get("clicks") or [])]
        check("只点到预期选项，没有误点近似项",
              sorted(set(clicked)) == sorted({"北京市", "男", "甲大学", "乙大学"}),
              str(clicked))
        check("下拉/日历确实被打开过（5 次：城市/性别/学校x2/生日）", (side.get("opens") or 0) >= 5, str(side.get("opens")))

        print("\n5) 状态导出 + 校验（15_dump_state.js / 30_verify.py）")
        f = os.path.join(tmp, "step_state.js")
        open(f, "w", encoding="utf-8").write(wrap_body(open(os.path.join(SCRIPTS, "15_dump_state.js"), encoding="utf-8").read()))
        rc, out = cdp("eval", target, f)
        if rc != 0:
            check("状态导出执行成功", False, out[:400])
            return 1
        state = read_json_out(out)
        state_path = os.path.join(tmp, "state.json")
        json.dump(state, open(state_path, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
        vals = {(x.get("label"), x.get("section"), x.get("block")): x.get("value") for x in state["fields"]}
        vals_all = {}
        for x in state["fields"]:
            vals_all.setdefault((x.get("label"), x.get("section"), x.get("block")), []).append(x.get("value"))
        check("页面上真的填上了「姓名」", vals.get(("姓名", "个人信息", -1)) == "测试用户",
              str(vals.get(("姓名", "个人信息", -1))))
        check("页面上真的填上了「意向工作城市」", vals.get(("意向工作城市", "申请信息", -1)) == "北京市",
              str(vals.get(("意向工作城市", "申请信息", -1))))
        check("页面上真的填上了「出生日期」", vals.get(("出生日期 (年龄)", "个人信息", -1)) == "1999-09-15",
              str(vals.get(("出生日期 (年龄)", "个人信息", -1))))
        check("年月粒度：页面上确实只到 1999-09（没有多余的日）",
              vals.get(("出生年月", "个人信息", -1)) == "1999-09",
              str(vals.get(("出生年月", "个人信息", -1))))
        check("分片控件：两个片段在页面上分别是 2023年 与 9月",
              sorted(vals_all.get(("入学时间", "教育背景", 0), [])) == sorted(["2023年", "9月"]),
              str(vals_all.get(("入学时间", "教育背景", 0))))
        check("第 2 段教育真的填到了第 2 条画像",
              vals.get(("学校名称", "教育背景", 1)) == "乙大学" and vals.get(("专业名称", "教育背景", 1)) == "乙专业",
              str({k: v for k, v in vals.items() if k[1] == "教育背景"}))

        p = subprocess.run([sys.executable, os.path.join(SCRIPTS, "30_verify.py"),
                            "--state", state_path, "--scan", scan_path,
                            "--mapping", os.path.join(tmp, "mapping.json"), "--profile", profile_path],
                           capture_output=True, text=True, encoding="utf-8", errors="replace", env=env)
        rep = (p.stdout or "") + (p.stderr or "")
        check("校验器没有报硬冲突", p.returncode == 0, rep[-700:])
        check("校验报告按区块分段", "区块:" in rep or "第1段" in rep, rep[:300])

        print("\n6) 选项闸门 + 幂等（安全属性）")
        city_uid = uid_of("意向工作城市")
        # 6a 近似值（北京 vs 北京市）不允许自动点击
        open(os.path.join(tmp, "reset.js"), "w", encoding="utf-8").write(
            "window.__optionClicks = []; return { ok: true };")
        cdp("eval", target, os.path.join(tmp, "reset.js"))
        near_src = re.sub(r"const MAPPING = \{\};",
                          "const MAPPING = " + json.dumps({city_uid: "北京"}, ensure_ascii=False) + ";",
                          open(os.path.join(SCRIPTS, "20_fill.js"), encoding="utf-8").read(), count=1)
        open(os.path.join(tmp, "step_near.js"), "w", encoding="utf-8").write(wrap_body(near_src))
        near = read_json_out(cdp("eval", target, os.path.join(tmp, "step_near.js"))[1])
        near_fail = {x["label"]: x for x in near.get("failed", [])}
        check("近似值「北京」（页面只有北京市）被判失败，不静默写入",
              "意向工作城市" not in {x["label"] for x in near.get("ok", [])}
              and "意向工作城市" in near_fail,
              json.dumps(near.get("ok", []), ensure_ascii=False))
        check("失败时给出建议值（含匹配依据）",
              any("北京市" in str(s) for s in (near_fail.get("意向工作城市", {}).get("suggestions") or [])),
              json.dumps(near_fail.get("意向工作城市"), ensure_ascii=False))
        side2 = read_json_out(cdp("eval", target, os.path.join(tmp, "step_probe.js"))[1])
        check("近似值没有被真的点选（弹层一次都没开）", len(side2.get("clicks") or []) == 0, str(side2.get("clicks")))

        # 6b 幂等：再跑一次完整 mapping，应该全部 skipped
        src2 = re.sub(r"const MAPPING = \{\};",
                      "const MAPPING = " + json.dumps(mp, ensure_ascii=False) + ";",
                      open(os.path.join(SCRIPTS, "20_fill.js"), encoding="utf-8").read(), count=1)
        open(os.path.join(tmp, "step_fill2.js"), "w", encoding="utf-8").write(wrap_body(src2))
        fill2 = read_json_out(cdp("eval", target, os.path.join(tmp, "step_fill2.js"))[1])
        check("幂等：重跑后没有新的写入、全部进 skipped",
              len(fill2.get("ok") or []) == 0 and len(fill2.get("skipped") or []) >= 8,
              f"ok={len(fill2.get('ok') or [])} skipped={len(fill2.get('skipped') or [])} failed={len(fill2.get('failed') or [])}")
        side3 = read_json_out(cdp("eval", target, os.path.join(tmp, "step_probe.js"))[1])
        check("幂等重跑后提交按钮依然没被点", side3.get("submits") == 0, str(side3.get("submits")))
    finally:
        if target and not a.keep_open:
            cdp("close", target)
            print(f"\n  已关闭测试标签页 {target}")

    shutil.rmtree(tmp, ignore_errors=True)
    print()
    print(f"结果: {'全部通过 ✅' if not FAILS else '失败项 ' + str(len(FAILS)) + ' ❌'}" + (f"（跳过 {len(SKIPS)}）" if SKIPS else ""))
    for x in FAILS:
        print("   -", x)
    return 1 if FAILS else 0


if __name__ == "__main__":
    sys.exit(main())
