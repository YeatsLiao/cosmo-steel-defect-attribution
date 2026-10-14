"""工艺字段元数据：供归因表单、知识库触发条件格式化、测试脚本共享。"""

FIELD_META = {
    "roll_temp": ("轧制温度", "℃"),
    "roll_speed": ("轧制速度", "m/s"),
    "tension": ("张力", "kN"),
    "descaling_pressure": ("除鳞水压力", "MPa"),
    "roll_gap": ("辊缝", "mm"),
    "reduction_rate": ("压下率", "%"),
    "steel_grade": ("钢种", ""),
    "heat_no": ("炉号", ""),
    "mn_s_ratio": ("Mn/S 比", ""),
    "flux_batch_abnormal": ("保护渣批次", ""),
    "refine_time": ("精炼时间", "min"),
    "shift_team": ("班组", ""),
    "skill_level": ("技能等级", ""),
    "first_coil_after_roll_change": ("是否换辊后首卷", ""),
    "shift": ("班次", ""),
    "env_temp": ("环境温度", "℃"),
    "env_humidity": ("环境湿度", "%"),
    "dust": ("粉尘浓度", "mg/m³"),
    "cooling_water_temp": ("冷却水温", "℃"),
}

FIELD_DIM = {
    "roll_temp": "equipment", "roll_speed": "equipment", "tension": "equipment",
    "descaling_pressure": "equipment", "roll_gap": "equipment", "reduction_rate": "equipment",
    "steel_grade": "material", "heat_no": "material", "mn_s_ratio": "material",
    "flux_batch_abnormal": "material", "refine_time": "material",
    "shift_team": "operator", "skill_level": "operator",
    "first_coil_after_roll_change": "operator", "shift": "operator",
    "env_temp": "environment", "env_humidity": "environment",
    "dust": "environment", "cooling_water_temp": "environment",
}

DIMENSION_CN = {
    "equipment": "设备参数",
    "material": "物料批次",
    "operator": "人员操作",
    "environment": "环境条件",
}


def field_label(field):
    return FIELD_META.get(field, (field, ""))[0]


def format_condition(conditions):
    """把条件列表格式化为可读触发条件，如「轧制温度 < 1100℃」。"""
    parts = []
    for cond in conditions or []:
        label, unit = FIELD_META.get(cond.get("field"), (cond.get("field"), ""))
        parts.append(f"{label} {cond.get('op', '')} {cond.get('value', '')}{unit}")
    return "；".join(parts)
