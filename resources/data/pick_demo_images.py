"""从 NEU-DET 测试集挑选每类置信度最高的代表图，作为平台演示素材。

挑选标准：模型预测置信度高且预测正确的图，避免用模棱两可的样本当示例。
同时输出 manifest.json，带中文缺陷名与模型置信度，供页面直接渲染。
"""
import json
import shutil
import zipfile
from collections import defaultdict
from pathlib import Path

from ultralytics import YOLO

ROOT = Path(__file__).parent
TEST = ROOT / "NEU-DET-src" / "data" / "NEU-DET" / "test"
OUT = ROOT.parent / "04-平台素材" / "demo_images"
MODEL = ROOT / "model" / "onnx" / "best_fp16.onnx"
PER_CLASS = 3

NAMES = {
    "crazing": "龟裂", "inclusion": "夹杂", "patches": "斑块",
    "pitted_surface": "麻点", "rolled-in_scale": "氧化皮压入", "scratches": "划痕",
}

OUT.mkdir(parents=True, exist_ok=True)
model = YOLO(str(MODEL), task="detect")

buckets = defaultdict(list)
for img in sorted((TEST / "images").glob("*.jpg")):
    lbl = TEST / "labels" / (img.stem + ".txt")
    truth = {int(l.split()[0]) for l in lbl.read_text().splitlines() if l.split()}
    if not truth:
        continue
    r = model.predict(source=str(img), imgsz=224, conf=0.25, device="cpu", verbose=False)[0]
    if r.boxes is None or not len(r.boxes):
        continue
    cls = int(r.boxes.cls[int(r.boxes.conf.argmax())])
    conf = float(r.boxes.conf.max())
    if cls in truth:
        buckets[NAMES and list(NAMES)[cls]].append((conf, img))

manifest = []
for i, (en, cn) in enumerate(NAMES.items()):
    picks = sorted(buckets.get(en, []), reverse=True)[:PER_CLASS]
    for j, (conf, src) in enumerate(picks, 1):
        dst_name = f"{en}_{j:02d}.jpg"
        shutil.copy(src, OUT / dst_name)
        manifest.append({
            "file": dst_name,
            "defect": en,
            "defect_cn": cn,
            "confidence": round(conf, 4),
            "source": src.name,
            "description": f"{cn}典型样例，模型置信度 {conf*100:.1f}%",
        })
    print(f"{cn:6s} 候选 {len(buckets.get(en, [])):3d} 张，取 {len(picks)} 张")

(OUT / "manifest.json").write_text(
    json.dumps(manifest, ensure_ascii=False, indent=1), encoding="utf-8")

zpath = OUT.parent / "demo_images.zip"
with zipfile.ZipFile(zpath, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
    for p in sorted(OUT.glob("*.jpg")):
        z.write(p, p.name)
    z.write(OUT / "manifest.json", "manifest.json")

print(f"\n产出 {len(manifest)} 张 -> {OUT}")
print(f"打包 {zpath.name} {zpath.stat().st_size/1024:.0f} KB")
