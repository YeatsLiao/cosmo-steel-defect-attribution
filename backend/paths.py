"""项目根路径与数据目录（Cosmo 工作目录 = 仓库根，app.py 与 start.sh 同级）。"""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data"

DB_PATH = DATA_DIR / "app.db"
RECORDS_PATH = DATA_DIR / "records.json"
KB_PATH = DATA_DIR / "knowledge_base.json"
PLATFORM_DATA_PATH = DATA_DIR / "platform_data.json"

DEMO_DIR = DATA_DIR / "demo_images"
MODEL_DIR = DATA_DIR / "model"
UPLOAD_DIR = DATA_DIR / "uploads"
ANNOTATED_DIR = DATA_DIR / "annotated"

STATIC_DIR = ROOT / "static"
DOCS_DIR = ROOT / "docs"
