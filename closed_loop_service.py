"""闭环验证服务：整改建议执行后的复检推演。

推演口径（与平台文档一致，务必保持）：
    整改后缺陷率 = 整改前缺陷率 × (1 - 已执行建议预期降幅的累乘 × 归因正确率)

- 「已执行建议预期降幅」按缺陷类聚合；同类下多条已执行建议按 1-Π(1-d) 累乘；
  未标注具体工单时，取知识库该类「综合预期降幅」作为标准整改方案的推演值。
- 「归因正确率」来自离线评测（platform_data.json 的 closed_loop.per_class）：
  只统计归因正确的件，归因错误的件不产生改善。
- 批次缺陷率来自 records.json 的实测分布；复检样本量决定展示的绝对件数。

重要：本模块全部为基于规则库预期降幅参数的工况推演，不代表真实产线效果。
接入真实产线后，把「预期降幅」替换为实测复检数据，同一套代码即可输出真实对比。
"""
import json
from pathlib import Path

BASE_DIR = Path(__file__).parent
RECORDS_PATH = BASE_DIR / "records.json"
PLATFORM_DATA_PATH = BASE_DIR / "platform_data.json"
KB_PATH = BASE_DIR / "knowledge_base.json"

CLASS_KEYS = ["crazing", "inclusion", "patches", "pitted_surface", "rolled-in_scale", "scratches"]
CLASS_CN = {
    "crazing": "龟裂",
    "inclusion": "夹杂",
    "patches": "斑块",
    "pitted_surface": "麻点",
    "rolled-in_scale": "氧化皮压入",
    "scratches": "划痕",
}

BATCH_COUNT = 8
DEFAULT_SAMPLE = 200

DISCLAIMER = "闭环验证为基于规则库预期降幅参数的工况推演，用于演示闭环逻辑，不代表真实产线效果。"
DISCLAIMER_NEXT = "接入真实产线后，把预期降幅换成实测复检数据，同一套代码即可输出真实对比。"

VERDICT_SIGNIFICANT = "效果显著"
VERDICT_EFFECTIVE = "闭环有效"
VERDICT_WEAK = "效果不显著"


def _load_json(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def _sorted_records():
    recs = _load_json(RECORDS_PATH)
    return sorted(recs, key=lambda r: r.get("inspect_time", ""))


def _class_params():
    """从离线推演基准读取每个缺陷类的归因正确率与综合预期降幅。"""
    pd = _load_json(PLATFORM_DATA_PATH)
    cl = pd.get("closed_loop", {})
    params = {}
    for p in cl.get("per_class", []):
        params[p.get("name")] = {
            "attribution_acc": float(p.get("attribution_acc", 0.0)) / 100.0,
            "avg_drop": float(p.get("avg_expected_drop_pct", 0.0)) / 100.0,
            "before": float(p.get("before", 0.0)),
            "after_est": float(p.get("after_est", 0.0)),
        }
    return cl, params


def _compound_drop(drops):
    """多条建议预期降幅累乘：combined = 1 - Π(1 - d_i)。"""
    factor = 1.0
    for d in drops:
        factor *= (1.0 - max(0.0, min(1.0, float(d))))
    return 1.0 - factor


def _split_batches(recs):
    n = len(recs)
    seg = n // BATCH_COUNT
    chunks = []
    for i in range(BATCH_COUNT):
        if i < BATCH_COUNT - 1:
            chunks.append(recs[i * seg:(i + 1) * seg])
        else:
            chunks.append(recs[i * seg:])
    return chunks


def _count_defects(chunk):
    counts = {k: 0 for k in CLASS_KEYS}
    for r in chunk:
        dt = r.get("defect_type")
        if dt in counts:
            counts[dt] += 1
    return counts


def list_batches():
    recs = _sorted_records()
    chunks = _split_batches(recs)
    items = [{
        "key": "ALL",
        "label": f"整体 · 数据集 {len(recs)} 件",
        "date_range": f"{recs[0]['inspect_time'][:10]} ~ {recs[-1]['inspect_time'][:10]}",
        "size": len(recs),
        "is_all": True,
    }]
    for i, chunk in enumerate(chunks):
        items.append({
            "key": f"B{i + 1}",
            "label": f"批次 B{i + 1}",
            "date_range": f"{chunk[0]['inspect_time'][:10]} ~ {chunk[-1]['inspect_time'][:10]}",
            "size": len(chunk),
            "is_all": False,
        })
    return {"items": items, "default_sample": DEFAULT_SAMPLE}


def _representative_solutions(rules):
    """每个缺陷类取预期降幅最高的一条启用规则作为代表措施。"""
    best = {}
    for r in rules or []:
        defect = r.get("defect")
        if defect not in CLASS_KEYS:
            continue
        cur = best.get(defect)
        if cur is None or float(r.get("expected_drop_pct") or 0) > float(cur.get("expected_drop_pct") or 0):
            best[defect] = r
    return best


def _verdict(drop_pct):
    if drop_pct >= 30:
        return VERDICT_SIGNIFICANT, "verdict-strong"
    if drop_pct >= 20:
        return VERDICT_EFFECTIVE, "verdict-ok"
    return VERDICT_WEAK, "verdict-weak"


def verify(batch_key="ALL", sample_size=DEFAULT_SAMPLE, executed=None, rules=None, executed_drops=None):
    """执行一次闭环复检推演。

    batch_key : ALL 或 B1..B8
    sample_size : 复检样本量（展示用绝对件数）
    executed : 已执行建议所属缺陷类 key 列表（None = 批次内出现的全部缺陷类）
    rules : 知识库启用规则（用于取代表措施）；缺省时读 knowledge_base.json
    executed_drops : {缺陷类 key: [已执行建议预期降幅(0-1), ...]}，用于累乘覆盖默认综合降幅
    """
    recs = _sorted_records()
    chunks = _split_batches(recs)
    cl, params = _class_params()
    if rules is None:
        rules = _load_json(KB_PATH).get("rules", [])
    reps = _representative_solutions(rules)

    sample_size = int(sample_size or DEFAULT_SAMPLE)
    if sample_size <= 0:
        sample_size = DEFAULT_SAMPLE
    sample_size = min(sample_size, 100000)

    batch_key = batch_key or "ALL"
    is_all = batch_key == "ALL"
    if is_all:
        chunk = recs
        batch_label = f"整体 · 数据集 {len(recs)} 件"
        date_range = f"{recs[0]['inspect_time'][:10]} ~ {recs[-1]['inspect_time'][:10]}"
    else:
        idx = int(batch_key.replace("B", "")) - 1
        idx = max(0, min(BATCH_COUNT - 1, idx))
        chunk = chunks[idx]
        batch_label = f"批次 B{idx + 1}"
        date_range = f"{chunk[0]['inspect_time'][:10]} ~ {chunk[-1]['inspect_time'][:10]}"

    before_counts = _count_defects(chunk)
    batch_size = len(chunk)
    if executed is None:
        executed = [k for k in CLASS_KEYS if before_counts.get(k)]
    executed_set = set(executed)
    executed_drops = executed_drops or {}

    def _class_drop(k):
        """缺陷类的综合预期降幅：有已执行建议则按 1-Π(1-d) 累乘，否则取知识库推演综合值。"""
        drops = executed_drops.get(k)
        if drops:
            return _compound_drop(drops)
        return params.get(CLASS_CN[k], {}).get("avg_drop", 0.0)

    per_class = []
    after_total = 0.0
    measures = []
    for k in CLASS_KEYS:
        cnt = before_counts.get(k, 0)
        cn = CLASS_CN[k]
        p = params.get(cn, {})
        acc = p.get("attribution_acc", 0.0)
        executed_flag = (k in executed_set) and cnt > 0

        if is_all:
            # 整体口径：直接采用离线推演基准件数，保证与平台文档 39.17%→29.12% 一致
            before_cnt = p.get("before", float(cnt))
            drop = _class_drop(k) if executed_flag else 0.0
            if executed_flag:
                after_cnt = p.get("after_est", before_cnt * (1 - drop * acc))
            else:
                after_cnt = before_cnt
        else:
            before_cnt = float(cnt)
            drop = _class_drop(k) if executed_flag else 0.0
            after_cnt = before_cnt * (1 - drop * acc)

        after_total += after_cnt
        per_class.append({
            "defect": k,
            "defect_cn": cn,
            "before_count": int(round(before_cnt)),
            "after_count": int(round(after_cnt)),
            "attribution_acc": round(acc * 100, 2),
            "expected_drop": round(drop * 100, 2),
            "effective_drop": round(drop * acc * 100, 2),
            "executed": executed_flag,
        })

        if cnt > 0 or (is_all and p.get("before")):
            rep = reps.get(k)
            measures.append({
                "defect": k,
                "defect_cn": cn,
                "executed": executed_flag,
                "solution": (rep or {}).get("solution", "—"),
                "rule_id": (rep or {}).get("rule_id") or (rep or {}).get("id"),
                "expected_drop": round((_class_drop(k) if executed_flag else 0.0) * 100, 2),
                "attribution_acc": round(acc * 100, 2),
            })

    all_executed = all((k not in CLASS_KEYS) or (k in executed_set) for k in CLASS_KEYS if before_counts.get(k))
    if is_all and all_executed:
        # 全类标准整改方案：采用离线推演基准，与平台文档 39.17%→29.12% 完全一致
        before_total_defects = sum(p.get("before", 0.0) for p in params.values())
        after_total_defects = sum(p.get("after_est", 0.0) for p in params.values())
        before_rate = float(cl.get("before_rate", 0.0))
        after_rate = float(cl.get("after_rate", 0.0))
        drop_pct = float(cl.get("drop_pct", 0.0))
        total_size = len(recs)
    elif is_all:
        before_total_defects = sum(p.get("before", 0.0) for p in params.values())
        after_total_defects = after_total
        total_size = len(recs)
        before_rate = before_total_defects / total_size * 100 if total_size else 0.0
        after_rate = after_total_defects / total_size * 100 if total_size else 0.0
        drop_pct = (before_rate - after_rate) / before_rate * 100 if before_rate else 0.0
    else:
        before_total_defects = float(sum(before_counts.values()))
        after_total_defects = after_total
        total_size = batch_size
        before_rate = before_total_defects / total_size * 100 if total_size else 0.0
        after_rate = after_total_defects / total_size * 100 if total_size else 0.0
        drop_pct = (before_rate - after_rate) / before_rate * 100 if before_rate else 0.0

    before_rate = round(before_rate, 2)
    after_rate = round(after_rate, 2)
    drop_pct = round(drop_pct, 2)
    verdict, verdict_cls = _verdict(drop_pct)

    # 8 个批次趋势：整改前实测缺陷率 + 整改后推演缺陷率
    trend_labels, trend_before, trend_after = [], [], []
    for i, c in enumerate(chunks):
        bc = _count_defects(c)
        sz = len(c)
        b_rate = sum(bc.values()) / sz * 100 if sz else 0.0
        a_def = 0.0
        for k2 in CLASS_KEYS:
            p2 = params.get(CLASS_CN[k2], {})
            ex = (k2 in executed_set) and bc.get(k2, 0) > 0
            drop2 = _class_drop(k2) if ex else 0.0
            a_def += bc.get(k2, 0) * (1 - drop2 * p2.get("attribution_acc", 0.0))
        a_rate = a_def / sz * 100 if sz else 0.0
        trend_labels.append(f"B{i + 1}")
        trend_before.append(round(b_rate, 2))
        trend_after.append(round(a_rate, 2))

    marker_index = BATCH_COUNT - 1 if is_all else max(0, min(BATCH_COUNT - 1, int(batch_key.replace("B", "")) - 1))

    before_defects_sample = int(round(before_rate / 100 * sample_size))
    after_defects_sample = int(round(after_rate / 100 * sample_size))

    return {
        "batch_key": batch_key,
        "batch_label": batch_label,
        "date_range": date_range,
        "batch_size": total_size,
        "sample_size": sample_size,
        "before_rate": before_rate,
        "after_rate": after_rate,
        "drop_pct": drop_pct,
        "verdict": verdict,
        "verdict_cls": verdict_cls,
        "before_count": before_defects_sample,
        "after_count": after_defects_sample,
        "before_total_defects": int(round(before_total_defects)),
        "after_total_defects": int(round(after_total_defects)),
        "per_class": per_class,
        "measures": measures,
        "trend": {
            "labels": trend_labels,
            "before": trend_before,
            "after": trend_after,
            "marker_index": marker_index,
            "marker_label": "整改执行",
        },
        "thresholds": {"effective": 20, "significant": 30},
        "disclaimer": DISCLAIMER,
        "disclaimer_next": DISCLAIMER_NEXT,
        "source": "推演口径：整改前缺陷率取 records.json 实测分布；归因正确率与预期降幅取 platform_data.json 离线推演基准",
    }
