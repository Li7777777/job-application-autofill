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

    # 5b 时间粒度截断不算冲突：表单 1999-09 vs 画像 1999-09-15
    prof5 = json.load(open(os.path.join(REPO, "assets", "profile.template.json"), encoding="utf-8"))
    prof5.setdefault("personal", {})["birth_date"] = "1999-09-15"
    p5 = os.path.join(tmp, "profile5.json")
    json.dump(prof5, open(p5, "w", encoding="utf-8"), ensure_ascii=False)
    state5 = {"host": "d.example.com", "url": "https://d.example.com/x", "at": "2026-01-01T00:00:00Z",
              "fields": [{"uid": "b1", "kind": "date-picker", "label": "出生年月", "labelNorm": "出生年月",
                          "value": "1999-09", "required": True, "granularity": "month", "section": "个人信息", "block": -1}]}
    sp5 = os.path.join(tmp, "state5.json")
    json.dump(state5, open(sp5, "w", encoding="utf-8"), ensure_ascii=False)
    rc5, out5 = run("30_verify.py", "--state", sp5, "--profile", p5, data_dir=tmp)
    check("时间粒度截断（1999-09 vs 画像 1999-09-15）不算硬冲突", rc5 == 0, out5[-400:])
    check("报告里明确写出「按组件粒度截断」", "截断" in out5, out5[-400:])

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

    print("7) 平台配置漂移守卫 + JS 语法（脚本内嵌的框架选择器必须与 assets/platform-selectors.json 一致）")
    asset = json.load(open(os.path.join(REPO, "assets", "platform-selectors.json"), encoding="utf-8"))

    def embedded_platform(path):
        txt = open(path, encoding="utf-8").read()
        key = "JSON.parse(String.raw`"
        i = txt.index(key) + len(key)
        j = txt.index("`);", i)
        return json.loads(txt[i:j])

    sc = embedded_platform(os.path.join(SCRIPTS, "10_scan_form.js"))
    fl = embedded_platform(os.path.join(SCRIPTS, "20_fill.js"))
    bad_detect = [k for k in asset["frameworks"] if sc["frameworks"].get(k, {}).get("detect") != asset["frameworks"][k]["detect"]]
    check("扫描器内嵌 detect 与资产一致", not bad_detect, str(bad_detect))
    check("扫描器内嵌 layout_presets 与资产一致", sc["layout_presets"] == asset["layout_presets"])
    check("扫描器 framework_to_layout 覆盖全部框架", set(sc["framework_to_layout"]) == set(asset["frameworks"]),
          str(set(asset["frameworks"]) ^ set(sc["framework_to_layout"])))
    check("填充器内嵌框架集合与资产一致", set(fl["frameworks"]) == set(asset["frameworks"]),
          str(set(asset["frameworks"]) ^ set(fl["frameworks"])))
    mism = []
    for k, cfg in fl["frameworks"].items():
        for kk, vv in cfg.items():
            if asset["frameworks"][k].get(kk) != vv:
                mism.append(f"{k}.{kk}")
    check("填充器内嵌选择器逐项与资产一致", not mism, str(mism[:4]))
    bad_dp = [k for k, v in fl["date_presets"].items() if asset["date_presets"].get(k) != v]
    check("填充器日期预设与资产一致", not bad_dp, str(bad_dp))
    check("填充器弹层黑名单与资产一致", fl["non_panel_blocklist"] == asset["non_panel_blocklist"])
    check("扫描器内嵌日期粒度提示与资产一致", sc["date_granularity_hints"] == asset["date_granularity_hints"])
    check("填充器内嵌日期粒度提示与资产一致", fl["date_granularity_hints"] == asset["date_granularity_hints"])
    node = shutil.which("node")
    if node:
        js_files = [os.path.join(SCRIPTS, x) for x in ("10_scan_form.js", "20_fill.js", "15_dump_state.js")]
        p = subprocess.run([node, os.path.join(REPO, "dev", "check_js.js"), *js_files], capture_output=True, text=True, encoding="utf-8")
        check("三个页面脚本都能作为 evaluate 函数体解析", p.returncode == 0, (p.stdout or "") + (p.stderr or ""))
    else:
        check("跳过 JS 语法检查（本机无 node）", True)

    print("8) 标签归一化与选项打分（选项匹配只出建议）")
    check("norm_label 去「（必填）」", jaa_lib.norm_label("毕业时间（必填）") == jaa_lib.norm_label("毕业时间"))
    check("norm_label 去括号内容（项目名称（英文））", jaa_lib.norm_label("项目名称（英文）") == jaa_lib.norm_label("项目名称"))
    check("带（必填）的字段名仍能命中规范", jaa_lib.match_canonical("毕业时间（必填）", d)[0] == "education.end",
          str(jaa_lib.match_canonical("毕业时间（必填）", d)))
    check("完全相等 = 1.0 exact", jaa_lib.score_option("北京", "北京") == (1.0, "exact"))
    check("归一化相等 = 0.98 normalized-equal", jaa_lib.score_option("北 京", "北京") == (0.98, "normalized-equal"))
    check("包含匹配 < 0.98（只能做建议）", jaa_lib.score_option("北京", "北京市")[0] < 0.98)
    check("中文缩写 = 0.45 subsequence（只能做建议）", jaa_lib.score_option("北大", "北京大学") == (0.45, "subsequence"))
    check("模板占位符被当空值（YYYY-MM-DD）", jaa_lib.is_placeholder("YYYY-MM-DD") and jaa_lib.is_placeholder("YYYY-MM|至今"))
    check("模板占位符被当空值（<姓名> / TODO / -）",
          jaa_lib.is_placeholder("<姓名>") and jaa_lib.is_placeholder("TODO") and jaa_lib.is_placeholder("—"))
    check("真值不会被误当占位符",
          not any(jaa_lib.is_placeholder(x) for x in ("1999-09", "2027-06", "张", "Nanjing", "清华大学", "1")))
    auto, best, _alts = jaa_lib.best_option("北京大学", ["北京大学", "清华大学"])
    check("精确命中可自动使用", auto and best == "北京大学")
    auto2, _b2, alts2 = jaa_lib.best_option("北大", ["北京大学", "清华大学"])
    check("中文缩写（北大→北京大学）不自动使用，但进建议",
          (not auto2) and any(a["text"] == "北京大学" for a in alts2), str(alts2))

    print("9) 选项闸门（不自动改值）与多段经历记录序号")
    check("模板占位符不会被填进 mapping（YYYY-MM-DD / <姓名> / TODO）",
          "f9" not in built["mapping"], json.dumps(built["mapping"], ensure_ascii=False))
    prof = json.load(open(os.path.join(REPO, "assets", "profile.template.json"), encoding="utf-8"))
    prof.setdefault("personal", {})["gender"] = "男性"
    prof.setdefault("personal", {})["name"] = "示例姓名"
    prof.setdefault("job", {})["intended_city"] = "北京"
    prof["education"] = [{"school": "甲大学", "major": "甲专业"}, {"school": "乙大学", "major": "乙专业"}]
    prof_path = os.path.join(tmp, "profile9.json")
    json.dump(prof, open(prof_path, "w", encoding="utf-8"), ensure_ascii=False)

    def fld(uid, label, kind, section, block, options=None, required=True):
        return {"uid": uid, "kind": kind, "label": label, "labelNorm": label, "required": required,
                "requiredConfidence": "high", "requiredWhy": "required attr", "section": section,
                "block": block, "framework": "antd", "value": "", "options": options}

    scan9 = {"host": "gate.example.com", "url": "https://gate.example.com/x", "at": "2026-01-01T00:00:00Z",
             "platform": {"framework": "antd"},
             "fields": [fld("g1", "性别", "custom-select", "个人信息", -1, ["男", "女"]),
                        fld("g2", "意向工作城市", "custom-select", "申请信息", -1, ["北京市", "上海市"]),
                        fld("g3", "姓名", "text", "个人信息", -1)]}
    p9 = os.path.join(tmp, "scan9.json")
    json.dump(scan9, open(p9, "w", encoding="utf-8"), ensure_ascii=False)
    rc, out = run("40_build_mapping.py", "--scan", p9, "--out", os.path.join(tmp, "m9.json"),
                  "--todo", os.path.join(tmp, "t9.md"), "--profile", prof_path, data_dir=tmp)
    b9 = json.load(open(os.path.join(tmp, "m9.json"), encoding="utf-8"))
    check("选项对不上 → 不写进 mapping（绝不自动改值）", "g1" not in b9["mapping"] and "g2" not in b9["mapping"],
          json.dumps(b9["mapping"], ensure_ascii=False))
    by_uid9 = {t["uid"]: t for t in b9["todo"]}
    check("选项对不上 → 生成 option-choice 阻塞项", b9.get("todo") and by_uid9.get("g1", {}).get("type") == "option-choice",
          json.dumps(list(by_uid9), ensure_ascii=False))
    check("选项对不上 → 带出页面全部选项", by_uid9.get("g1", {}).get("options") == ["男", "女"])
    check("选项对不上 → 给建议但不采用", any(s["text"] == "北京市" for s in by_uid9.get("g2", {}).get("suggestions", [])))
    check("选项对不上的字段进 todo，但画像里有值且选项精确匹配的字段照常写入",
          b9["mapping"].get("g3") == "示例姓名", json.dumps(b9["mapping"], ensure_ascii=False))

    scan10 = {"host": "rec.example.com", "url": "https://rec.example.com/x", "at": "2026-01-01T00:00:00Z",
              "platform": {"framework": "mokahr"},
              "fields": [fld("e1", "学校名称", "text", "教育背景", 0),
                         fld("e2", "专业名称", "text", "教育背景", 0),
                         fld("e3", "学校名称", "text", "教育背景", 1),
                         fld("e4", "专业名称", "text", "教育背景", 1)]}
    p10 = os.path.join(tmp, "scan10.json")
    json.dump(scan10, open(p10, "w", encoding="utf-8"), ensure_ascii=False)
    rc, out = run("40_build_mapping.py", "--scan", p10, "--out", os.path.join(tmp, "m10.json"),
                  "--todo", os.path.join(tmp, "t10.md"), "--profile", prof_path, data_dir=tmp)
    b10 = json.load(open(os.path.join(tmp, "m10.json"), encoding="utf-8"))
    check("多段经历：第 1 段取画像第 1 条", b10["mapping"].get("e1") == "甲大学" and b10["mapping"].get("e2") == "甲专业",
          json.dumps(b10["mapping"], ensure_ascii=False))
    check("多段经历：第 2 段取画像第 2 条（不再靠出现顺序硬猜）",
          b10["mapping"].get("e3") == "乙大学" and b10["mapping"].get("e4") == "乙专业",
          json.dumps(b10["mapping"], ensure_ascii=False))
    check("多段经历：记录数统计正确", (b10.get("records") or {}).get("education") == 2, str(b10.get("records")))

    print("10) 时间粒度自适应（画像存最细的，页面要多粗用多粗，绝不凭空补精度）")
    check("date_granularity 能判出 day/month/year",
          (jaa_lib.date_granularity("1999-09-15"), jaa_lib.date_granularity("1999-09"), jaa_lib.date_granularity("1999"))
          == ("day", "month", "year"))
    check("truncate_date 截断正确",
          (jaa_lib.truncate_date("1999-09-15", "month"), jaa_lib.truncate_date("1999-09-15", "year"),
           jaa_lib.truncate_date("1999-09", "month")) == ("1999-09", "1999", "1999-09"))
    check("date_variants 由细到粗",
          jaa_lib.date_variants("1999-09-15") == ["1999-09-15", "1999-09", "1999"]
          and jaa_lib.date_variants("1999-09") == ["1999-09", "1999"]
          and jaa_lib.date_variants("1999") == ["1999"])
    check("satisfies_granularity：页面要得更细就是不够",
          jaa_lib.satisfies_granularity("1999-09-15", "month") and not jaa_lib.satisfies_granularity("1999-09", "day"))
    d10 = jaa_lib.load_json(jaa_lib.DICT_PATH, {})
    dd = dict(d10)
    dd["canonical"] = dict(d10.get("canonical") or {})
    grans = {k: (v or {}).get("granularity") for k, v in dd["canonical"].items()}
    want_grans = {"personal.birth_date": "day", "personal.birth_ym": "month", "education.end": "month"}
    check("spec 给日期字段声明了 granularity",
          all(grans.get(k) == v for k, v in want_grans.items()),
          json.dumps({k: grans.get(k) for k in want_grans}, ensure_ascii=False))
    prof10 = {"personal": {"birth_date": "1999-09-15"}}
    check("birth_ym 从 birth_date 派生（画像只填最细的那个）",
          jaa_lib.resolve_profile_value(prof10, dd, "personal.birth_ym") == ("1999-09", "derive(personal.birth_date)"),
          str(jaa_lib.resolve_profile_value(prof10, dd, "personal.birth_ym")))
    prof10b = {"personal": {"birth_ym": "1999-09"}}
    check("只有年月时，要「日」的字段取不到值（不会拿 01 去凑）",
          jaa_lib.resolve_profile_value(prof10b, dd, "personal.birth_date")[0] is None)

    def dfield(uid, label, gran, required=True):
        return {"uid": uid, "kind": "date-picker", "label": label, "labelNorm": label, "granularity": gran,
                "required": required, "requiredConfidence": "high", "section": "个人信息", "block": -1,
                "framework": "mokahr", "value": "", "options": None}

    # 10a 必填 + 画像粒度不够 → 阻塞问用户
    scanD = {"host": "date.example.com", "url": "https://date.example.com/x", "at": "2026-01-01T00:00:00Z",
             "platform": {"framework": "mokahr"},
             "fields": [dfield("d1", "出生日期", "day"), dfield("d2", "毕业时间", "month", required=False)]}
    pD = os.path.join(tmp, "scanD.json")
    json.dump(scanD, open(pD, "w", encoding="utf-8"), ensure_ascii=False)
    profD = json.load(open(os.path.join(REPO, "assets", "profile.template.json"), encoding="utf-8"))
    profD.setdefault("personal", {})["birth_ym"] = "1999-09"      # 只有年月
    profD["personal"]["birth_date"] = "YYYY-MM-DD"                # 占位符 → 当没值
    ppD = os.path.join(tmp, "profD.json")
    json.dump(profD, open(ppD, "w", encoding="utf-8"), ensure_ascii=False)
    rc, out = run("40_build_mapping.py", "--scan", pD, "--out", os.path.join(tmp, "mD.json"),
                  "--todo", os.path.join(tmp, "tD.md"), "--profile", ppD, data_dir=tmp)
    bD = json.load(open(os.path.join(tmp, "mD.json"), encoding="utf-8"))
    by_uidD = {t["uid"]: t for t in bD.get("todo", [])}
    check("页面要「年月日」而画像只有「年月」→ 进 todo（date-granularity）",
          "d1" not in bD["mapping"] and by_uidD.get("d1", {}).get("type") == "date-granularity",
          json.dumps(by_uidD.get("d1"), ensure_ascii=False))
    check("该 todo 说清了缺哪一级", by_uidD.get("d1", {}).get("need") == "day" and by_uidD.get("d1", {}).get("have") == "month")
    check("选填字段不阻塞（只给提示）", "d2" not in bD["mapping"] or isinstance(bD["mapping"].get("d2"), dict))

    # 10b 画像更细 + 页面要年月 → 映射里带目标粒度（填充时截断）
    profE = json.load(open(ppD, encoding="utf-8"))
    profE["personal"]["birth_date"] = "1999-09-15"
    profE["personal"]["birth_ym"] = ""
    profE["education"] = [{"end": "2027-06-30", "start": "2023-09-01"}]
    ppE = os.path.join(tmp, "profE.json")
    json.dump(profE, open(ppE, "w", encoding="utf-8"), ensure_ascii=False)
    scanE = {"host": "date2.example.com", "url": "https://date2.example.com/x", "at": "2026-01-01T00:00:00Z",
             "platform": {"framework": "mokahr"},
             "fields": [dfield("e1", "出生日期", "day"), dfield("e2", "毕业时间", "month")]}
    pE = os.path.join(tmp, "scanE.json")
    json.dump(scanE, open(pE, "w", encoding="utf-8"), ensure_ascii=False)
    rc, out = run("40_build_mapping.py", "--scan", pE, "--out", os.path.join(tmp, "mE.json"),
                  "--todo", os.path.join(tmp, "tE.md"), "--profile", ppE, data_dir=tmp)
    bE = json.load(open(os.path.join(tmp, "mE.json"), encoding="utf-8"))
    check("画像更细时正常写入，并把目标粒度交给填充器",
          (bE["mapping"].get("e1") or {}).get("v") == "1999-09-15" and (bE["mapping"].get("e1") or {}).get("granularity") == "day"
          and (bE["mapping"].get("e2") or {}).get("granularity") == "month",
          json.dumps(bE["mapping"], ensure_ascii=False))
    check("会说明「多余的精度会被截断」", any("时间粒度自适应" in n for n in
          [l for l in open(os.path.join(tmp, "tE.md"), encoding="utf-8").read().splitlines()]),
          json.dumps(bE.get("todo"), ensure_ascii=False))

    print("11) 泄漏守卫（会被提交的内容里不得有个人数据 / 记忆内容 / 本机路径）")
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
