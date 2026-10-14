"""生成带因果结构与 ground truth 的产线检测记录，并用参考归因引擎自测根因定位准确率。

设计原则：先「注入异常」→ 由异常推导出缺陷类型 → 再叠加测量噪声。
这样每条记录都有确定的真实根因，归因准确率可被复算，避免事后自证。

产出：
  records.json            1200 条检测记录（含工艺上下文 + 真实根因）
  attribution_eval.md     参考归因引擎的自测报告
"""
import json
import random
from collections import Counter, defaultdict
from pathlib import Path

import numpy as np

ROOT = Path(__file__).parent
random.seed(20261012)
rng = np.random.default_rng(20261012)

N = 1200
STEEL_GRADES = ["Q235B", "SS400", "SPHC"]
SHIFT_TEAMS = ["甲班", "乙班", "丙班"]
DIM_CN = {"equipment": "设备参数", "material": "物料批次",
          "operator": "人员操作", "environment": "环境条件"}

# ---- 异常注入器：(维度, 根因, 缺陷类型, 严重度) -------------------------------
ANOMALIES = [
    ("equipment", "轧制温度偏低导致热塑性不足", "crazing", 1.0),
    ("equipment", "单道次压下率过大", "crazing", 0.9),
    ("material", "Mn/S 比偏低导致晶界热脆", "crazing", 1.0),
    ("material", "精炼时间不足导致夹杂物未充分上浮", "inclusion", 1.0),
    ("material", "保护渣批次异常卷入", "inclusion", 1.0),
    ("operator", "低技能等级班组操作规范性不足", "inclusion", 0.8),
    ("equipment", "轧辊表面磨损或粘着脱落", "patches", 1.0),
    ("operator", "换辊后首卷辊面未磨合", "patches", 1.0),
    ("environment", "环境湿度过高加剧辊面腐蚀斑", "patches", 0.9),
    ("environment", "粉尘浓度过高在表面形成点蚀麻点", "pitted_surface", 1.0),
    ("environment", "环境湿度过高导致存放期返锈麻面", "pitted_surface", 0.9),
    ("equipment", "除鳞水压力不足", "pitted_surface", 0.9),
    ("equipment", "除鳞水压力不足", "rolled-in_scale", 1.0),
    ("equipment", "出炉温度过高导致厚氧化层", "rolled-in_scale", 1.0),
    ("operator", "未按工艺卡执行除鳞检查", "rolled-in_scale", 0.8),
    ("equipment", "张力设定过大造成相对滑动", "scratches", 1.0),
    ("equipment", "导位对中不良与带钢跑偏", "scratches", 0.9),
    ("operator", "低技能班组操作不当", "scratches", 0.8),
]


def normal_sample():
    """正常工况下的工艺上下文。"""
    return dict(
        roll_temp=rng.normal(1205, 22),
        roll_speed=rng.normal(4.2, 0.7),
        tension=rng.normal(27, 5),
        descaling_pressure=rng.normal(19.4, 1.3),
        roll_gap=rng.normal(2.5, 0.5),
        reduction_rate=rng.normal(20, 3),
        steel_grade=random.choice(STEEL_GRADES),
        heat_no=f"H{ rng.integers(2401, 2499) }",
        mn_s_ratio=rng.normal(25, 5),
        refine_time=rng.normal(42, 8),
        flux_batch_abnormal=0,
        shift_team=random.choice(SHIFT_TEAMS),
        skill_level=int(rng.choice([3, 4, 4, 5, 5])),
        first_coil_after_roll_change=0,
        shift=random.choice(["day", "day", "night"]),
        env_temp=rng.normal(28, 4),
        env_humidity=rng.normal(52, 8),
        dust=rng.normal(5.0, 1.8),
        cooling_water_temp=rng.normal(30, 3.5),
    )


def apply_anomaly(ctx, dim, cause):
    """按根因把对应工艺参数推到异常区，并叠加噪声。"""
    n = lambda s: rng.normal(0, s)
    if cause == "轧制温度偏低导致热塑性不足":
        ctx["roll_temp"] = rng.normal(1075, 15) + n(5)
    elif cause == "单道次压下率过大":
        ctx["reduction_rate"] = rng.normal(33, 2) + n(1)
    elif cause == "Mn/S 比偏低导致晶界热脆":
        ctx["mn_s_ratio"] = rng.normal(12.5, 1.6) + n(0.5)
    elif cause == "精炼时间不足导致夹杂物未充分上浮":
        ctx["refine_time"] = rng.normal(21, 3) + n(1)
    elif cause == "保护渣批次异常卷入":
        ctx["flux_batch_abnormal"] = 1
    elif cause in ("低技能等级班组操作规范性不足", "低技能班组操作不当", "未按工艺卡执行除鳞检查"):
        ctx["skill_level"] = int(rng.choice([1, 2, 2]))
    elif cause == "轧辊表面磨损或粘着脱落":
        ctx["roll_gap"] = rng.normal(3.9, 0.3) + n(0.1)
    elif cause == "换辊后首卷辊面未磨合":
        ctx["first_coil_after_roll_change"] = 1
    elif cause in ("环境湿度过高加剧辊面腐蚀斑", "环境湿度过高导致存放期返锈麻面"):
        ctx["env_humidity"] = rng.normal(80, 4) + n(2)
    elif cause == "粉尘浓度过高在表面形成点蚀麻点":
        ctx["dust"] = rng.normal(14, 2) + n(1)
    elif cause in ("除鳞水压力不足", "未按工艺卡执行除鳞检查"):
        ctx["descaling_pressure"] = rng.normal(13.2, 1.0) + n(0.4)
    elif cause == "出炉温度过高导致厚氧化层":
        ctx["roll_temp"] = rng.normal(1268, 12) + n(4)
    elif cause == "张力设定过大造成相对滑动":
        ctx["tension"] = rng.normal(50, 4) + n(1.5)
    elif cause == "导位对中不良与带钢跑偏":
        ctx["roll_speed"] = rng.normal(6.4, 0.4) + n(0.15)
    return ctx


records = []
# 约 38% 为缺陷件
for i in range(N):
    ctx = normal_sample()
    ts = f"2026-{rng.integers(6, 10):02d}-{rng.integers(1, 28):02d} " \
         f"{rng.integers(0, 24):02d}:{rng.integers(0, 60):02d}"

    if rng.random() < 0.38:
        dim, cause, defect, sev = ANOMALIES[rng.integers(0, len(ANOMALIES))]
        ctx = apply_anomaly(ctx, dim, cause)
        confidence = float(np.clip(rng.normal(0.88, 0.07), 0.62, 0.99))
        severity = "严重" if sev >= 1.0 and confidence > 0.85 else ("中等" if confidence > 0.75 else "轻微")
        truth_dim, truth_cause = dim, cause
        defect_type = defect
    else:
        defect_type = None
        confidence = float(np.clip(rng.normal(0.95, 0.04), 0.8, 1.0))
        severity = "正常"
        truth_dim, truth_cause = None, None

    records.append({
        "record_id": f"QC{20260101 + i:08d}",
        "inspect_time": ts,
        "steel_grade": ctx.pop("steel_grade"),
        "context": ctx,
        "defect_type": defect_type,
        "confidence": round(confidence, 4),
        "severity": severity,
        "true_dimension": truth_dim,
        "true_root_cause": truth_cause,
    })

# ---- 参考归因引擎：验证这套数据能否支撑 ≥80% 的根因定位准确率 ---------------
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
# 缺陷类型 → 优先考虑哪几条规则（限制候选集，模拟真实归因的降维）
DEFECT_CANDIDATES = {
    "crazing": ["轧制温度偏低导致热塑性不足", "单道次压下率过大", "Mn/S 比偏低导致晶界热脆"],
    "inclusion": ["精炼时间不足导致夹杂物未充分上浮", "保护渣批次异常卷入", "低技能等级班组操作规范性不足"],
    "patches": ["轧辊表面磨损或粘着脱落", "换辊后首卷辊面未磨合", "环境湿度过高加剧辊面腐蚀斑"],
    "pitted_surface": ["粉尘浓度过高在表面形成点蚀麻点", "环境湿度过高导致存放期返锈麻面", "除鳞水压力不足"],
    "rolled-in_scale": ["除鳞水压力不足", "出炉温度过高导致厚氧化层", "未按工艺卡执行除鳞检查"],
    "scratches": ["张力设定过大造成相对滑动", "导位对中不良与带钢跑偏", "低技能班组操作不当"],
}
CHECK_MAP = dict(CHECKS)

total = top1_hit = top3_hit = dim_hit = 0
confusion = defaultdict(Counter)
for r in records:
    if not r["defect_type"]:
        continue
    total += 1
    c = r["context"]
    hits = [name for name in DEFECT_CANDIDATES[r["defect_type"]] if CHECK_MAP[name](c)]
    if hits:
        if hits[0] == r["true_root_cause"]:
            top1_hit += 1
        if r["true_root_cause"] in hits:
            top3_hit += 1
        # 维度命中：预测规则所属维度集合与真实维度是否有交集
        pred_dims = {p[0] for p in ANOMALIES if p[1] in hits}
        truth_dim_pair = {p[0] for p in ANOMALIES if p[1] == r["true_root_cause"]}
        if truth_dim_pair & pred_dims:
            dim_hit += 1
    else:
        confusion[r["true_root_cause"]]["<未命中>"] += 1
    confusion[r["true_root_cause"]]["命中" if (hits and hits[0] == r["true_root_cause"]) else "未命中"] += 1

out = ROOT / "records.json"
out.write_text(json.dumps(records, ensure_ascii=False, indent=1), encoding="utf-8")

defect_dist = Counter(r["defect_type"] for r in records if r["defect_type"])
dim_dist = Counter(r["true_dimension"] for r in records if r["true_dimension"])
sev_dist = Counter(r["severity"] for r in records)

report = f"""# 模拟产线数据与参考归因引擎自测报告

## 数据构成

- 总记录数：{len(records)} 条，时间跨度 2026-06 至 2026-09
- 钢种：{'/'.join(STEEL_GRADES)}
- 缺陷件 {sum(1 for r in records if r['defect_type'])} 条，合格件 {sum(1 for r in records if not r['defect_type'])} 条

缺陷类型分布：

| 缺陷类型 | 数量 |
| --- | --- |
{chr(10).join(f'| {k} | {v} |' for k, v in defect_dist.most_common())}

根因维度分布：

| 维度 | 数量 |
| --- | --- |
{chr(10).join(f'| {DIM_CN.get(k, k)} | {v} |' for k, v in dim_dist.most_common())}

严重等级分布：{'、'.join(f'{k} {v} 条' for k, v in sev_dist.most_common())}

每条记录包含 19 项工艺上下文字段（设备 6 / 物料 5 / 人员 4 / 环境 4），并带 `true_dimension` 与 `true_root_cause` 两个 ground truth 字段。

## 参考归因引擎自测（{total} 条缺陷件）

| 指标 | 结果 | 赛题要求 |
| --- | --- | --- |
| 根因 Top-1 命中率 | {top1_hit/total*100:.2f}% | 根因定位准确率 ≥80% |
| 根因 Top-3 命中率 | {top3_hit/total*100:.2f}% | — |
| 根因维度命中率 | {dim_hit/total*100:.2f}% | — |

说明：以上为规则引擎对自身生成数据的复算结果，用于验证「数据具备可解释的因果结构」以及归因思路可达标。
真实上线后的准确率取决于运行时传入的工艺上下文完整性，缺失字段越多准确率越低。

## 数据真实性声明

本数据集由脚本模拟生成，用于方案验证与演示，不代表真实产线数据。生成脚本 `generate_records.py` 随作品开放，可复算上述全部数字。
"""
(ROOT / "attribution_eval.md").write_text(report, encoding="utf-8")

print("records:", len(records), "->", out)
print(f"Top-1 根因命中率 {top1_hit/total*100:.2f}%  Top-3 {top3_hit/total*100:.2f}%  维度 {dim_hit/total*100:.2f}%  (n={total})")
