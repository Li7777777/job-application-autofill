#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""jaa_lib.py —— job-application-autofill 共用工具（字典匹配 / 画像取值 / 格式校验）

被 30_verify.py、40_build_mapping.py、90_memory.py 引用。
"""
import json, os, re, shutil, sys

REPO_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _resolve_data_dir():
    """数据目录 = **运行环境自己** 的 data/（skill 安装目录，或仓库检出目录）。
    优先级：环境变量 JAA_DATA_DIR > <运行环境>/data > ~/.job-application-autofill（仅当运行环境只读时兜底）。
    该目录已被 .gitignore 忽略，所以个人数据/记忆不会进仓库。"""
    env = os.environ.get("JAA_DATA_DIR") or os.environ.get("WFA_DATA_DIR")  # 旧名兼容
    if env:
        return os.path.abspath(env)
    primary = os.path.join(REPO_DIR, "data")
    try:
        os.makedirs(primary, exist_ok=True)
        return primary
    except Exception:
        fallback = os.path.join(os.path.expanduser("~"), ".job-application-autofill")
        os.makedirs(fallback, exist_ok=True)
        return fallback


DATA_DIR = _resolve_data_dir()
MEM_DIR = os.path.join(DATA_DIR, "memory")
SITES_DIR = os.path.join(MEM_DIR, "sites")
RUNS_DIR = os.path.join(DATA_DIR, "runs")
DICT_PATH = os.path.join(MEM_DIR, "dictionary.json")
PROFILE_PATH = os.path.join(DATA_DIR, "profile.json")
RUNS_LOG = os.path.join(MEM_DIR, "runs.jsonl")

# 仓库自带的可发布资产：字段规范（SPEC）与画像模板 —— 都不含个人数据 / 记忆内容
SPEC_PATH = os.path.join(REPO_DIR, "assets", "canonical-fields.spec.json")
SEED_PROFILE = os.path.join(REPO_DIR, "assets", "profile.template.json")


def ensure_data_dir():
    """首次运行时在 **仓库之外** 创建数据目录：
       profile.json（从模板复制）+ memory/dictionary.json（从字段规范生成，qa 为空）。
    之后所有学习到的东西（别名 / 问答 / 站点记忆 / 运行日志）只写在这里。"""
    created = []
    for d in (DATA_DIR, MEM_DIR, SITES_DIR, RUNS_DIR):
        os.makedirs(d, exist_ok=True)
    if not os.path.exists(PROFILE_PATH) and os.path.exists(SEED_PROFILE):
        shutil.copyfile(SEED_PROFILE, PROFILE_PATH)
        created.append(PROFILE_PATH)
    if not os.path.exists(DICT_PATH):
        spec = load_json(SPEC_PATH, {}) or {}
        save_json(DICT_PATH, {
            "version": spec.get("version", 1),
            "_comment": "运行期字典：由 assets/canonical-fields.spec.json 生成；"
                        "用户学习到的别名/问答都追加在这里（本文件在仓库之外）。",
            "canonical": spec.get("fields", {}),
            "qa": {"_comment": "问答记忆：问题原文 → 答案（由 90_memory.py add-qa 维护）"},
        })
        created.append(DICT_PATH)
    return created


PHONE_RE = re.compile(r"^1[3-9]\d{9}$")
EMAIL_RE = re.compile(r"^[\w.+-]+@[\w-]+(\.[\w-]+)+$")
ID_RE = re.compile(r"^\d{17}[\dXx]$|^\d{15}$")
DATE_RE = re.compile(r"^\d{4}([-/.年]\d{1,2}){0,2}")

BOOL_TRUE = {"是", "有", "true", "yes", "y", "1", "on", "1.0"}

# 模板里的占位符 —— 它们不是真值，绝不能填进表单（否则会把 “YYYY-MM” 当生日填上去）
PLACEHOLDER_RE = re.compile(
    r"^(<[^>]*>|y{2,4}([-/.]m{1,2}([-/.]d{1,2})?)?|m{1,2}([-/.]d{1,2})?|d{1,2}|n/?a|null|none|todo|tbd|-+|—+|_+)$",
    re.I)


def is_placeholder(v):
    """True = 这个「值」其实是模板占位/空值，应当当没值处理"""
    if v is None:
        return True
    if isinstance(v, bool):
        return False
    if not isinstance(v, str):
        return False
    s = v.strip()
    if not s:
        return True
    if "|" in s:                      # 例：experience.end = "YYYY-MM|至今"
        s = s.split("|")[0].strip()
    return bool(PLACEHOLDER_RE.match(s))


def load_json(path, default=None):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return default if default is not None else {}


def save_json(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=2)


def norm(s):
    """归一化：去空白/标点/大小写，用于别名匹配"""
    s = str(s if s is not None else "")
    s = re.sub(r"[\s\u200b-\u200f\ufeff]", "", s)
    s = re.sub(r"[*＊:：()（）\[\]【】?？。.,，、/\\|_-]", "", s)
    return s.lower()


# 标签噪声：页面会把「（必填）」「添加」「编辑」等混进字段名
LABEL_NOISE = ("（必填）", "(必填)", "（可选）", "(可选)", "（选填）", "(选填)", "必填", "选填", "可选", "添加", "编辑")


def norm_label(s):
    """字段名归一化（与 scripts/10_scan_form.js 的 stripLabelNoise 对齐）：
    去掉「必填/可选/添加/编辑」等噪声 + **整段括号内容** + 行首编号，再走 norm()。
    「毕业时间（必填）」与「毕业时间」因此落到同一个键上。"""
    t = str(s if s is not None else "")
    for n in LABEL_NOISE:
        t = t.replace(n, "")
    t = re.sub(r"[（(][^）)]*[）)]", "", t)
    t = re.sub(r"^\d+[.、]\s*", "", t)
    return norm(t)


# 全角 → 半角
def to_half(s):
    out = []
    for ch in str(s if s is not None else ""):
        o = ord(ch)
        if 0xFF01 <= o <= 0xFF5E:
            out.append(chr(o - 0xFEE0))
        elif o == 0x3000:
            out.append(" ")
        else:
            out.append(ch)
    return "".join(out)


OPT_PUNCT = re.compile(r"[\s\u200b-\u200f\ufeff·・.,，。、;；:：!！?？'\"“”‘’()（）\[\]【】<>《》\-—_/\\|]")


def norm_option(s):
    """选项文本归一化：全角转半角 + 去空白标点 + 小写"""
    return OPT_PUNCT.sub("", to_half(s)).lower()


def score_option(want, option):
    """给「简历里的值 → 页面选项」打分。返回 (score, why)。
    只认「精确」与「归一化后相等」为可自动使用；包含匹配仅用于生成建议。"""
    w = str(want if want is not None else "").strip()
    o = str(option if option is not None else "").strip()
    if not w or not o:
        return 0.0, "empty"
    if w == o:
        return 1.0, "exact"
    nw, no = norm_option(w), norm_option(o)
    if nw and nw == no:
        return 0.98, "normalized-equal"
    if nw and no and (nw in no or no in nw):
        ratio = min(len(nw), len(no)) / max(len(nw), len(no))
        return 0.5 + 0.3 * ratio, "contains"
    # 缩写（北大 → 北京大学）：只给建议，永远不自动采用
    if nw and no and 2 <= len(nw) < len(no) and is_subsequence(nw, no):
        return 0.45, "subsequence"
    if nw and no and 2 <= len(no) < len(nw) and is_subsequence(no, nw):
        return 0.4, "subsequence"
    return 0.0, "no-match"


AUTO_OPTION_THRESHOLD = 0.98


def is_subsequence(short, long):
    """short 的字符是否按序出现在 long 里（中文缩写：北大 → 北京大学）。
    只用来把「可疑的缩写」排到建议列表前面，分数永远低于自动采用阈值。"""
    it = iter(long)
    return all(ch in it for ch in short)


def rank_options(want, options, limit=5):
    """返回按分数降序的 [{text, score, why}]。
    score >= AUTO_OPTION_THRESHOLD 直接落到 mapping；未达阈值的候选由调用方决定：
    40_build_mapping.py 在 review-first 下可暂选「唯一且 >= REVIEW_OPTION_THRESHOLD」的项并标记最终复核，
    并列 / 过弱则留空进复核清单；20_fill.js 页面层永远只点 exact / normalized-equal。"""
    ranked = []
    for o in options or []:
        sc, why = score_option(want, o)
        ranked.append({"text": o, "score": round(sc, 4), "why": why})
    ranked.sort(key=lambda x: -x["score"])
    return [r for r in ranked if r["score"] > 0][:limit]


def best_option(want, options):
    """返回 (是否可自动使用, 最佳选项或None, 建议列表)。"""
    ranked = rank_options(want, options, limit=6)
    if not ranked:
        return False, None, []
    top = ranked[0]
    if top["score"] >= AUTO_OPTION_THRESHOLD:
        return True, top["text"], ranked[1:]
    return False, None, ranked


def dig(obj, path):
    cur = obj
    for p in str(path).split("."):
        if isinstance(cur, dict):
            cur = cur.get(p)
        elif isinstance(cur, list):
            try:
                cur = cur[int(p)]
            except Exception:
                return None
        else:
            return None
    return cur


def site_memory_path(host):
    safe = re.sub(r"[^A-Za-z0-9._-]", "_", host or "unknown")
    return os.path.join(MEM_DIR, "sites", safe + ".json")


def match_canonical(label, dictionary, min_len=2):
    """把一个页面字段名映射到 canonical key。返回 (key, confidence, matched_alias)
    先用 norm_label（去「（必填）/添加/编辑」等噪声）再匹配，命中率明显高于裸 norm。"""
    if not label:
        return None, None, None
    n = norm_label(label) or norm(label)
    if len(n) < min_len:
        return None, None, None
    best = None
    for key, meta in (dictionary.get("canonical") or {}).items():
        for a in meta.get("aliases", []):
            na = norm_label(a) or norm(a)
            if not na:
                continue
            if n == na:
                return key, "high", a
            # 包含匹配：别名要够长，且不能在超长句子里“蹭”到（避免“是否…应聘岗位…”命中 job.intended_role）
            if len(na) >= 3 and (na in n or n in na):
                longer, shorter = (n, na) if len(n) >= len(na) else (na, n)
                if len(longer) <= len(shorter) * 2.5 + 4:
                    if best is None or len(na) > len(best[2]):
                        best = (key, "medium", a)
    return (best[0], best[1], best[2]) if best else (None, None, None)


def match_qa(label, dictionary):
    """问答记忆：问题原文 → 答案。

    安全线（2026-09-14 修）：
      * **空字段名一律不匹配** —— 旧版 n='' 时 `'' in nq` 恒为真，会把 qa 里的**第一条答案**
        随机写进所有无字段名的控件（实测在一个 mokahr 表单上把「您使用微博的频率」的答案
        写进了 30+ 个无标签控件）。
      * 包含匹配只有当两者长度相近（短/长 ≥ 0.75）时才接受 —— 防「最高学历」命中
        「该学历是否您的最高学历？」这类**问句里含短词**的误配。
    """
    qa = {k: v for k, v in (dictionary.get("qa") or {}).items() if not k.startswith("_")}
    n = norm_label(label) or norm(label)
    if not n:
        return None, None, None
    for q, a in qa.items():
        if (norm_label(q) or norm(q)) == n:
            return a, "high", q
    for q, a in qa.items():
        nq = norm_label(q) or norm(q)
        if len(nq) < 4 or not (nq in n or n in nq):
            continue
        longer, shorter = (n, nq) if len(n) >= len(nq) else (nq, n)
        if len(longer) and len(shorter) / len(longer) >= 0.75:
            return a, "medium", q
    return None, None, None


def fmt_check(kind, value):
    """返回 (ok, msg)"""
    v = str(value or "").strip()
    if not v:
        return True, "空"
    if kind == "phone":
        digits = re.sub(r"\D", "", v)
        return (bool(PHONE_RE.match(digits[-11:])) if len(digits) >= 11 else False), f"手机号 {v}"
    if kind == "email":
        return bool(EMAIL_RE.match(v)), f"邮箱 {v}"
    if kind == "id":
        return bool(ID_RE.match(v)), f"证件号 长度{len(v)}"
    if kind == "date":
        return bool(DATE_RE.match(v)), f"日期 {v}"
    return True, ""


def normalize_date(v):
    """'2027 | 6' / '2027年6月' / '2027-06-01' → 'YYYY-MM'（取不到月则 'YYYY'）"""
    if not v:
        return None
    nums = re.findall(r"\d+", str(v))
    if not nums:
        return None
    y = int(nums[0])
    return f"{y:04d}-{int(nums[1]):02d}" if len(nums) >= 2 else f"{y:04d}"


# ——— 时间粒度自适应（画像存最细的，页面要多粗就用多粗，但**绝不凭空补精度**） ———
GRAN_RANK = {"year": 1, "month": 2, "day": 3}


def date_parts(v):
    """抽出 [年, 月, 日]（缺的为 None）"""
    nums = re.findall(r"\d+", str(v if v is not None else ""))
    if not nums:
        return None
    out = [int(nums[0]), None, None]
    if len(nums) >= 2:
        out[1] = int(nums[1])
    if len(nums) >= 3:
        out[2] = int(nums[2])
    return out


def date_granularity(v):
    """这个值自身能提供到哪一级：'day' | 'month' | 'year' | None"""
    p = date_parts(v)
    if not p:
        return None
    return "day" if p[2] is not None else ("month" if p[1] is not None else "year")


def truncate_date(v, granularity):
    """把日期截断到指定粒度：('1999-09-15','month') → '1999-09'。粒度比源粗就原样返回。"""
    p = date_parts(v)
    if not p:
        return v
    y, m, d = p
    if granularity == "year":
        return f"{y:04d}"
    if granularity == "month":
        return f"{y:04d}-{m:02d}" if m is not None else f"{y:04d}"
    if m is None:
        return f"{y:04d}"
    return f"{y:04d}-{m:02d}-{d:02d}" if d is not None else f"{y:04d}-{m:02d}"


def date_variants(v):
    """展开成由细到粗的变体：'1999-09-15' → ['1999-09-15','1999-09','1999']；
    只有年月 → ['1999-09','1999']；只有年 → ['1999']"""
    p = date_parts(v)
    if not p:
        return []
    y, m, d = p
    out = []
    if d is not None and m is not None:
        out.append(f"{y:04d}-{m:02d}-{d:02d}")
    if m is not None:
        out.append(f"{y:04d}-{m:02d}")
    out.append(f"{y:04d}")
    seen, res = set(), []
    for x in out:
        if x not in seen:
            seen.add(x)
            res.append(x)
    return res


def satisfies_granularity(value, granularity):
    """画像值能否满足页面要求的粒度？（页面要 day、值只有 month → False：不编造，留空并列入填后集中确认）"""
    need = GRAN_RANK.get(granularity or "", 0)
    if need == 0:
        return True
    return GRAN_RANK.get(date_granularity(value) or "", 0) >= need


def resolve_profile_value(profile, dictionary, key):
    """按 canonical 取值，支持 canonical 上声明的 `derive`（例：birth_ym 从 birth_date 截断）。
    返回 (值, 来源标签)；取不到返回 (None, None)。"""
    meta = ((dictionary.get("canonical") or {}).get(key) or {})
    v = dig(profile, key)
    if not is_placeholder(v):
        return v, "profile"
    d = meta.get("derive") or {}
    src = d.get("from")
    if src:
        base = dig(profile, src)
        if not is_placeholder(base):
            g = d.get("granularity") or meta.get("granularity") or "month"
            return truncate_date(base, g), f"derive({src})"
    return None, None


def coarser_sources(dictionary, key):
    """哪些 canonical 是从 key 派生出去的（即 key 的**粗粒度**版本）。
    例：key='personal.birth_date' → [('personal.birth_ym', 'month')]。
    用在「页面要年月日、但画像只填了年月」时给出「你已给到年月」这种可操作的提示。"""
    out = []
    for ck, meta in (dictionary.get("canonical") or {}).items():
        d = (meta or {}).get("derive") or {}
        if d.get("from") == key:
            out.append((ck, d.get("granularity") or (meta or {}).get("granularity")))
    return out


def same_value(a, b):
    """宽松比较：忽略空白/大小写；日期按 YYYY-MM 前缀比；其余容忍包含关系"""
    if a is None or b is None:
        return False
    na, nb = norm(a), norm(b)
    if na == nb:
        return True
    da, db = normalize_date(a), normalize_date(b)
    if da and db and re.search(r"\d{4}", str(a)) and re.search(r"\d{4}", str(b)):
        if da == db or da.startswith(db) or db.startswith(da):
            return True
    return na in nb or nb in na


def read_scan(path):
    return load_json(path, {}) or {}


# ——— 平台选择器 / 日期预设（assets/platform-selectors.json） ———
PLATFORM_PATH = os.path.join(REPO_DIR, "assets", "platform-selectors.json")


def load_platform():
    return load_json(PLATFORM_PATH, {}) or {}


def record_key(field, prefix=None):
    """给「多段经历」用的记录身份：(区块, 重复块序号)。
    这样同一张表里第 2 段教育经历不会和第 1 段抢同一个 record index。"""
    sec = field.get("section") or ""
    blk = field.get("block")
    blk = -1 if blk is None else int(blk)
    return (prefix or "", norm_label(sec), blk)


# ============================================================================
# 泄漏守卫：个人数据只许进 data/（被 .gitignore 排除），可发布文件里一律占位符
# ----------------------------------------------------------------------------
# 背景（2026-09-18 实测踩坑）：写站点 adapter 笔记时把「手机号/姓名/生日/籍贯/院校/专业/
# 本机路径」写进了 references/adapters/*.md —— 这些文件是**会随仓库发布**的。
# 旧守卫只扫手机号/邮箱/本机路径三种正则，抓不到姓名/生日/院校这类"看起来像正常文字"的值。
#
# 现在：**拿画像 + 问答记忆里的真实取值当黑名单**逐个去可发布文件里找（见 sensitive_tokens）。
# 想在某一行合法地写真实值（例如站点公开的省→市选项表），在该行加标记 `jaa-leak-allow`
# 显式声明；扫描跳过该行，并在报告里单列「已豁免」数量，便于审计。
# ============================================================================

LEAK_ALLOW_MARK = "jaa-leak-allow"

# 每种取值类型的替换建议（95_lint_notes.py --fix 用它自动脱敏）
LEAK_PLACEHOLDER = {
    "name": "<姓名>", "name_en": "<Name>",
    "phone": "<手机号>", "email": "<邮箱>", "id_number": "<身份证号>",
    "cert": "<证书编号>", "handle": "<GitHub 账号>", "account": "<账号>",
    "birth": "<YYYY-MM-DD>", "date": "<YYYY-MM>", "score": "<分数>",
    "province": "<省>", "city": "<市>", "county": "<县>", "place": "<省>/<市>", "address": "<地址>",
    "school": "<院校>", "major": "<专业>", "department": "<学院>",
    "company": "<单位>", "file": "<简历文件名>", "path": "<本机路径>", "qa": "<个人数据>", "other": "<个人数据>",
}

# 太通用的词 / 溯源用词：出现在文档里不算泄漏（否则「硕士/人工智能/留空」会把全仓库点亮）
LEAK_GENERIC = {
    "中国", "男", "女", "汉族", "无", "有", "是", "否", "未婚", "已婚", "群众", "党员", "团员", "共青团员",
    "本科", "硕士", "博士", "研究生", "学士", "全日制", "非全日制", "英语", "四级", "六级", "CET-4", "CET-6",
    "人工智能", "计算机", "软件工程", "物联网", "电子信息", "自动化", "通信工程", "大数据", "统计学",
    "应届", "往届", "国内", "海外", "其他", "其它", "普通高校", "中共党员", "预备党员", "无党派",
    # 表单口径 / 溯源用词（不是取值，写进笔记里也不构成泄漏）
    "留空", "不填", "未填", "空着", "不适用", "不需要", "保持现状", "待定", "待补", "待核", "面议",
    "不限", "均可", "都可以", "同上", "见上", "无要求", "暂无", "首次", "未提供", "用户提供", "用户确认",
    "用户选择", "用户填的", "用户作答", "用户手填", "档案", "国内院校", "国外院校", "其他院校", "港澳台院校",
    # ⚠️ 问答记忆里的「说明性长句」会被按分隔符拆成 token，这些是**字段名/填表口径**，不是取值：
    # 不列进来的话，“家庭电话/工作单位/职务”这类正常叙述会被误判成泄露（实测：2026-09-24 景嘉微笔记）。
    # 真实院校名/人名/号码仍由长 token 兜住，加这些词不会削弱守卫。
    "单位", "职务", "电话", "姓名", "名字", "亲属关系", "年龄为正整数", "父母同一号码", "同单位",
    "逐岗可能不同", "逐岗请再确认一次", "逐岗仍需确认", "填写前确认", "填本人手机", "填了也无效",
    "档案在学校", "实习地", "学校段", "六项都必填",
}

# 问答记忆里这些话题的**答案**含个人取值 → 也进黑名单
LEAK_QA_TOPICS = ("籍贯", "户口", "生源", "出生", "生日", "年龄", "家庭", "父母", "身份证", "证件号",  # jaa-leak-allow: 这是关键词表本身
                  "手机", "电话", "邮箱", "院校", "学校", "学院", "专业", "毕业", "档案", "姓名",  # jaa-leak-allow
                  "实习单位", "单位名称", "公司名称", "住址", "地址", "紧急联系", "婚", "政治面貌",  # jaa-leak-allow
                  "身高", "体重", "银行卡", "账号", "成绩", "排名")  # jaa-leak-allow

# 画像里要当敏感值的键（标量）
LEAK_PROFILE_KEYS = (
    ("personal.name", "name"), ("personal.name_en", "name_en"), ("meta.candidate", "name"),
    ("personal.phone", "phone"), ("personal.email", "email"), ("personal.id_number", "id_number"),
    ("personal.birth_date", "birth"), ("personal.cet6.cert_no", "cert"),
    ("personal.native_place", "province"), ("personal.hukou_location", "province"),
    ("personal.location", "province"), ("personal.native_place_full", "place"),
    ("personal.personnel_file_location", "school"),
    ("internship.display_name", "company"), ("internship.legal_name", "company"),
    ("internship.legal_rep", "name"), ("internship.address", "address"), ("internship.city", "place"),
)

# 画像里的列表：[(列表键, ((子字段, 类型), …)), …]
LEAK_PROFILE_LISTS = (
    ("education", (("school", "school"), ("major", "major"), ("department", "department"), ("city", "place"))),
    ("family", (("name", "name"), ("phone", "phone"), ("org", "company"), ("address", "address"))),
    ("experience", (("company", "company"), ("org", "company"), ("employer", "company"))),
)

_DATEISH_RE = re.compile(r"^[\d\s\-/.年月日]+$")
_ASCII_RE = re.compile(r"^[\x00-\x7f]+$")


def _leak_regex(token):
    """日期/纯数字类 token 要加边界（否则 '1999-09' 会误伤模板占位 1999-09-15）"""
    esc = re.escape(token)
    if _DATEISH_RE.match(token):
        return re.compile(r"(?<![\w./-])" + esc + r"(?![\w./-])")
    return re.compile(esc)


def _leak_add(out, value, kind):
    """把一个真实取值拆成若干敏感 token（级联值按分隔符拆；去掉太通用/太短的）"""
    if not isinstance(value, str):
        return
    v = value.strip()
    if not v:
        return
    cands = [v] + [p.strip() for p in re.split(r"[/、,，;；|]+", v)]
    for c in list(cands):                              # 省/市/县去掉行政区后缀再来一份（文档常写简称）
        core = re.sub(r"(省|市|县|区|自治区|特别行政区|自治州|地区)$", "", c)
        if core != c:
            cands.append(core)
    if kind == "birth":                                # 生日只当「完整日期」用（年月形态在本 skill 里和模板示例 1999-09-15 撞车，不当敏感值）
        pass
    for c in cands:
        c = c.strip().strip("（）()【】[]·")
        if len(c) < 2 or c in LEAK_GENERIC:
            continue
        if _ASCII_RE.match(c):
            if len(c) < 4 or c.lower() in ("true", "false", "null", "none", "n/a"):
                continue
            if re.fullmatch(r"\d+", c) and len(c) < 6:  # 短数字（分数/年份）不当敏感值
                continue
        elif re.fullmatch(r"[\d\s\-/.年月日]+", c) and len(c) < 6:
            continue
        ph = LEAK_PLACEHOLDER.get(kind, LEAK_PLACEHOLDER["other"])
        if kind == "place":                             # 级联值保留层级数，脱敏后读着仍是「三级/两级」
            parts = [p for p in re.split(r"[/、,，;；|]+", c) if p]
            ph = "<省>/<市>/<县>" if len(parts) >= 3 else "<省>/<市>"
        out.setdefault(c, {"token": c, "kind": kind, "placeholder": ph, "regex": _leak_regex(c)})


def _qa_kind(question):
    q = question or ""
    if any(k in q for k in ("出生", "生日")):
        return "birth"
    if any(k in q for k in ("手机", "电话", "联系方式")):
        return "phone"
    if "邮箱" in q:
        return "email"
    if any(k in q for k in ("身份证", "证件号")):
        return "id_number"
    if any(k in q for k in ("籍贯", "户口", "生源", "家庭住址", "地址", "住址")):
        return "place"
    if any(k in q for k in ("院校", "学校", "毕业院校")):
        return "school"
    if "专业" in q:
        return "major"
    if "学院" in q:
        return "department"
    if any(k in q for k in ("日期", "时间", "起止")):
        return "date"
    return "qa"


def sensitive_tokens(profile=None, dictionary=None, data_dir=None, extra=()):
    """把「画像 + 问答记忆」里的个人取值抽成敏感词表（带占位符建议）。
    返回 [{token, kind, placeholder, regex}]，按 token 长度降序（替换时先长后短）。"""
    d = data_dir or DATA_DIR
    prof = profile if profile is not None else (load_json(os.path.join(d, "profile.json"), {}) or {})
    dic = dictionary if dictionary is not None else (load_json(os.path.join(d, "memory", "dictionary.json"), {}) or {})
    out = {}
    for path, kind in LEAK_PROFILE_KEYS:
        _leak_add(out, dig(prof, path), kind)
    for listkey, fields in LEAK_PROFILE_LISTS:
        for item in (dig(prof, listkey) or []):
            if isinstance(item, dict):
                for sub, kind in fields:
                    _leak_add(out, item.get(sub), kind)
    for key in ("resume_files", "photo_file"):
        for p in (dig(prof, "meta." + key) or []):
            if isinstance(p, str):
                base = os.path.basename(p)
                _leak_add(out, base, "file")
                if len(base) > 12:                      # 长文件名才用去掉后缀的形态（避免 'agent' 这种通用词）
                    _leak_add(out, base.rsplit(".", 1)[0], "file")
    for atom in _profile_paths(prof):
        _leak_add_raw(out, atom, "path")
    for q, a in (dic.get("qa") or {}).items():
        if not q or q.startswith("_") or not isinstance(a, str):
            continue
        if any(t in q for t in LEAK_QA_TOPICS):
            _leak_add(out, a, _qa_kind(q))
    for value, kind in extra:
        _leak_add(out, value, kind)
    return sorted(out.values(), key=lambda t: -len(t["token"]))


_PATH_RUN_RE = re.compile(r"(?<![A-Za-z0-9])[A-Za-z]:[\\/][^\s（()），,、；;：:]*(?:[\\/][^\s（()），,、；;：:]*)*")


def _leak_add_raw(out, value, kind, min_len=8):
    """直接当敏感值（不拆分隔符）—— 路径/长文件名这类「整串才有意义」的东西"""
    if not isinstance(value, str):
        return
    v = value.strip()
    if len(v) < min_len:
        return
    out.setdefault(v, {"token": v, "kind": kind,
                       "placeholder": LEAK_PLACEHOLDER.get(kind, LEAK_PLACEHOLDER["other"]),
                       "regex": _leak_regex(v)})


def _profile_paths(profile):
    """画像里出现过的本机绝对路径 → 只取路径本体（去掉后面跟的中文标注）+ 各级目录前缀，
    正/反斜杠两种写法都收。写进笔记就能被抓到，又不会像通用网则那样误伤 https:// 和浏览器假路径。"""
    found = set()

    def walk(v):
        if isinstance(v, dict):
            for x in v.values():
                walk(x)
        elif isinstance(v, list):
            for x in v:
                walk(x)
        elif isinstance(v, str):
            for m in _PATH_RUN_RE.finditer(v.strip()):
                found.add(m.group(0).rstrip(".\\/"))

    walk(profile)
    atoms = set()
    for s in found:
        norm = s.replace("\\", "/")
        parts = [p for p in norm.split("/") if p]
        for i in range(len(parts), 0, -1):
            prefix = "/".join(parts[:i])
            if len(prefix) < 12:                # 只拓盘符+一级目录的前缀不当敏感值（太短会误伤）
                continue
            atoms.add(prefix)
            atoms.add(prefix.replace("/", "\\"))
    return atoms


def leak_scan_text(text, tokens, allow_mark=LEAK_ALLOW_MARK):
    """在一段文本里找敏感值；带 allow_mark 的行整行豁免。"""
    hits = []
    for i, line in enumerate((text or "").splitlines(), 1):
        if allow_mark and allow_mark in line:
            continue
        for t in tokens:
            if t["regex"].search(line):
                hits.append({"line": i, "token": t["token"], "kind": t["kind"],
                             "placeholder": t["placeholder"], "text": line.strip()[:200]})
    return hits


def redact_text(text, tokens, allow_mark=LEAK_ALLOW_MARK):
    """把文本里的敏感值换成占位符（长 token 优先），返回 (新文本, 替换次数, 明细)"""
    if isinstance(tokens, dict):
        tokens = sensitive_tokens(**tokens) if isinstance(tokens, dict) else tokens
    done = []
    lines = (text or "").splitlines(keepends=True)
    for i, line in enumerate(lines):
        if allow_mark and allow_mark in line:
            continue
        new = line
        for t in tokens:
            if t["regex"].search(new):
                n = len(t["regex"].findall(new))
                new = t["regex"].sub(t["placeholder"], new)
                done.append({"line": i + 1, "token": t["token"], "kind": t["kind"],
                             "placeholder": t["placeholder"], "count": n})
        lines[i] = new
    return "".join(lines), sum(d["count"] for d in done), done


def git_ignored(repo, rels):
    """哪些相对路径不会进仓库（git check-ignore 优先；非 git 仓库退回解析 .gitignore）。
    selftest 与 95_lint_notes.py 共用这一份实现，避免两处判定漂移。"""
    import fnmatch
    import subprocess
    out = set()
    try:
        p = subprocess.run(["git", "-C", repo, "check-ignore", "--stdin"],
                           input="\n".join(rels).encode("utf-8"), capture_output=True)
        out = {x.strip().strip('"').replace("\\", "/")
               for x in (p.stdout or b"").decode("utf-8", "replace").splitlines() if x.strip()}
    except Exception:
        out = set()
    try:
        pats = []
        for line in open(os.path.join(repo, ".gitignore"), encoding="utf-8"):
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


def publishable_files(repo_root=None):
    """会被发布的文件（相对路径，正斜杠）：排除 .git / __pycache__ / .gitignore 命中的东西"""
    repo = os.path.abspath(repo_root or REPO_DIR)
    rels = []
    for root, dirs, files in os.walk(repo):
        dirs[:] = [d for d in dirs if d not in (".git", "__pycache__", ".pytest_cache", "node_modules")]
        for fn in files:
            rels.append(os.path.relpath(os.path.join(root, fn), repo).replace("\\", "/"))
    ignored = git_ignored(repo, rels)
    return sorted(r for r in rels if r not in ignored)


def git_tracked(repo_root=None):
    """已进 git 索引的文件（真正会被发布的东西）；非 git 仓库返回空集"""
    repo = os.path.abspath(repo_root or REPO_DIR)
    try:
        import subprocess
        p = subprocess.run(["git", "-C", repo, "ls-files"], capture_output=True)
        return {x.strip().replace("\\", "/")
                for x in (p.stdout or b"").decode("utf-8", "replace").splitlines() if x.strip()}
    except Exception:
        return set()


def leak_scan(repo_root=None, tokens=None, paths=None, data_dir=None, allow_mark=LEAK_ALLOW_MARK):
    """扫描可发布文件里的个人数据。paths=相对(repo)或绝对路径列表；None=全仓库。"""
    repo = os.path.abspath(repo_root or REPO_DIR)
    toks = tokens if tokens is not None else sensitive_tokens(data_dir=data_dir)
    if paths:
        files = [p if os.path.isabs(p) else os.path.join(repo, p) for p in paths]
    else:
        files = [os.path.join(repo, r) for r in publishable_files(repo)]
    hits = []
    for fp in files:
        try:
            text = open(fp, encoding="utf-8").read()
        except Exception:
            continue
        try:
            rel = os.path.relpath(fp, repo).replace("\\", "/")
        except Exception:
            rel = fp
        for h in leak_scan_text(text, toks, allow_mark=allow_mark):
            h["file"] = rel
            hits.append(h)
    return hits


_PATH_CHARS = r"[^\s\"'`)\]}\uff08\uff09\uff0c,\u3001\uff1b;\uff1a:]*"

GENERIC_LEAK_RES = (
    ("phone", re.compile(r"(?<!\d)1[3-9]\d{9}(?!\d)"), "<手机号>"),
    ("email", re.compile(r"[\w.+-]+@[\w-]+\.[A-Za-z]{2,}"), "<邮箱>"),
    # (?<![A-Za-z0-9]) 是为了不误伤 https:// （'s:' 前面是字母）
    ("winpath", re.compile(r"(?<![A-Za-z0-9])[A-Za-z]:[\\/]{1,2}" + _PATH_CHARS), "<本机路径>"),
)

# 必然不是个人数据的例外：测试用邮箱域、浏览器给的假路径 C:\fakepath\...
GENERIC_LEAK_SKIP = (
    re.compile(r"@example\.(com|org|net)$", re.I),
    re.compile(r"^[A-Za-z]:[\\/]+fakepath", re.I),
)


def redact_generic(text, allow_mark=LEAK_ALLOW_MARK):
    """把通用网则命中的东西（手机号/邮箱/盘符路径）换成占位符；返回 (新文本, 次数, 明细)"""
    done = []
    lines = (text or "").splitlines(keepends=True)
    for i, line in enumerate(lines):
        if allow_mark and allow_mark in line:
            continue
        new = line
        for kind, rx, ph in GENERIC_LEAK_RES:
            parts, last, n = [], 0, 0
            for m in rx.finditer(new):
                tok = m.group(0)
                if any(s.search(tok) for s in GENERIC_LEAK_SKIP):
                    continue
                if kind == "winpath" and "fakepath" in tok.lower():
                    continue
                parts.append(new[last:m.start()])
                parts.append(ph)
                last = m.end()
                n += 1
                done.append({"line": i + 1, "token": tok, "kind": kind, "placeholder": ph, "count": 1})
            if n:
                parts.append(new[last:])
                new = "".join(parts)
        lines[i] = new
    return "".join(lines), sum(d["count"] for d in done), done


def leak_scan_generic(repo_root=None, paths=None, allow_mark=LEAK_ALLOW_MARK):
    """不依赖画像的通用检查（手机号 / 邮箱 / 本机盘符路径）—— 画像缺失时也能用"""
    repo = os.path.abspath(repo_root or REPO_DIR)
    files = paths or publishable_files(repo)
    hits = []
    for p in files:
        fp = p if os.path.isabs(p) else os.path.join(repo, p)
        try:
            text = open(fp, encoding="utf-8").read()
        except Exception:
            continue
        rel = os.path.relpath(fp, repo).replace("\\", "/")
        for i, line in enumerate(text.splitlines(), 1):
            if allow_mark and allow_mark in line:
                continue
            for kind, rx, ph in GENERIC_LEAK_RES:
                m = rx.search(line)
                if not m:
                    continue
                if any(s.search(m.group(0)) or ("fakepath" in line.lower() and kind == "winpath")
                       for s in GENERIC_LEAK_SKIP):
                    continue
                hits.append({"file": rel, "line": i, "kind": kind, "token": m.group(0),
                             "placeholder": ph, "text": line.strip()[:200]})
    return hits
