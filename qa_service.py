"""自然语言问答：注入本次归因证据链 + 知识库规则，调用对话模型作答。

要求：
- 结论必须落在知识库规则范围内；
- 不确定的部分明确说明不确定，不编造工艺结论。
"""
import json
import os
import urllib.request

BASE_URL = os.environ.get("MCAI_LLM_BASE_URL", "").rstrip("/")
API_KEY = os.environ.get("MCAI_LLM_API_KEY", "")
MODEL = os.environ.get("MCAI_LLM_MODEL", "")

SYSTEM_PROMPT = (
    "你是钢材表面质量缺陷的归因诊断助手。你只能依据下面给出的「知识库规则」和「本次归因证据链」作答。"
    "严禁引用知识库以外的根因、工艺参数或行业结论，严禁编造数据。"
    "如果问题超出给定规则范围，或证据链不足以支撑结论，必须明确说明「不确定」，并指出还缺少哪些信息。"
    "回答使用简体中文，先给结论，再列证据，控制在 6 句以内。"
)


def _build_context(defect_cn, attribution, rules):
    lines = [f"缺陷类型：{defect_cn}"]
    if attribution:
        lines.append(f"主因根因：{attribution.get('top_root_cause')}（维度：{attribution.get('top_dimension_cn')}，"
                     f"置信度：{round((attribution.get('confidence') or 0) * 100, 2)}%）")
        lines.append("四维贡献度：" + "；".join(
            f"{c['dimension_cn']} {c['score']}%" for c in attribution.get("contributions", [])
        ))
        ev = []
        for c in attribution.get("contributions", []):
            for e in c.get("evidence", []):
                mark = "超标" if e.get("hit") else "正常"
                ev.append(f"{e.get('field_label')}={e.get('value')}（{e.get('op')}{e.get('threshold')}，{mark}）")
        lines.append("证据链：" + ("；".join(ev) if ev else "无命中证据"))
        if attribution.get("candidates"):
            lines.append("其他候选根因：" + "；".join(
                f"{c['root_cause']}（强度 {round(c['strength'] * 100, 2)}%，{'命中' if c['hit'] else '未命中'}）"
                for c in attribution["candidates"]
            ))
    lines.append("知识库规则：")
    for r in rules:
        lines.append(
            f"- [{r.get('rule_id')}] 根因：{r.get('root_cause')}；触发条件：{r.get('trigger_text')}；"
            f"解决策略：{r.get('solution')}；预期降幅：{r.get('expected_drop_pct')}%"
        )
    return "\n".join(lines)


def _call_model(messages):
    if not (BASE_URL and API_KEY and MODEL):
        raise RuntimeError("未配置对话模型（MCAI_LLM_* 环境变量缺失）")
    body = json.dumps({
        "model": MODEL,
        "messages": messages,
        "max_tokens": 1600,
        "temperature": 0.2,
    }).encode("utf-8")
    req = urllib.request.Request(
        BASE_URL + "/chat/completions",
        data=body,
        headers={"Content-Type": "application/json", "Authorization": "Bearer " + API_KEY},
    )
    with urllib.request.urlopen(req, timeout=90) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    return data["choices"][0]["message"].get("content", "").strip()


def answer(question, defect_cn, attribution, rules):
    context = _build_context(defect_cn, attribution, rules)
    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": f"【已知上下文】\n{context}\n\n【用户问题】{question}"},
    ]
    evidence_chain = {
        "top_root_cause": attribution.get("top_root_cause") if attribution else None,
        "top_dimension_cn": attribution.get("top_dimension_cn") if attribution else None,
        "contributions": attribution.get("contributions", []) if attribution else [],
        "rules": [{"rule_id": r.get("rule_id"), "root_cause": r.get("root_cause"),
                   "solution": r.get("solution")} for r in rules],
    }
    try:
        text = _call_model(messages)
        if not text:
            text = "模型未返回有效内容，请重试。"
        return {
            "answer": text,
            "model": MODEL,
            "evidence_chain": evidence_chain,
            "source": "AI 模型回答（已注入本次归因证据链与知识库规则）",
        }
    except Exception as exc:
        return {
            "answer": f"问答暂不可用：{exc}",
            "model": MODEL,
            "evidence_chain": evidence_chain,
            "source": "AI 模型调用失败",
            "error": True,
        }
