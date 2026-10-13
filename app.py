"""钢材质量缺陷归因与闭环处置平台 —— FastAPI 后端。

本轮实现：顶部指标、检测工作台（三通道识别：实时推理 / 离线评测 / 报错）、检测记录表。
其余模块（归因诊断 / 知识库 / 整改工单 / 闭环验证 / 分析看板）预留导航位，后续迭代实现。
"""
import json
import os
from datetime import datetime
from pathlib import Path

from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

import db
from detector import Detector, CLASSES, CLASS_CN
import attribute_service
import suggestion_service
import qa_service
import fields
import closed_loop_service
import dashboard_service
import alert_service

BASE_DIR = Path(__file__).parent


def _load_dotenv():
    """从项目根目录 .env 载入配置（不覆盖已存在的环境变量）。"""
    env_path = BASE_DIR / ".env"
    if not env_path.exists():
        return
    for line in env_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, val = line.partition("=")
        key, val = key.strip(), val.strip().strip('"').strip("'")
        if key and val:
            os.environ.setdefault(key, val)


_load_dotenv()

DB_PATH = BASE_DIR / "data.db"
RECORDS_PATH = BASE_DIR / "records.json"
KB_PATH = BASE_DIR / "knowledge_base.json"
PLATFORM_DATA_PATH = BASE_DIR / "platform_data.json"
STATIC_DIR = BASE_DIR / "static"
DEMO_DIR = BASE_DIR / "demo_images"
UPLOAD_DIR = BASE_DIR / "uploads"
ANNOTATED_DIR = BASE_DIR / "annotated"

UPLOAD_DIR.mkdir(exist_ok=True)
ANNOTATED_DIR.mkdir(exist_ok=True)
db.init_db(DB_PATH, RECORDS_PATH, KB_PATH)
detector = Detector(BASE_DIR)

app = FastAPI(title="钢材质量缺陷归因与闭环处置平台")


def _fmt_pct(value):
    return f"{value:g}%"


def _load_platform_data():
    return json.loads(PLATFORM_DATA_PATH.read_text(encoding="utf-8"))


def build_metrics():
    """四项常驻指标卡：数字来自离线评测，非实时计算。"""
    pd = _load_platform_data()
    kpi = pd.get("kpi", {})
    closed = pd.get("closed_loop", {})
    rule_count = len(pd.get("rules", []))
    return {
        "source": "指标来源：离线评测（platform_data.json），非实时计算",
        "items": [
            {
                "label": "缺陷识别准确率",
                "value": _fmt_pct(kpi.get("defect_recognition_acc", 94.44)),
                "note": "NEU-DET 测试集 170/180",
            },
            {
                "label": "根因定位准确率",
                "value": _fmt_pct(kpi.get("root_cause_acc", 94.68)),
                "note": f"离线评测集 · 基线 {kpi.get('root_cause_acc_baseline', 92.13)}%",
            },
            {
                "label": "改进建议可执行率",
                "value": _fmt_pct(kpi.get("solution_executable_rate", 100.0)),
                "note": f"{rule_count} 条根因规则全覆盖",
            },
            {
                "label": "闭环缺陷率降幅",
                "value": _fmt_pct(closed.get("drop_pct", 25.64)),
                "note": f"缺陷率 {closed.get('before_rate', 39.17)}% → {closed.get('after_rate', 29.12)}%",
            },
        ],
    }


def build_manifest():
    """按六类固定顺序分组返回示例样件。"""
    groups = []
    manifest = detector.manifest
    for key in CLASSES:
        items = [m for m in manifest if m.get("defect") == key]
        if not items:
            continue
        groups.append({
            "key": key,
            "cn": CLASS_CN.get(key, key),
            "images": [
                {
                    "file": m.get("file"),
                    "url": f"/demo_images/{m.get('file')}",
                    "confidence": m.get("confidence"),
                    "source": m.get("source"),
                    "description": m.get("description"),
                }
                for m in items
            ],
        })
    return {"classes": groups}


@app.get("/")
def index():
    return FileResponse(STATIC_DIR / "index.html")


@app.get("/api/health")
def health():
    return {"status": "ok", "detector": detector.status()}


@app.get("/api/metrics")
def metrics():
    return build_metrics()


@app.get("/api/manifest")
def manifest():
    return build_manifest()


# ---------- 分析看板 ----------
MIN_HANDLE_ORDERS = 3


def _avg_handle_hours():
    """工单从创建到最近一次处置的平均时长（小时）；样本不足时返回 (None, note)。"""
    orders = db.list_work_orders(DB_PATH)
    done = [o for o in orders if o.get("status") and o.get("status") != "待处理"]
    if len(done) < MIN_HANDLE_ORDERS:
        return None, "待工单数据积累"
    total = 0.0
    for o in done:
        c = datetime.strptime(o["created_at"], "%Y-%m-%d %H:%M")
        u = datetime.strptime(o["updated_at"], "%Y-%m-%d %H:%M")
        total += max(0.0, (u - c).total_seconds() / 3600.0)
    return round(total / len(done), 1), f"基于 {len(done)} 条已推进工单的创建→处置时长"


@app.get("/api/dashboard")
def dashboard():
    hours, note = _avg_handle_hours()
    return dashboard_service.build(
        PLATFORM_DATA_PATH, RECORDS_PATH, avg_handle_hours=hours, handle_note=note
    )


# ---------- 质量告警 ----------
@app.get("/api/alerts")
def alerts(window_hours: int = 24):
    records = db.list_records(DB_PATH, limit=1000)
    return alert_service.list_alerts(records, window_hours=window_hours)


@app.post("/api/alerts/notify")
async def alerts_notify(payload: dict):
    data = payload or {}
    records = db.list_records(DB_PATH, limit=1000)
    alert = alert_service.list_alerts(records, window_hours=int(data.get("window_hours") or 24))
    text = data.get("text") or alert_service.format_alert_text(alert)
    result = alert_service.notify(text)
    result["alert"] = alert
    return result


@app.post("/api/alert/push")
async def alert_push(payload: dict):
    """推送当前质量告警到已配置的通知 Webhook（飞书/钉钉）。"""
    data = payload or {}
    records = db.list_records(DB_PATH, limit=1000)
    alert = alert_service.list_alerts(records, window_hours=int(data.get("window_hours") or 24))
    text = data.get("text") or alert_service.format_alert_text(alert)
    result = alert_service.notify(text)
    result["alert"] = alert
    return result


@app.get("/api/records")
def records(limit: int = 200):
    return {"items": db.list_records(DB_PATH, limit=limit)}


@app.get("/api/attribute/schema")
def attribute_schema():
    return attribute_service.build_schema()


@app.post("/api/attribute")
async def attribute(payload: dict):
    defect_type = (payload or {}).get("defect_type")
    context = (payload or {}).get("context") or {}
    if not defect_type:
        raise HTTPException(status_code=400, detail="缺少 defect_type 参数")
    return attribute_service.run_attribution(defect_type, context)


# ---------- 知识库 ----------
@app.get("/api/kb/rules")
def kb_rules(defect: str = None):
    rules = db.list_kb_rules(DB_PATH, defect=defect)
    return {
        "items": rules,
        "defects": [{"key": k, "cn": v} for k, v in attribute_service.DEFECT_CN.items()],
        "dimensions": [{"key": k, "cn": v} for k, v in fields.DIMENSION_CN.items()],
        "source": "知识库来源：knowledge_base.json（30 条行业规则）",
    }


@app.post("/api/kb/rules")
async def kb_add(payload: dict):
    data = payload or {}
    if not data.get("defect") or not data.get("root_cause"):
        raise HTTPException(status_code=400, detail="缺陷类型与根因必填")
    data.setdefault("defect_cn", attribute_service.DEFECT_CN.get(data.get("defect"), ""))
    data.setdefault("dimension", "equipment")
    return db.add_kb_rule(DB_PATH, data)


@app.put("/api/kb/rules/{rule_id}")
async def kb_update(rule_id: int, payload: dict):
    data = payload or {}
    if data.get("defect") and not data.get("defect_cn"):
        data["defect_cn"] = attribute_service.DEFECT_CN.get(data["defect"], "")
    rule = db.update_kb_rule(DB_PATH, rule_id, data)
    if not rule:
        raise HTTPException(status_code=404, detail="规则不存在")
    return rule


@app.delete("/api/kb/rules/{rule_id}")
async def kb_delete(rule_id: int):
    if not db.delete_kb_rule(DB_PATH, rule_id):
        raise HTTPException(status_code=404, detail="规则不存在")
    return {"ok": True}


@app.post("/api/kb/rules/{rule_id}/toggle")
async def kb_toggle(rule_id: int):
    rule = db.toggle_kb_rule(DB_PATH, rule_id)
    if not rule:
        raise HTTPException(status_code=404, detail="规则不存在")
    return rule


# ---------- 改进建议可执行率 ----------
@app.get("/api/suggestions/stats")
def suggestion_stats():
    return suggestion_service.stats(DB_PATH)


# ---------- 整改工单 ----------
@app.get("/api/work-orders")
def work_orders(status: str = None, dimension_cn: str = None):
    return {
        "items": db.list_work_orders(DB_PATH, status=status, dimension_cn=dimension_cn),
        "statuses": db.WORK_ORDER_STATUS,
        "dimensions": [{"key": k, "cn": v} for k, v in fields.DIMENSION_CN.items()],
    }


@app.post("/api/work-orders")
async def work_order_create(payload: dict):
    data = payload or {}
    for k in ("root_cause", "measure"):
        if not data.get(k):
            raise HTTPException(status_code=400, detail=f"{k} 必填")
    ts = datetime.now().strftime("%Y-%m-%d %H:%M")
    ticket_no = data.get("ticket_no") or db.next_ticket_no(DB_PATH, datetime.now().strftime("%Y%m%d"))
    return db.add_work_order(
        DB_PATH,
        ticket_no=ticket_no,
        record_ref=data.get("record_ref", "—"),
        defect_cn=data.get("defect_cn", ""),
        root_cause=data["root_cause"],
        dimension_cn=data.get("dimension_cn", ""),
        measure=data["measure"],
        owner=data.get("owner", "待指派"),
        status="待处理",
        ts=ts,
    )


@app.post("/api/work-orders/{order_id}/status")
async def work_order_status(order_id: int, payload: dict):
    status = (payload or {}).get("status")
    if status not in db.WORK_ORDER_STATUS:
        raise HTTPException(status_code=400, detail="非法状态")
    order = db.update_work_order_status(
        DB_PATH, order_id, status, datetime.now().strftime("%Y-%m-%d %H:%M")
    )
    if not order:
        raise HTTPException(status_code=404, detail="工单不存在")
    return order


# ---------- 闭环验证 ----------
_CLS_FROM_CN = {cn: key for key, cn in closed_loop_service.CLASS_CN.items()}


def _executed_drops_from_orders():
    """汇总已执行整改工单（状态非待处理）对应建议的预期降幅，按缺陷类分组，供累乘。"""
    drops = {}
    try:
        orders = db.list_work_orders(DB_PATH)
    except Exception:
        return drops
    rules = db.list_kb_rules(DB_PATH, enabled_only=True)
    by_cause = {}
    for r in rules:
        by_cause.setdefault(r.get("root_cause"), r)
    for o in orders:
        if o.get("status") == "待处理":
            continue
        key = _CLS_FROM_CN.get(o.get("defect_cn"))
        if not key:
            continue
        rule = by_cause.get(o.get("root_cause"))
        if not rule:
            continue
        drops.setdefault(key, []).append(float(rule.get("expected_drop_pct") or 0) / 100.0)
    return drops


@app.get("/api/closed-loop/batches")
def closed_loop_batches():
    return closed_loop_service.list_batches()


@app.get("/api/closed-loop/runs")
def closed_loop_runs(limit: int = 20):
    return {"items": db.list_closed_loop_runs(DB_PATH, limit=limit)}


@app.post("/api/closed-loop/verify")
async def closed_loop_verify(payload: dict):
    data = payload or {}
    batch_key = data.get("batch") or "ALL"
    try:
        sample_size = int(data.get("sample_size") or closed_loop_service.DEFAULT_SAMPLE)
    except (TypeError, ValueError):
        sample_size = closed_loop_service.DEFAULT_SAMPLE
    executed = data.get("executed")
    rules = db.list_kb_rules(DB_PATH, enabled_only=True)
    executed_drops = _executed_drops_from_orders() if data.get("use_work_orders") else {}
    result = closed_loop_service.verify(
        batch_key=batch_key,
        sample_size=sample_size,
        executed=executed,
        rules=rules,
        executed_drops=executed_drops,
    )
    if data.get("save"):
        db.save_closed_loop_run(
            DB_PATH,
            ticket_no=data.get("ticket_no"),
            batch_key=result["batch_key"],
            batch_label=result["batch_label"],
            sample_size=result["sample_size"],
            before_rate=result["before_rate"],
            after_rate=result["after_rate"],
            drop_pct=result["drop_pct"],
            verdict=result["verdict"],
            per_class=result["per_class"],
            measures=result["measures"],
            ts=datetime.now().strftime("%Y-%m-%d %H:%M"),
        )
    return result


@app.post("/api/work-orders/{order_id}/rectify")
async def work_order_rectify(order_id: int):
    """执行整改：将工单推进到「处理中」，并作为闭环验证的入口。"""
    order = db.get_work_order(DB_PATH, order_id)
    if not order:
        raise HTTPException(status_code=404, detail="工单不存在")
    if order["status"] == "待处理":
        order = db.update_work_order_status(
            DB_PATH, order_id, "处理中", datetime.now().strftime("%Y-%m-%d %H:%M")
        )
    return {"order": order, "next": "closed-loop"}


# ---------- 自然语言问答 ----------@app.post("/api/qa")
async def qa(payload: dict):
    data = payload or {}
    question = (data.get("question") or "").strip()
    if not question:
        raise HTTPException(status_code=400, detail="缺少 question")
    defect_type = data.get("defect_type")
    defect_cn = attribute_service.DEFECT_CN.get(defect_type, data.get("defect_cn", ""))
    attribution = data.get("attribution") or {}
    rules = db.list_kb_rules(DB_PATH, defect=defect_type, enabled_only=True)
    return qa_service.answer(question, defect_cn, attribution, rules)


def _persist_and_return(result):
    if not result.get("available"):
        return {"result": result, "record": None}
    record = db.add_record(
        DB_PATH,
        ts=datetime.now().strftime("%Y-%m-%d %H:%M"),
        image_name=result["file"],
        defect=result["defect"],
        confidence=result["confidence"],
        severity=result["severity"],
        channel=result["mode_cn"],
    )
    return {"result": result, "record": record}


@app.post("/api/detect")
async def detect_sample(payload: dict):
    file_name = (payload or {}).get("file")
    if not file_name:
        raise HTTPException(status_code=400, detail="缺少 file 参数")
    image_path = DEMO_DIR / Path(file_name).name
    if not image_path.exists():
        raise HTTPException(status_code=404, detail="示例样件不存在")
    result = detector.detect(image_path)
    result["image_url"] = f"/demo_images/{image_path.name}"
    if result.get("annotated_name"):
        result["annotated_url"] = f"/annotated/{result['annotated_name']}"
    return _persist_and_return(result)


@app.post("/api/detect/upload")
async def detect_upload(file: UploadFile = File(...)):
    safe_name = Path(file.filename or "upload.jpg").name
    stamp = datetime.now().strftime("%Y%m%d%H%M%S%f")
    target = UPLOAD_DIR / f"{stamp}_{safe_name}"
    target.write_bytes(await file.read())
    result = detector.detect(target)
    result["image_url"] = f"/uploads/{target.name}"
    if result.get("annotated_name"):
        result["annotated_url"] = f"/annotated/{result['annotated_name']}"
    return _persist_and_return(result)


app.mount("/demo_images", StaticFiles(directory=str(DEMO_DIR)), name="demo_images")
app.mount("/uploads", StaticFiles(directory=str(UPLOAD_DIR)), name="uploads")
app.mount("/annotated", StaticFiles(directory=str(ANNOTATED_DIR)), name="annotated")
if STATIC_DIR.exists():
    app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")


@app.exception_handler(404)
async def not_found(request, exc):
    if request.url.path.startswith("/api/"):
        return JSONResponse(status_code=404, content={"detail": "接口不存在"})
    return FileResponse(STATIC_DIR / "index.html")
