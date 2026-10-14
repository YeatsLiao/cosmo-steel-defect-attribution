"""钢材表面缺陷根因归因引擎（参考实现）。

零第三方依赖，Python 3.8+ 可直接运行，可原样搬进 FastAPI 后端。

设计要点：
1. 归因不是"命中就给结论"，而是先按缺陷类型收窄候选根因，再按工艺参数偏离阈值的程度打分。
2. 输出四维贡献度（设备 / 物料 / 人员 / 环境）排序，回答"凭什么说是它"。
3. 每条根因绑定具体的整改建议与预期降幅，供闭环验证使用。

用法：
    engine = AttributionEngine(kb)
    result = engine.attribute("pitted_surface", {...19 项工艺参数...})
"""
import json
from pathlib import Path

DIMENSION_CN = {
    "equipment": "设备参数",
    "material": "物料批次",
    "operator": "人员操作",
    "environment": "环境条件",
}

# 每条根因的判定函数：读入工艺上下文字典，返回 True 表示命中该异常。
# 与 generate_records.py 的 CHECKS 保持一致，便于复算 92.13% 这个数字。
CHECKS = [
    ("轧制温度偏低导致热塑性不足", lambda c: c["roll_temp"] < 1100),
    ("单道次压下率过大", lambda c: c["reduction_rate"] > 30),
    ("Mn/S 比偏低导致晶界热脆", lambda c: c["mn_s_ratio"] < 15),
    ("精炼时间不足导致夹杂物未充分上浮", lambda c: c["refine_time"] < 25),
    ("保护渣批次异常卷入", lambda c: c["flux_batch_abnormal"] == 1),
    ("低技能等级班组操作规范性不足", lambda c: c["skill_level"] < 3),
    ("低技能班组操作不当", lambda c: c["skill_level"] < 3),
    ("未按工艺卡执行除鳞检查", lambda c: c["skill_level"] < 3),
    ("轧辊表面磨损或粘着脱落", lambda c: c["roll_gap"] > 3.5),
    ("换辊后首卷辊面未磨合", lambda c: c["first_coil_after_roll_change"] == 1),
    ("环境湿度过高加剧辊面腐蚀斑", lambda c: c["env_humidity"] > 75),
    ("环境湿度过高导致存放期返锈麻面", lambda c: c["env_humidity"] > 75),
    ("粉尘浓度过高在表面形成点蚀麻点", lambda c: c["dust"] > 12),
    ("除鳞水压力不足", lambda c: c["descaling_pressure"] < 15),
    ("出炉温度过高导致厚氧化层", lambda c: c["roll_temp"] > 1250),
    ("张力设定过大造成相对滑动", lambda c: c["tension"] > 45),
    ("导位对中不良与带钢跑偏", lambda c: c["roll_speed"] > 6.0),
]

# 缺陷类型 → 候选根因。真实归因里先验知识会把 17 条根因收窄到 3 条。
DEFECT_CANDIDATES = {
    "crazing": ["轧制温度偏低导致热塑性不足", "单道次压下率过大", "Mn/S 比偏低导致晶界热脆"],
    "inclusion": ["精炼时间不足导致夹杂物未充分上浮", "保护渣批次异常卷入", "低技能等级班组操作规范性不足"],
    "patches": ["轧辊表面磨损或粘着脱落", "换辊后首卷辊面未磨合", "环境湿度过高加剧辊面腐蚀斑"],
    "pitted_surface": ["粉尘浓度过高在表面形成点蚀麻点", "环境湿度过高导致存放期返锈麻面", "除鳞水压力不足"],
    "rolled-in_scale": ["除鳞水压力不足", "出炉温度过高导致厚氧化层", "未按工艺卡执行除鳞检查"],
    "scratches": ["张力设定过大造成相对滑动", "导位对中不良与带钢跑偏", "低技能班组操作不当"],
}

CHECK_MAP = dict(CHECKS)
DEFECT_CN = {
    "crazing": "龟裂", "inclusion": "夹杂", "patches": "斑块",
    "pitted_surface": "麻点", "rolled-in_scale": "氧化皮压入", "scratches": "划痕",
}


def _clamp(x, lo=0.0, hi=1.0):
    return max(lo, min(hi, x))


class AttributionEngine:
    """通过知识库做根因归因。判断依据全部来自传入的知识库，不写死业务规则。"""

    def __init__(self, kb):
        self.rules = kb["rules"]
        self.weights = kb["weights"]
        self.thresholds = kb.get("thresholds", {})
        self._by_cause = {}
        for r in self.rules:
            self._by_cause.setdefault(r["root_cause"], r)

    def _load(self, defect_type, context):
        """取该缺陷类型的候选规则，计算命中状态与偏离强度。"""
        out = []
        for name in DEFECT_CANDIDATES.get(defect_type, []):
            rule = self._by_cause.get(name)
            if rule is None:
                continue
            hit = bool(CHECK_MAP[name](context))
            out.append({"rule": rule, "hit": hit, "strength": self._strength(rule, context, hit)})
        return out

    def _strength(self, rule, context, hit):
        """按工艺参数相对阈值的偏离程度给 0~1 的强度分，命中更高。

        命中：0.6 起，偏离阈值越远越高，最高 1.0。
        未命中：按接近阈值的程度给 0~0.35，表示接近但未越界。
        """
        best = 0.0
        for cond in rule.get("conditions", []):
            field, op, thr = cond["field"], cond["op"], cond["value"]
            if field not in context:
                continue
            actual = context[field]
            span = self._span(field, op, thr)
            if span <= 0:
                continue
            dev = (thr - actual) / span if op == "<" else (actual - thr) / span
            cur = 0.6 + 0.4 * _clamp(dev) if hit else 0.35 * _clamp(1.0 - abs(dev))
            best = max(best, cur)
        return round(best if hit else min(best, 0.35), 4)

    def _span(self, field, op, thr):
        """用知识库阈值表算归一化跨度，避免不同量纲的参数不可比。"""
        t = self.thresholds.get(field, {})
        lo, hi = t.get("low"), t.get("high")
        if op == "<" and lo is not None and thr > lo:
            return float(thr - lo)
        if op == ">" and hi is not None and hi > thr:
            return float(hi - thr)
        return abs(float(thr)) or 1.0

    def attribute(self, defect_type, context):
        """主入口。返回根因排序、四维贡献度、整改建议。"""
        cands = self._load(defect_type, context)
        w = self.weights.get(defect_type, {})

        dim_raw = {}
        for d in DIMENSION_CN:
            rel = [c for c in cands if c["rule"]["dimension"] == d]
            peak = max((c["strength"] for c in rel), default=0.0)
            base = 0.15 if not any(c["hit"] for c in rel) else 1.0
            dim_raw[d] = w.get(d, 0.25) * peak * base

        tot = sum(dim_raw.values()) or 1.0
        contributions = []
        for d in DIMENSION_CN:
            rel = [c for c in cands if c["rule"]["dimension"] == d and c["rule"].get("conditions")]
            contributions.append({
                "dimension": d,
                "dimension_cn": DIMENSION_CN[d],
                "score": round(dim_raw[d] / tot * 100, 2),
                "evidence": [
                    {
                        "field": c["rule"]["conditions"][0]["field"],
                        "value": round(float(context.get(c["rule"]["conditions"][0]["field"], 0)), 2),
                        "threshold": c["rule"]["conditions"][0]["value"],
                        "op": c["rule"]["conditions"][0]["op"],
                        "hit": c["hit"],
                    }
                    for c in rel
                ],
            })
        contributions.sort(key=lambda x: -x["score"])

        ranked = sorted(cands, key=lambda c: -c["strength"])
        top = ranked[0] if ranked else None
        return {
            "defect_type": defect_type,
            "defect_cn": DEFECT_CN.get(defect_type, defect_type),
            "top_root_cause": top["rule"]["root_cause"] if top else None,
            "top_dimension_cn": DIMENSION_CN.get(top["rule"]["dimension"]) if top else None,
            "top_rule_id": top["rule"]["id"] if top else None,
            "confidence": round(top["strength"], 4) if top else 0.0,
            "contributions": contributions,
            "candidates": [
                {
                    "root_cause": c["rule"]["root_cause"],
                    "dimension_cn": DIMENSION_CN[c["rule"]["dimension"]],
                    "strength": c["strength"],
                    "hit": c["hit"],
                    "solution": c["rule"]["solution"],
                    "expected_drop_pct": c["rule"].get("expected_drop_pct"),
                }
                for c in ranked
            ],
            "solution": top["rule"]["solution"] if top else None,
            "expected_drop_pct": top["rule"].get("expected_drop_pct") if top else None,
        }


def load_kb(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


if __name__ == "__main__":
    import pprint

    here = Path(__file__).parent
    for cand in (here / "knowledge_base.json",
                 here.parent / "01-数据" / "knowledge_base.json",
                 here.parent / "knowledge_base.json"):
        if cand.exists():
            kb = load_kb(cand)
            break
    else:
        raise SystemExit("未找到 knowledge_base.json")

    demo = {
        "roll_temp": 1207.4, "roll_speed": 4.1, "tension": 27.3,
        "descaling_pressure": 12.4, "roll_gap": 2.5, "reduction_rate": 20.1,
        "heat_no": "H2470", "mn_s_ratio": 26.4, "refine_time": 43.1,
        "flux_batch_abnormal": 0, "shift_team": "甲班", "skill_level": 4,
        "first_coil_after_roll_change": 0, "shift": "day",
        "env_temp": 28.1, "env_humidity": 53.2, "dust": 5.1, "cooling_water_temp": 30.4,
    }
    pprint.pprint(AttributionEngine(kb).attribute("pitted_surface", demo))
