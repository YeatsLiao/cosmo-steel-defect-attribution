"""改进建议生成与可执行率判定。

判定规则（三条同时满足才算可执行）：
1. 含具体数值：文本中出现阿拉伯数字；
2. 含量化依据：出现物理量纲，或 ≥ / ≤，或数值区间，或可数单位；
3. 不含空泛口号词：加强 / 重视 / 意识 / 责任心。
"""
import re

import db

VAGUE_WORDS = ["加强", "重视", "意识", "责任心"]

PHYSICAL_UNITS = [
    "℃", "°C", "℃/s", "MPa", "m/s", "kN", "mm", "μm", "mg/m³", "mg/m3",
    "%", "min", "bar", "Hz", "L/min", "V", "A", "s",
]
COUNTABLE_UNITS = [
    "道次", "卷", "次", "班次", "学时", "小时", "分钟", "名", "级", "个",
    "批", "炉", "台", "套", "点", "工位",
]

CRITERIA = [
    {"key": "number", "label": "含具体数值", "desc": "解决策略中出现明确的阿拉伯数字"},
    {"key": "quantity", "label": "含量化依据",
     "desc": "出现物理量纲（如 ℃ / MPa / m/s / % / mg/m³）、≥ / ≤、数值区间或可数单位（如 道次 / 卷 / 班次）"},
    {"key": "no_vague", "label": "不含空泛口号词",
     "desc": "不出现「加强 / 重视 / 意识 / 责任心」等无法落地的表述"},
]


def judge(solution):
    text = solution or ""
    has_number = bool(re.search(r"\d", text))
    has_quantity = (
        any(u in text for u in PHYSICAL_UNITS)
        or any(u in text for u in COUNTABLE_UNITS)
        or bool(re.search(r"[≥≤]", text))
        or bool(re.search(r"\d+(?:\.\d+)?\s*[-~]\s*\d+", text))
    )
    vague_hits = [w for w in VAGUE_WORDS if w in text]
    no_vague = not vague_hits
    return {
        "executable": bool(has_number and has_quantity and no_vague),
        "checks": {
            "number": has_number,
            "quantity": has_quantity,
            "no_vague": no_vague,
        },
        "vague_hits": vague_hits,
    }


def stats(db_path):
    rules = db.list_kb_rules(db_path)
    items = []
    executable = 0
    for r in rules:
        j = judge(r.get("solution", ""))
        if j["executable"]:
            executable += 1
        items.append({
            "rule_id": r.get("rule_id"),
            "defect_cn": r.get("defect_cn"),
            "root_cause": r.get("root_cause"),
            "solution": r.get("solution"),
            "expected_drop_pct": r.get("expected_drop_pct"),
            "enabled": r.get("enabled"),
            "executable": j["executable"],
            "checks": j["checks"],
        })
    total = len(rules)
    rate = round(executable / total * 100, 2) if total else 0.0
    return {
        "total": total,
        "executable": executable,
        "rate": rate,
        "criteria": CRITERIA,
        "items": items,
        "source": "判定对象：知识库当前规则的全部解决策略（knowledge_base.json 导入 30 条）",
    }
