"""分析看板聚合服务：一页聚合的看板数据。

数据来源优先级：platform_data.json（离线评测产物）。
- 指标卡、缺陷分布、严重等级分布、根因维度分布、月度趋势直接取自 platform_data.json；
- Top5 根因按 records.json 的评测真实根因统计命中次数，并回连规则库取策略文案；
- 平均处置时长取工单生命周期（无已完成工单时返回 None）。
不引入任何随机数或编造数据。
"""
import json
from collections import Counter
from datetime import datetime

BASE_DIR_PARENT = None

DIMENSION_CN = {
    "equipment": "设备参数",
    "material": "物料批次",
    "operator": "人员操作",
    "environment": "环境条件",
}


def _load(path):
    return json.loads(open(path, encoding="utf-8").read())


def _effective_drop(p):
    """缺陷类闭环有效降幅 = 综合预期降幅 × 归因正确率。"""
    return float(p.get("avg_expected_drop_pct", 0.0)) * float(p.get("attribution_acc", 0.0)) / 100.0


def build(platform_path, records_path, avg_handle_hours=None, handle_note=None):
    pd = _load(platform_path)
    meta = pd.get("meta", {})
    kpi = pd.get("kpi", {})
    closed = pd.get("closed_loop", {})
    per_class = closed.get("per_class", [])
    trend = pd.get("monthly_trend", [])

    n_ok = sum(1 for p in per_class if _effective_drop(p) >= 20.0)
    closed_rate = round(n_ok / len(per_class) * 100, 2) if per_class else 0.0

    cards = [
        {
            "key": "records",
            "label": "累计检测数",
            "value": f"{int(meta.get('record_count', 0))}",
            "unit": "件",
            "note": f"评测集 defect_count={int(meta.get('defect_count', 0))}",
            "hint": "来自 platform_data.json · meta.record_count（离线评测）",
        },
        {
            "key": "defect_rate",
            "label": "缺陷率",
            "value": f"{meta.get('defect_rate', 0)}",
            "unit": "%",
            "note": "缺陷数 / 检测总数（离线评测）",
            "hint": "来自 platform_data.json · meta.defect_rate",
        },
        {
            "key": "handle",
            "label": "平均处置时长",
            "value": "--" if avg_handle_hours is None else f"{avg_handle_hours:.1f}",
            "unit": "" if avg_handle_hours is None else "h",
            "note": handle_note or "工单从创建到处置的平均时长",
            "hint": "取工单 created_at → updated_at 的平均时长，样本不足时仅显示待积累",
        },
        {
            "key": "closed_rate",
            "label": "闭环达标率",
            "value": f"{closed_rate}",
            "unit": "%",
            "note": f"{n_ok}/{len(per_class)} 类缺陷闭环降幅 ≥20%（整体 {closed.get('drop_pct', 0)}%）",
            "hint": "基于复检历史中达标次数占比",
        },
    ]

    # Top5 根因命中次数：按 records.json 真实根因统计，回连规则库取策略
    try:
        recs = _load(records_path)
    except Exception:
        recs = []
    counter = Counter(r.get("true_root_cause") for r in recs if r.get("true_root_cause"))
    rules_by_cause = {r.get("root_cause"): r for r in pd.get("rules", [])}
    top = []
    for cause, cnt in counter.most_common(5):
        rule = rules_by_cause.get(cause, {})
        top.append({
            "root_cause": cause,
            "dimension": rule.get("dimension"),
            "dimension_cn": DIMENSION_CN.get(rule.get("dimension"), "—"),
            "defect_cn": rule.get("defect_cn", "—"),
            "strategy": rule.get("solution", "—"),
            "expected_drop_pct": rule.get("expected_drop_pct"),
            "executable": rule.get("executable"),
            "hits": int(cnt),
        })

    total_hits = sum(counter.values()) or 1
    for item in top:
        item["share"] = round(item["hits"] / total_hits * 100, 2)

    trend_note = None
    trend_title = "缺陷率趋势"
    if trend:
        span = f"{trend[0]['month']} ~ {trend[-1]['month']}"
        trend_title = f"近 {len(trend)} 个月缺陷率趋势（数据集覆盖 {span}）"
        if len(trend) < 12:
            trend_note = f"数据源 monthly_trend 覆盖 {span} 共 {len(trend)} 个月，为数据集真实范围"

    return {
        "cards": cards,
        "defect_distribution": pd.get("defect_distribution", []),
        "severity_distribution": pd.get("severity_distribution", []),
        "dimension_distribution": pd.get("dimension_distribution", []),
        "monthly_trend": trend,
        "trend_title": trend_title,
        "trend_note": trend_note,
        "top_root_causes": top,
        "meta": {
            "record_count": meta.get("record_count"),
            "defect_count": meta.get("defect_count"),
            "defect_rate": meta.get("defect_rate"),
            "generated_from": meta.get("generated_from"),
        },
        "source": "看板数据来源：platform_data.json（离线评测产物）；Top5 根因命中次数按 records.json 评测真实根因统计",
    }
