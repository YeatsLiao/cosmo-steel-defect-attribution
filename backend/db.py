"""SQLite 存储：检测记录、知识库规则、整改工单。

首次初始化时从 records.json 导入前 200 条作为历史记录，
并从 knowledge_base.json 导入 30 条规则。
"""
import json
import sqlite3
from pathlib import Path

from . import fields

HISTORY_LIMIT = 200

DDL = """
CREATE TABLE IF NOT EXISTS detection_records (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    ts          TEXT    NOT NULL,
    image_name  TEXT    NOT NULL,
    defect_type TEXT    NOT NULL,
    defect_cn   TEXT    NOT NULL,
    confidence  REAL    NOT NULL,
    severity    TEXT    NOT NULL,
    channel     TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS kb_rules (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    rule_id           TEXT,
    defect            TEXT    NOT NULL,
    defect_cn         TEXT    NOT NULL,
    dimension         TEXT    NOT NULL,
    root_cause        TEXT    NOT NULL,
    conditions        TEXT    NOT NULL,
    trigger_text      TEXT    NOT NULL,
    solution          TEXT    NOT NULL,
    expected_drop_pct INTEGER NOT NULL,
    enabled           INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS work_orders (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    ticket_no    TEXT    NOT NULL,
    record_ref   TEXT    NOT NULL,
    defect_cn    TEXT    NOT NULL,
    root_cause   TEXT    NOT NULL,
    dimension_cn TEXT    NOT NULL,
    measure      TEXT    NOT NULL,
    owner        TEXT    NOT NULL,
    status       TEXT    NOT NULL,
    created_at   TEXT    NOT NULL,
    updated_at   TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS closed_loop_runs (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    ticket_no    TEXT,
    batch_key    TEXT    NOT NULL,
    batch_label  TEXT    NOT NULL,
    sample_size  INTEGER NOT NULL,
    before_rate  REAL    NOT NULL,
    after_rate   REAL    NOT NULL,
    drop_pct     REAL    NOT NULL,
    verdict      TEXT    NOT NULL,
    per_class    TEXT    NOT NULL,
    measures     TEXT    NOT NULL,
    created_at   TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS closed_loop_run_orders (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id     INTEGER NOT NULL,
    order_id   INTEGER,
    ticket_no  TEXT,
    defect_cn  TEXT,
    root_cause TEXT,
    measure    TEXT,
    owner      TEXT,
    status     TEXT
);

CREATE INDEX IF NOT EXISTS idx_cl_run_orders ON closed_loop_run_orders (run_id);
"""

WORK_ORDER_STATUS = ["待处理", "处理中", "已解决", "已关闭"]


DEFECT_CN = {
    "crazing": "龟裂",
    "inclusion": "夹杂",
    "patches": "斑块",
    "pitted_surface": "麻点",
    "rolled-in_scale": "氧化皮压入",
    "scratches": "划痕",
}


def connect(db_path):
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    return conn


def init_db(db_path, records_path, kb_path=None):
    db_path = Path(db_path)
    conn = connect(db_path)
    with conn:
        conn.executescript(DDL)
        count = conn.execute("SELECT COUNT(*) AS n FROM detection_records").fetchone()["n"]
        if count == 0:
            _import_history(conn, Path(records_path))
        kb_count = conn.execute("SELECT COUNT(*) AS n FROM kb_rules").fetchone()["n"]
        if kb_count == 0 and kb_path:
            _import_kb(conn, Path(kb_path))
    conn.close()


def _import_kb(conn, kb_path):
    if not kb_path.exists():
        return
    try:
        kb = json.loads(kb_path.read_text(encoding="utf-8"))
    except Exception:
        return
    rows = []
    for rule in kb.get("rules", []):
        conditions = rule.get("conditions", [])
        rows.append((
            rule.get("id", ""),
            rule.get("defect", ""),
            rule.get("defect_cn", ""),
            rule.get("dimension", ""),
            rule.get("root_cause", ""),
            json.dumps(conditions, ensure_ascii=False),
            fields.format_condition(conditions),
            rule.get("solution", ""),
            int(rule.get("expected_drop_pct", 0)),
            1,
        ))
    conn.executemany(
        "INSERT INTO kb_rules (rule_id, defect, defect_cn, dimension, root_cause,"
        " conditions, trigger_text, solution, expected_drop_pct, enabled)"
        " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        rows,
    )



def _import_history(conn, records_path):
    if not records_path.exists():
        return
    try:
        records = json.loads(records_path.read_text(encoding="utf-8"))
    except Exception:
        return
    rows = []
    for rec in records[:HISTORY_LIMIT]:
        defect = rec.get("defect_type") or ""
        defect_cn = DEFECT_CN.get(defect, defect) if defect else "无缺陷"
        rows.append((
            rec.get("inspect_time", ""),
            rec.get("record_id", ""),
            defect,
            defect_cn,
            float(rec.get("confidence", 0.0)),
            rec.get("severity", ""),
            "离线评测结果",
        ))
    conn.executemany(
        "INSERT INTO detection_records (ts, image_name, defect_type, defect_cn, confidence, severity, channel)"
        " VALUES (?, ?, ?, ?, ?, ?, ?)",
        rows,
    )


def add_record(db_path, ts, image_name, defect, confidence, severity, channel):
    conn = connect(db_path)
    defect = defect or ""
    with conn:
        cur = conn.execute(
            "INSERT INTO detection_records (ts, image_name, defect_type, defect_cn, confidence, severity, channel)"
            " VALUES (?, ?, ?, ?, ?, ?, ?)",
            (ts, image_name, defect, DEFECT_CN.get(defect, defect) if defect else "无缺陷",
             round(float(confidence), 4), severity, channel),
        )
        row_id = cur.lastrowid
        row = conn.execute("SELECT * FROM detection_records WHERE id = ?", (row_id,)).fetchone()
    conn.close()
    return dict(row)


def list_records(db_path, limit=200):
    conn = connect(db_path)
    rows = conn.execute(
        "SELECT * FROM detection_records ORDER BY id DESC LIMIT ?", (int(limit),)
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def _kb_row(row):
    d = dict(row)
    try:
        d["conditions"] = json.loads(d.get("conditions") or "[]")
    except Exception:
        d["conditions"] = []
    d["enabled"] = bool(d.get("enabled"))
    return d


def list_kb_rules(db_path, defect=None, enabled_only=False):
    conn = connect(db_path)
    sql = "SELECT * FROM kb_rules"
    where, params = [], []
    if defect:
        where.append("defect = ?")
        params.append(defect)
    if enabled_only:
        where.append("enabled = 1")
    if where:
        sql += " WHERE " + " AND ".join(where)
    sql += " ORDER BY id ASC"
    rows = conn.execute(sql, params).fetchall()
    conn.close()
    return [_kb_row(r) for r in rows]


def get_kb_rule(db_path, rule_pk):
    conn = connect(db_path)
    row = conn.execute("SELECT * FROM kb_rules WHERE id = ?", (rule_pk,)).fetchone()
    conn.close()
    return _kb_row(row) if row else None


def add_kb_rule(db_path, data):
    conditions = data.get("conditions") or []
    if isinstance(conditions, str):
        try:
            conditions = json.loads(conditions)
        except Exception:
            conditions = []
    trigger = data.get("trigger_text") or fields.format_condition(conditions)
    conn = connect(db_path)
    with conn:
        cur = conn.execute(
            "INSERT INTO kb_rules (rule_id, defect, defect_cn, dimension, root_cause,"
            " conditions, trigger_text, solution, expected_drop_pct, enabled)"
            " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                data.get("rule_id", ""),
                data.get("defect", ""),
                data.get("defect_cn", ""),
                data.get("dimension", ""),
                data.get("root_cause", ""),
                json.dumps(conditions, ensure_ascii=False),
                trigger,
                data.get("solution", ""),
                int(data.get("expected_drop_pct", 0) or 0),
                1 if data.get("enabled", True) else 0,
            ),
        )
        rule_pk = cur.lastrowid
    conn.close()
    return get_kb_rule(db_path, rule_pk)


def update_kb_rule(db_path, rule_pk, data):
    existing = get_kb_rule(db_path, rule_pk)
    if not existing:
        return None
    merged = {**existing, **data}
    conditions = merged.get("conditions") or []
    if isinstance(conditions, str):
        try:
            conditions = json.loads(conditions)
        except Exception:
            conditions = []
    trigger = merged.get("trigger_text") or fields.format_condition(conditions)
    conn = connect(db_path)
    with conn:
        conn.execute(
            "UPDATE kb_rules SET rule_id=?, defect=?, defect_cn=?, dimension=?, root_cause=?,"
            " conditions=?, trigger_text=?, solution=?, expected_drop_pct=?, enabled=? WHERE id=?",
            (
                merged.get("rule_id", ""),
                merged.get("defect", ""),
                merged.get("defect_cn", ""),
                merged.get("dimension", ""),
                merged.get("root_cause", ""),
                json.dumps(conditions, ensure_ascii=False),
                trigger,
                merged.get("solution", ""),
                int(merged.get("expected_drop_pct", 0) or 0),
                1 if merged.get("enabled", True) else 0,
                rule_pk,
            ),
        )
    conn.close()
    return get_kb_rule(db_path, rule_pk)


def delete_kb_rule(db_path, rule_pk):
    conn = connect(db_path)
    with conn:
        cur = conn.execute("DELETE FROM kb_rules WHERE id = ?", (rule_pk,))
    conn.close()
    return cur.rowcount > 0


def toggle_kb_rule(db_path, rule_pk):
    rule = get_kb_rule(db_path, rule_pk)
    if not rule:
        return None
    return update_kb_rule(db_path, rule_pk, {"enabled": not rule["enabled"]})


# ---------- 整改工单 ----------
def _order_row(row):
    return dict(row)


def list_work_orders(db_path, status=None, dimension_cn=None):
    conn = connect(db_path)
    sql = "SELECT * FROM work_orders"
    where, params = [], []
    if status:
        where.append("status = ?")
        params.append(status)
    if dimension_cn:
        where.append("dimension_cn = ?")
        params.append(dimension_cn)
    if where:
        sql += " WHERE " + " AND ".join(where)
    sql += " ORDER BY id DESC"
    rows = conn.execute(sql, params).fetchall()
    conn.close()
    return [_order_row(r) for r in rows]


def add_work_order(db_path, ticket_no, record_ref, defect_cn, root_cause,
                   dimension_cn, measure, owner, status, ts):
    conn = connect(db_path)
    with conn:
        cur = conn.execute(
            "INSERT INTO work_orders (ticket_no, record_ref, defect_cn, root_cause, dimension_cn,"
            " measure, owner, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (ticket_no, record_ref, defect_cn, root_cause, dimension_cn, measure, owner, status, ts, ts),
        )
        order_id = cur.lastrowid
        row = conn.execute("SELECT * FROM work_orders WHERE id = ?", (order_id,)).fetchone()
    conn.close()
    return dict(row)


def update_work_order_status(db_path, order_id, status, ts):
    conn = connect(db_path)
    with conn:
        conn.execute(
            "UPDATE work_orders SET status=?, updated_at=? WHERE id=?", (status, ts, order_id)
        )
        row = conn.execute("SELECT * FROM work_orders WHERE id = ?", (order_id,)).fetchone()
    conn.close()
    return dict(row) if row else None


def get_work_order(db_path, order_id):
    conn = connect(db_path)
    row = conn.execute("SELECT * FROM work_orders WHERE id = ?", (order_id,)).fetchone()
    conn.close()
    return dict(row) if row else None


# ---------- 闭环验证记录 ----------
def _run_row(row):
    d = dict(row)
    for key in ("per_class", "measures"):
        try:
            d[key] = json.loads(d.get(key) or "[]")
        except Exception:
            d[key] = []
    return d


def save_closed_loop_run(db_path, ticket_no, batch_key, batch_label, sample_size,
                         before_rate, after_rate, drop_pct, verdict, per_class, measures, ts,
                         orders=None):
    conn = connect(db_path)
    with conn:
        cur = conn.execute(
            "INSERT INTO closed_loop_runs (ticket_no, batch_key, batch_label, sample_size,"
            " before_rate, after_rate, drop_pct, verdict, per_class, measures, created_at)"
            " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                ticket_no, batch_key, batch_label, int(sample_size),
                float(before_rate), float(after_rate), float(drop_pct), verdict,
                json.dumps(per_class, ensure_ascii=False),
                json.dumps(measures, ensure_ascii=False), ts,
            ),
        )
        run_id = cur.lastrowid
        for o in orders or []:
            conn.execute(
                "INSERT INTO closed_loop_run_orders (run_id, order_id, ticket_no, defect_cn,"
                " root_cause, measure, owner, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    run_id, o.get("id"), o.get("ticket_no"), o.get("defect_cn"),
                    o.get("root_cause"), o.get("measure"), o.get("owner"), o.get("status"),
                ),
            )
        row = conn.execute("SELECT * FROM closed_loop_runs WHERE id = ?", (run_id,)).fetchone()
    conn.close()
    run = _run_row(row)
    run["orders"] = [dict(o) for o in (orders or [])]
    return run


def list_closed_loop_runs(db_path, limit=20):
    conn = connect(db_path)
    rows = conn.execute(
        "SELECT * FROM closed_loop_runs ORDER BY id DESC LIMIT ?", (int(limit),)
    ).fetchall()
    runs = [_run_row(r) for r in rows]
    if runs:
        ids = [r["id"] for r in runs]
        marks = ",".join("?" for _ in ids)
        orows = conn.execute(
            f"SELECT * FROM closed_loop_run_orders WHERE run_id IN ({marks}) ORDER BY id ASC",
            ids,
        ).fetchall()
        by_run = {}
        for o in orows:
            by_run.setdefault(o["run_id"], []).append(dict(o))
        for r in runs:
            r["orders"] = by_run.get(r["id"], [])
    conn.close()
    return runs


def next_ticket_no(db_path, ts):
    conn = connect(db_path)
    n = conn.execute("SELECT COUNT(*) AS n FROM work_orders").fetchone()["n"]
    conn.close()
    return f"WO{ts}{n + 1:03d}"
