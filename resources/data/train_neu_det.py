"""NEU-DET 钢材表面缺陷 YOLOv8n 训练 + 评测 + ONNX 导出。

产出（均在 01-数据/model/ 下）：
  weights/best.pt        训练最优权重
  onnx/best.onnx        ONNX 权重，用于上传平台
  metrics/report.md      测试集评测报告（准确率 / mAP，论文与给评委用）
"""
import os
import json
import shutil
from pathlib import Path

ROOT = Path(r"D:\2.Project\卡奥斯2026智能应用开发者大赛\03参赛作品-质量缺陷归因\01-数据")
SRC = ROOT / "NEU-DET-src" / "data" / "NEU-DET"
OUT = ROOT / "model"
OUT.mkdir(parents=True, exist_ok=True)

NAMES = ["crazing", "inclusion", "patches", "pitted_surface", "rolled-in_scale", "scratches"]
CN = ["龟裂", "夹杂", "斑块", "麻点", "氧化皮压入", "划痕"]

# 生成 data.yaml
yaml_path = OUT / "neu-det.yaml"
yaml_path.write_text(
    "path: " + str(SRC).replace("\\", "/") + "\n"
    "train: train/images\n"
    "val: test/images\n"
    "test: test/images\n"
    "names:\n" + "".join(f"  {i}: {n}\n" for i, n in enumerate(NAMES)),
    encoding="utf-8",
)
print("[data.yaml]", yaml_path)

from ultralytics import YOLO  # noqa: E402

model = YOLO(str(ROOT / "yolov8n.pt"))

results = model.train(
    data=str(yaml_path),
    epochs=80,
    imgsz=224,
    batch=16,
    device="cpu",
    workers=0,
    patience=15,
    project=str(OUT / "runs"),
    name="train",
    exist_ok=True,
    plots=True,
    verbose=True,
)
print("[train done]")

# 测试集评测
metrics = model.val(data=str(yaml_path), split="test", imgsz=224, device="cpu", workers=0)
print("[val] mAP50:", metrics.box.map50, "mAP50-95:", metrics.box.map)

# 逐类别 AP
per_class = {}
try:
    ap = metrics.box.ap50  # 数组，按类别
    for i, n in enumerate(NAMES):
        per_class[n] = round(float(ap[i]), 4)
except Exception as e:
    print("per-class AP unavailable:", e)

# 图片级准确率 Top-1
top1, top5, total = 0, 0, 0
for split in ["test"]:
    img_dir = SRC / split / "images"
    for p in sorted(img_dir.glob("*.jpg")):
        lbl = SRC / split / "labels" / (p.stem + ".txt")
        truth = set()
        if lbl.exists():
            for line in lbl.read_text().splitlines():
                q = line.split()
                if q:
                    truth.add(int(q[0]))
        if not truth:
            continue
        total += 1
        preds = model.predict(source=str(p), imgsz=224, device="cpu", verbose=False)[0]
        got = set()
        if preds.boxes is not None and len(preds.boxes):
            import torch
            confs = preds.boxes.conf
            clses = preds.boxes.cls
            order = torch.argsort(confs, descending=True)[:5]
            got = {int(clses[i]) for i in order}
            top5 += 1 if (truth & got) else 0
            if int(clses[int(order[0])]) in truth:
                top1 += 1
print(f"[image-level] top1={top1}/{total}={top1/max(total,1):.4f}  top5={top5}/{total}={top5/max(total,1):.4f}")

# 导出 ONNX
onnx_dir = OUT / "onnx"
onnx_dir.mkdir(exist_ok=True)
best = OUT / "runs" / "train" / "weights" / "best.pt"
model = YOLO(str(best))
onnx_path = model.export(format="onnx", imgsz=224, opset=12, simplify=True)
print("[onnx]", onnx_path)
shutil.move(onnx_path, onnx_dir / "best.onnx")

report = OUT / "metrics"
report.mkdir(exist_ok=True)
(report / "report.md").write_text(
    "# NEU-DET 钢材表面缺陷 YOLOv8n 评测报告\n\n"
    f"- 训练集：1620 张 / 3743 个标注框；测试集：180 张\n"
    f"- 输入尺寸：224x224；模型：YOLOv8n；设备：CPU\n\n"
    "## 检测精度\n\n"
    f"| 指标 | 数值 |\n| --- | --- |\n"
    f"| mAP@0.5 | {float(metrics.box.map50):.4f} |\n"
    f"| mAP@0.5:0.95 | {float(metrics.box.map):.4f} |\n"
    f"| 图片级 Top-1 准确率 | {top1/max(total,1)*100:.2f}% ({top1}/{total}) |\n"
    f"| 图片级 Top-5 命中率 | {top5/max(total,1)*100:.2f}% ({top5}/{total}) |\n\n"
    "## 逐类别 AP@0.5\n\n| 类别 | 中文 | AP@0.5 |\n| --- | --- | --- |\n"
    + "".join(f"| {NAMES[i]} | {CN[i]} | {per_class.get(NAMES[i], '-')} |\n" for i in range(6))
    + f"\n- ONNX 权重：`{onnx_dir / 'best.onnx'}`\n",
    encoding="utf-8",
)
print("[report]", report / "report.md")
print("ALL DONE")
