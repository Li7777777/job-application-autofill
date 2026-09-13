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
    """返回按分数降序的 [{text, score, why}]。**仅用于建议**：
    score >= AUTO_OPTION_THRESHOLD 才可直接落到 mapping，其余一律进 todo 让用户确认。"""
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
    """画像值能否满足页面要求的粒度？（页面要 day、值只有 month → False，必须问用户）"""
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
