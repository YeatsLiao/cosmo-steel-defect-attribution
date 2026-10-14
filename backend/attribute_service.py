"""归因诊断服务：复用 attribution_engine.py + knowledge_base.json，不重写规则。

只做四件事：
1. 表单 schema 与典型场景（默认值、一键载入）的元数据组装；
2. 入参类型规整与字段缺失检测；
3. 用数据库中的启用规则构建引擎（支持知识库启停/编辑），规则结构仍原样交给 attribution_engine；
4. 对缺失字段涉及的维度做「数据不足」标注与贡献度再归一化。
"""
import json

from . import attribution_engine as ae
from . import db
from . import fields
from . import suggestion_service
from .paths import DB_PATH, KB_PATH, PLATFORM_DATA_PATH, RECORDS_PATH

FIELD_META = fields.FIELD_META
FIELD_DIM = fields.FIELD_DIM
DEFECT_CN = ae.DEFECT_CN

NUMERIC_FIELDS = {
    "roll_temp", "roll_speed", "tension", "descaling_pressure", "roll_gap",
    "reduction_rate", "mn_s_ratio", "refine_time", "env_temp", "env_humidity",
    "dust", "cooling_water_temp",
}
INT_FIELDS = {"skill_level", "flux_batch_abnormal", "first_coil_after_roll_change"}

REQUIRED_FIELDS = {
    "crazing": ["roll_temp", "reduction_rate", "mn_s_ratio"],
    "inclusion": ["refine_time", "flux_batch_abnormal", "skill_level"],
    "patches": ["roll_gap", "first_coil_after_roll_change", "env_humidity"],
    "pitted_surface": ["dust", "env_humidity", "descaling_pressure"],
    "rolled-in_scale": ["descaling_pressure", "roll_temp", "skill_level"],
    "scratches": ["tension", "roll_speed", "skill_level"],
}

CANDIDATE_FIELD = {
    "轧制温度偏低导致热塑性不足": "roll_temp",
    "单道次压下率过大": "reduction_rate",
    "Mn/S 比偏低导致晶界热脆": "mn_s_ratio",
    "精炼时间不足导致夹杂物未充分上浮": "refine_time",
    "保护渣批次异常卷入": "flux_batch_abnormal",
    "低技能等级班组操作规范性不足": "skill_level",
    "低技能班组操作不当": "skill_level",
    "未按工艺卡执行除鳞检查": "skill_level",
    "轧辊表面磨损或粘着脱落": "roll_gap",
    "换辊后首卷辊面未磨合": "first_coil_after_roll_change",
    "环境湿度过高加剧辊面腐蚀斑": "env_humidity",
    "环境湿度过高导致存放期返锈麻面": "env_humidity",
    "粉尘浓度过高在表面形成点蚀麻点": "dust",
    "除鳞水压力不足": "descaling_pressure",
    "出炉温度过高导致厚氧化层": "roll_temp",
    "张力设定过大造成相对滑动": "tension",
    "导位对中不良与带钢跑偏": "roll_speed",
}

DEFAULT_CONTEXT = {
    "roll_temp": 1207.4, "roll_speed": 4.1, "tension": 27.3,
    "descaling_pressure": 12.4, "roll_gap": 2.5, "reduction_rate": 20.1,
    "steel_grade": "SS400", "heat_no": "H2470", "mn_s_ratio": 26.4,
    "flux_batch_abnormal": 0, "refine_time": 43.1,
    "shift_team": "甲班", "skill_level": 4, "first_coil_after_roll_change": 0,
    "shift": "day", "env_temp": 28.1, "env_humidity": 53.2,
    "dust": 5.1, "cooling_water_temp": 30.4,
}

SCHEMA_GROUPS = [
    {"title": "设备参数", "fields": [
        {"key": "roll_temp", "type": "number", "step": 1},
        {"key": "roll_speed", "type": "number", "step": 0.1},
        {"key": "tension", "type": "number", "step": 0.1},
        {"key": "descaling_pressure", "type": "number", "step": 0.1},
        {"key": "roll_gap", "type": "number", "step": 0.1},
        {"key": "reduction_rate", "type": "number", "step": 0.1},
    ]},
    {"title": "物料信息", "fields": [
        {"key": "steel_grade", "type": "select", "options": [
            {"label": "Q235B", "value": "Q235B"},
            {"label": "SPHC", "value": "SPHC"},
            {"label": "SS400", "value": "SS400"},
        ]},
        {"key": "heat_no", "type": "text"},
        {"key": "mn_s_ratio", "type": "number", "step": 0.1},
        {"key": "flux_batch_abnormal", "type": "select", "options": [
            {"label": "正常", "value": 0}, {"label": "异常", "value": 1},
        ]},
        {"key": "refine_time", "type": "number", "step": 0.1},
    ]},
    {"title": "人员", "fields": [
        {"key": "shift_team", "type": "select", "options": [
            {"label": "甲班", "value": "甲班"},
            {"label": "乙班", "value": "乙班"},
            {"label": "丙班", "value": "丙班"},
        ]},
        {"key": "skill_level", "type": "select", "options": [
            {"label": str(i), "value": i} for i in range(1, 6)
        ]},
        {"key": "first_coil_after_roll_change", "type": "select", "options": [
            {"label": "否", "value": 0}, {"label": "是", "value": 1},
        ]},
        {"key": "shift", "type": "select", "options": [
            {"label": "白班", "value": "day"}, {"label": "夜班", "value": "night"},
        ]},
    ]},
    {"title": "环境", "fields": [
        {"key": "env_temp", "type": "number", "step": 0.1},
        {"key": "env_humidity", "type": "number", "step": 0.1},
        {"key": "dust", "type": "number", "step": 0.1},
        {"key": "cooling_water_temp", "type": "number", "step": 0.1},
    ]},
]


def get_engine():
    """用数据库中的启用规则构建引擎；库为空时回退到 knowledge_base.json。"""
    kb = ae.load_kb(KB_PATH)
    try:
        rows = db.list_kb_rules(DB_PATH, enabled_only=True)
    except Exception:
        rows = []
    if rows:
        kb = dict(kb)
        kb["rules"] = [{
            "id": r.get("rule_id"),
            "defect": r.get("defect"),
            "defect_cn": r.get("defect_cn"),
            "dimension": r.get("dimension"),
            "root_cause": r.get("root_cause"),
            "conditions": r.get("conditions") or [],
            "solution": r.get("solution"),
            "expected_drop_pct": r.get("expected_drop_pct"),
        } for r in rows]
    return ae.AttributionEngine(kb)


def _coerce(context):
    out = {}
    for key, val in (context or {}).items():
        if val is None or val == "":
            continue
        if key in INT_FIELDS:
            try:
                out[key] = int(float(val))
            except (TypeError, ValueError):
                continue
        elif key in NUMERIC_FIELDS:
            try:
                out[key] = float(val)
            except (TypeError, ValueError):
                continue
        else:
            out[key] = val
    return out


def _rule_threshold(engine, defect_type, field):
    for name in ae.DEFECT_CANDIDATES.get(defect_type, []):
        rule = engine._by_cause.get(name)
        if not rule:
            continue
        for cond in rule.get("conditions", []):
            if cond["field"] == field or CANDIDATE_FIELD.get(name) == field:
                return cond["value"]
    return 0


def build_schema():
    groups = []
    for group in SCHEMA_GROUPS:
        flds = []
        for spec in group["fields"]:
            key = spec["key"]
            label, unit = FIELD_META.get(key, (key, ""))
            item = {
                "key": key, "label": label, "unit": unit,
                "type": spec["type"], "default": DEFAULT_CONTEXT.get(key),
                "dimension": FIELD_DIM.get(key),
            }
            if "step" in spec:
                item["step"] = spec["step"]
            if "options" in spec:
                item["options"] = spec["options"]
            flds.append(item)
        groups.append({"title": group["title"], "fields": flds})

    pd = json.loads(PLATFORM_DATA_PATH.read_text(encoding="utf-8"))
    records = {r["record_id"]: r for r in json.loads(RECORDS_PATH.read_text(encoding="utf-8"))}

    scenarios = []
    demos = []
    for demo in pd.get("attribution_demos", []):
        rid = demo.get("record_id")
        rec = records.get(rid, {})
        ctx = dict(DEFAULT_CONTEXT)
        ctx.update(rec.get("context", {}))
        if demo.get("steel_grade"):
            ctx["steel_grade"] = demo["steel_grade"]
        scenarios.append({
            "defect_type": demo.get("defect_type"),
            "defect_cn": demo.get("defect_cn"),
            "record_id": rid,
            "steel_grade": demo.get("steel_grade"),
            "severity": demo.get("severity"),
            "context": ctx,
        })
        demos.append({k: v for k, v in demo.items()})

    return {
        "defect_types": [{"key": k, "cn": v} for k, v in DEFECT_CN.items()],
        "dimension_types": [{"key": k, "cn": v} for k, v in fields.DIMENSION_CN.items()],
        "groups": groups,
        "default_context": DEFAULT_CONTEXT,
        "scenarios": scenarios,
        "demos": demos,
        "source": "归因依据：attribution_engine.py + knowledge_base.json（离线规则引擎）",
    }


def run_attribution(defect_type, context):
    if defect_type not in REQUIRED_FIELDS:
        return {"error": "未知缺陷类型", "defect_type": defect_type}

    engine = get_engine()
    ctx = _coerce(context)
    required = REQUIRED_FIELDS[defect_type]
    missing = [f for f in required if f not in ctx]

    safe = dict(ctx)
    for f in missing:
        safe[f] = _rule_threshold(engine, defect_type, f)

    try:
        out = engine.attribute(defect_type, safe)
    except Exception as exc:
        return {"error": f"归因计算失败：{exc}", "defect_type": defect_type}

    dim_req = {}
    for f in required:
        dim_req.setdefault(FIELD_DIM[f], []).append(f)
    insufficient = {d for d, fs in dim_req.items() if all(f in missing for f in fs)}

    contributions = []
    for c in out["contributions"]:
        evidence = []
        for e in c.get("evidence", []):
            if e["field"] in missing:
                continue
            label, unit = FIELD_META.get(e["field"], (e["field"], ""))
            evidence.append({**e, "field_label": label, "unit": unit})
        contributions.append({
            "dimension": c["dimension"],
            "dimension_cn": c["dimension_cn"],
            "score": 0.0 if c["dimension"] in insufficient else c["score"],
            "evidence": evidence,
            "insufficient": c["dimension"] in insufficient,
        })

    present = [c for c in contributions if not c["insufficient"]]
    total = sum(c["score"] for c in present)
    for c in contributions:
        if c["insufficient"]:
            c["score"] = 0.0
        else:
            c["score"] = round(c["score"] / total * 100, 2) if total > 0 else 0.0
    contributions.sort(key=lambda x: -x["score"])

    candidates = [c for c in out["candidates"]
                  if CANDIDATE_FIELD.get(c["root_cause"]) not in missing]
    top = candidates[0] if candidates else None
    others = candidates[1:] if candidates else []
    for c in others:
        c["executable"] = suggestion_service.judge(c.get("solution", ""))["executable"]

    missing_meta = [
        {"field": f, "label": FIELD_META.get(f, (f, ""))[0],
         "dimension": FIELD_DIM.get(f), "dimension_cn": fields.DIMENSION_CN.get(FIELD_DIM.get(f))}
        for f in missing
    ]
    insufficient_cn = [fields.DIMENSION_CN[d] for d in fields.DIMENSION_CN if d in insufficient]

    return {
        "defect_type": defect_type,
        "defect_cn": DEFECT_CN.get(defect_type, defect_type),
        "top_root_cause": top["root_cause"] if top else None,
        "top_dimension_cn": top["dimension_cn"] if top else None,
        "top_rule_id": out["top_rule_id"] if top and top["root_cause"] == out["top_root_cause"] else None,
        "confidence": top["strength"] if top else 0.0,
        "solution": top["solution"] if top else None,
        "expected_drop_pct": top.get("expected_drop_pct") if top else None,
        "solution_executable": suggestion_service.judge(top["solution"]).get("executable") if top else None,
        "has_hit": any(c["hit"] for c in candidates),
        "contributions": contributions,
        "candidates": others,
        "missing_fields": missing_meta,
        "insufficient_dimensions": insufficient_cn,
        "source": "归因结果来源：attribution_engine.py + knowledge_base.json（离线规则引擎）",
    }
