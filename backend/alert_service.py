"""质量告警服务：严重等级单次告警 + 缺陷类型聚集告警，并支持 Webhook 通知推送。

告警规则（演示口径）：
1. 单次检测出现「严重」等级缺陷 → 立即告警；
2. 某缺陷类型在最近 24 小时内出现超过 3 次 → 聚集告警。

通知推送：读取环境变量中的 Webhook 地址（飞书 / 钉钉 / 通用），按对应格式 POST。
未配置 Webhook 时不发起请求，返回配置指引。
"""
import base64
import hashlib
import hmac
import json
import os
import time
from collections import Counter
from datetime import datetime, timedelta
from urllib import request as urlrequest

WINDOW_HOURS = 24
TYPE_THRESHOLD = 3

WEBHOOK_ENV_CANDIDATES = [
    "FEISHU_WEBHOOK_URL",
    "DINGTALK_WEBHOOK_URL",
    "ALERT_WEBHOOK_URL",
    "MCAI_ALERT_WEBHOOK",
]
FEISHU_SECRET_ENV = "FEISHU_WEBHOOK_SECRET"


def _parse(ts):
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M"):
        try:
            return datetime.strptime(ts, fmt)
        except (TypeError, ValueError):
            continue
    return None


def list_alerts(records, window_hours=WINDOW_HOURS, threshold=TYPE_THRESHOLD, now=None):
    """records: detection_records 列表（含 ts/defect_cn/severity/defect_type）。"""
    now = now or datetime.now()
    start = now - timedelta(hours=window_hours)
    window = []
    for r in records:
        t = _parse(r.get("ts"))
        if t and start <= t <= now:
            window.append(r)

    items = []

    severe = [r for r in window if r.get("severity") == "严重"]
    if severe:
        severe.sort(key=lambda r: _parse(r.get("ts")) or datetime.min, reverse=True)
        latest = severe[0]
        items.append({
            "level": "severe",
            "title": f"检出「严重」等级缺陷（近 {window_hours} 小时 {len(severe)} 件）",
            "detail": f"最近一例：{latest.get('defect_cn')} · {latest.get('ts')} · 置信度 {float(latest.get('confidence') or 0) * 100:.1f}%",
        })

    type_counter = Counter(r.get("defect_cn") for r in window if r.get("defect_type"))
    for name, cnt in type_counter.most_common():
        if cnt > threshold:
            items.append({
                "level": "cluster",
                "title": f"「{name}」24 小时内出现 {cnt} 次（阈值 >{threshold}）",
                "detail": f"疑似批量性缺陷，建议核查对应工序并触发闭环整改",
            })

    return {
        "window_hours": window_hours,
        "threshold": threshold,
        "window_total": len(window),
        "severe_count": len(severe),
        "has_alert": bool(items),
        "items": items,
        "generated_at": now.strftime("%Y-%m-%d %H:%M"),
    }


def _webhook_config():
    for key in WEBHOOK_ENV_CANDIDATES:
        url = os.environ.get(key)
        if url:
            return key, url.strip()
    return None, None


def _build_payload(url, text):
    low = url.lower()
    if "feishu" in low or "lark" in low:
        payload = {"msg_type": "text", "content": {"text": text}}
        secret = os.environ.get(FEISHU_SECRET_ENV)
        if secret:
            timestamp = str(int(time.time()))
            string_to_sign = f"{timestamp}\n{secret}"
            digest = hmac.new(string_to_sign.encode("utf-8"), digestmod=hashlib.sha256).digest()
            payload["timestamp"] = timestamp
            payload["sign"] = base64.b64encode(digest).decode("utf-8")
        return payload, "飞书"
    if "dingtalk" in low or "oapi.dingtalk" in low:
        return {"msgtype": "text", "text": {"content": text}}, "钉钉"
    return {"text": text, "msg_type": "text"}, "通用 Webhook"


def _check_response(channel, body):
    """解析各家返回体，判断是否真正送达。"""
    try:
        data = json.loads(body) if body else {}
    except Exception:
        return True, ""
    if channel == "飞书":
        code = data.get("code", data.get("StatusCode"))
        if code in (0, None):
            return True, ""
        msg = data.get("msg") or data.get("StatusMessage") or ""
        hint = ""
        if str(code) == "19021":
            hint = "（机器人开启了签名校验：请在机器人设置中关闭签名校验，或在 .env 配置 FEISHU_WEBHOOK_SECRET）"
        return False, f"飞书返回 code={code}：{msg}{hint}"
    if channel == "钉钉":
        code = data.get("errcode")
        if code in (0, None):
            return True, ""
        return False, f"钉钉返回 errcode={code}：{data.get('errmsg', '')}"
    return True, ""


def notify(text):
    key, url = _webhook_config()
    if not url:
        return {
            "ok": False,
            "configured": False,
            "message": "未配置通知 Webhook，无法推送",
            "hint": "请在项目根目录 .env 配置 FEISHU_WEBHOOK_URL 或 DINGTALK_WEBHOOK_URL 后重试",
        }

    payload, channel = _build_payload(url, text)
    data = json.dumps(payload).encode("utf-8")
    req = urlrequest.Request(
        url,
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urlrequest.urlopen(req, timeout=8) as resp:
            body = resp.read().decode("utf-8", "ignore")[:500]
            status = resp.status
    except Exception as exc:
        return {
            "ok": False,
            "configured": True,
            "channel": channel,
            "message": f"推送失败：{exc}",
        }

    delivered, reason = _check_response(channel, body)
    if delivered and 200 <= status < 300:
        return {
            "ok": True,
            "configured": True,
            "channel": channel,
            "env": key,
            "status": status,
            "message": f"已通过{channel}推送告警通知",
            "response": body,
        }
    return {
        "ok": False,
        "configured": True,
        "channel": channel,
        "env": key,
        "status": status,
        "message": reason or f"{channel}推送被拒（HTTP {status}）",
        "response": body,
    }


def format_alert_text(alert, extra_lines=None):
    lines = ["【钢材质量缺陷告警】", f"时间：{alert.get('generated_at')}"]
    for item in alert.get("items", []):
        lines.append(f"- {item['title']}")
        if item.get("detail"):
            lines.append(f"  {item['detail']}")
    if extra_lines:
        lines.extend(extra_lines)
    return "\n".join(lines)
