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
    """把一个页面字段名映射到 canonical key。返回 (key, confidence, matched_alias)"""
    if not label:
        return None, None, None
    n = norm(label)
    if len(n) < min_len:
        return None, None, None
    best = None
    for key, meta in (dictionary.get("canonical") or {}).items():
        for a in meta.get("aliases", []):
            na = norm(a)
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
    """问答记忆：问题原文 → 答案（精确 → 包含）"""
    qa = {k: v for k, v in (dictionary.get("qa") or {}).items() if not k.startswith("_")}
    n = norm(label)
    for q, a in qa.items():
        if norm(q) == n:
            return a, "high", q
    for q, a in qa.items():
        nq = norm(q)
        if len(nq) >= 4 and (nq in n or n in nq):
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
