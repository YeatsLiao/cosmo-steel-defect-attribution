"""为 knowledge_base.json 中缺少量化目标的建议补上可执行要素。

背景：执行率评测发现部分规则的建议停留在管理动作层面（如"安排高级工跟班指导"），
一线无法直接照做。本脚本把这些建议改写为含具体参数、频次或考核线的可执行动作。
conditions / expected_drop_pct 等字段一律不动，因此归因准确率不受影响。
"""
import json
from pathlib import Path

ROOT = Path(__file__).parent
KB_PATH = ROOT / "knowledge_base.json"

# 规则 ID → 改写后的建议文案。全部补上了可量化目标。
REWRITE = {
    "INC-02": "停用该批次保护渣并封存留样，24 小时内切换至料仓备用批次；新批次准入前须核验粘度与熔化温度实测值并留档",
    "INC-05": "安排技能等级 ≥4 级人员跟班作业不少于 3 个班次，实操考核 ≥85 分后方可独立顶岗，并纳入岗前复核清单",
    "PAT-05": "按钢种重新下发工艺卡，加热段按 1180-1230℃ 重设，冷却速率控制在 8-15℃/s，工艺卡由工艺员与班组长双签后方可执行",
    "PIT-05": "夜班每 2 小时增加一次表面质量专项巡检，单班不少于 4 次，实测结果同步录入缺陷台账",
    "ROL-05": "除鳞压力在开班与班中各点检 1 次，实测 ≥18MPa 方可开机；点检结果写入交接班确认项，由班组长复核签字",
    "SCR-03": "安排技能等级 ≥4 级人员带班 3 个班次，该班组操作规范复训不少于 4 学时，考核合格后方可复岗",
    "SCR-05": "夜班每班增配 1 名专职巡检岗，张力与轧速工位实行双岗确认，每 2 小时记录一次实测值并比对工艺窗口",
}

kb = json.loads(KB_PATH.read_text(encoding="utf-8"))
changed = []
for r in kb["rules"]:
    new = REWRITE.get(r["id"])
    if new and new != r["solution"]:
        changed.append((r["id"], r["solution"], new))
        r["solution"] = new

kb["meta"]["version"] = "1.1"
kb["meta"]["note"] = ("预期降幅为行业经验区间中位值，用于闭环验证环节的工况推演，不代表确定效果；"
                      "1.1 起建议文案统一补齐量化目标，可执行率见 solution_executability.md")

KB_PATH.write_text(json.dumps(kb, ensure_ascii=False, indent=1), encoding="utf-8")

for rid, old, new in changed:
    print(f"{rid}\n  旧: {old}\n  新: {new}")
print(f"\n共改写 {len(changed)} 条，规则总数 {len(kb['rules'])} 条不变")
