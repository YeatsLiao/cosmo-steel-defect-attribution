"""钢材表面缺陷识别：三通道 detect(image_path)。

通道 A（实时推理）：onnxruntime 可用且 model/best_fp16.onnx 存在时，做 224x224 真实推理：
    - 预处理：RGB → 224x224 → /255 归一化 → NCHW
    - 后处理：类别分数按需 sigmoid → conf=0.25 阈值过滤 → NMS(iou=0.7)
      → 取置信度最高的框类别；并把保留框画回原图。
    - 说明：本 ONNX 的 Detect 头已在导出时包含 sigmoid，类别分数取值区间为 [0,1]
      （实测 crazing_01.jpg 最高类分数 0.5444 ≈ 预期 0.55）；仅当检测到越界原始
      分数（>1 或 <0，即 logits）时才补做 sigmoid，避免重复 sigmoid 造成偏差。
通道 B（离线评测）：onnxruntime 不可用 / 模型缺失 / 推理失败时，读取
    demo_images/manifest.json 中该图离线评测得到的 confidence 字段。
通道 C（报错）：两条通道都不可用时，返回 available=False 并说明原因。

两个通道都不会返回随机值。返回结果带 mode 字段标明走了哪条通道（realtime / offline）。
"""
import base64
import io
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

# 六类固定缺陷顺序（模型输出按此顺序取 argmax，可由 model/classes.json 覆盖）
CLASSES = ["crazing", "inclusion", "patches", "pitted_surface", "rolled-in_scale", "scratches"]
CLASS_CN = {
    "crazing": "龟裂",
    "inclusion": "夹杂",
    "patches": "斑块",
    "pitted_surface": "麻点",
    "rolled-in_scale": "氧化皮压入",
    "scratches": "划痕",
}

# 检测框颜色（与前端 CHART 调色板一致，按类别索引取色）
BOX_COLORS = [
    (47, 212, 196),
    (55, 138, 221),
    (239, 159, 39),
    (99, 153, 34),
    (226, 75, 74),
    (126, 155, 190),
]

# 严重等级按置信度折算（本轮约定口径）
SEVERITY_RULES = ((0.85, "严重"), (0.70, "中等"))

# YOLOv8 训练时后处理参数（与用户提供的训练配置一致）
CONF_THRESHOLD = 0.25
IOU_THRESHOLD = 0.7
INPUT_SIZE = 224

CRAZING_NOTE = "此类缺陷纹理细密，识别难度最高"


def classify_severity(confidence):
    """置信度折算严重等级：>=0.85 严重，>=0.70 中等，其余轻微。"""
    for threshold, level in SEVERITY_RULES:
        if confidence >= threshold:
            return level
    return "轻微"


def _sigmoid(x):
    return 1.0 / (1.0 + np.exp(-x))


def _nms(boxes, scores, iou_threshold):
    """标准 IoU NMS，返回保留索引（按置信度降序）。boxes 为 xyxy。"""
    if len(boxes) == 0:
        return []
    x1, y1, x2, y2 = boxes[:, 0], boxes[:, 1], boxes[:, 2], boxes[:, 3]
    areas = np.maximum(0.0, x2 - x1) * np.maximum(0.0, y2 - y1)
    order = scores.argsort()[::-1]
    keep = []
    while order.size > 0:
        i = order[0]
        keep.append(int(i))
        if order.size == 1:
            break
        xx1 = np.maximum(x1[i], x1[order[1:]])
        yy1 = np.maximum(y1[i], y1[order[1:]])
        xx2 = np.minimum(x2[i], x2[order[1:]])
        yy2 = np.minimum(y2[i], y2[order[1:]])
        inter = np.maximum(0.0, xx2 - xx1) * np.maximum(0.0, yy2 - yy1)
        union = areas[i] + areas[order[1:]] - inter
        iou = inter / np.maximum(union, 1e-9)
        remain = np.where(iou <= iou_threshold)[0]
        order = order[remain + 1]
    return keep


class Detector:
    def __init__(self, base_dir=None):
        from .paths import ROOT, DEMO_DIR, MODEL_DIR, ANNOTATED_DIR

        self.base_dir = Path(base_dir or ROOT)
        self.demo_dir = DEMO_DIR
        self.manifest_path = self.demo_dir / "manifest.json"
        self.model_path = MODEL_DIR / "best_fp16.onnx"
        self.classes_path = MODEL_DIR / "classes.json"
        self.annotated_dir = ANNOTATED_DIR

        self.classes = list(CLASSES)
        if self.classes_path.exists():
            try:
                data = json.loads(self.classes_path.read_text(encoding="utf-8"))
                if isinstance(data, list) and data:
                    self.classes = data
            except Exception:
                pass

        self.manifest = self._load_manifest()
        self.by_file = {m.get("file"): m for m in self.manifest}
        self.by_source = {m.get("source"): m for m in self.manifest}

        self._ort = None
        self._session = None
        self._input_name = None
        self._init_onnx()

    def _load_manifest(self):
        if self.manifest_path.exists():
            try:
                return json.loads(self.manifest_path.read_text(encoding="utf-8"))
            except Exception:
                return []
        return []

    def _init_onnx(self):
        try:
            import onnxruntime as ort
            self._ort = ort
        except Exception:
            self._ort = None
            return
        if self.model_path.exists():
            try:
                self._session = ort.InferenceSession(
                    str(self.model_path), providers=["CPUExecutionProvider"]
                )
                self._input_name = self._session.get_inputs()[0].name
            except Exception:
                self._session = None

    @property
    def realtime_ready(self):
        return self._session is not None

    def status(self):
        return {
            "onnxruntime": self._ort is not None,
            "onnxruntime_version": getattr(self._ort, "__version__", None),
            "model_present": self.model_path.exists(),
            "model_path": "model/best_fp16.onnx" if self.model_path.exists() else None,
            "realtime_ready": self.realtime_ready,
            "conf_threshold": CONF_THRESHOLD,
            "iou_threshold": IOU_THRESHOLD,
            "input_size": INPUT_SIZE,
            "classes": self.classes,
        }

    # ---------- 通道 A：实时推理 ----------
    def _preprocess(self, image_path):
        img = Image.open(image_path).convert("RGB").resize((INPUT_SIZE, INPUT_SIZE))
        arr = np.asarray(img, dtype=np.float32) / 255.0
        arr = np.transpose(arr, (2, 0, 1))[None, ...]
        return np.ascontiguousarray(arr, dtype=np.float32)

    def _postprocess(self, raw):
        """[1, 4+nc, N] → 过滤 + NMS，返回 (boxes_xyxy, scores, class_ids)。"""
        pred = np.asarray(raw, dtype=np.float64)[0].T  # [N, 4+nc]
        boxes_cxcywh = pred[:, :4]
        scores = pred[:, 4:]

        # 本模型已含 sigmoid（分数在 [0,1]）；若拿到的是 logits 则补做 sigmoid
        if scores.size and (scores.max() > 1.0 or scores.min() < 0.0):
            scores = _sigmoid(scores)

        class_ids = scores.argmax(axis=1)
        confs = scores[np.arange(scores.shape[0]), class_ids]

        mask = confs >= CONF_THRESHOLD
        if not mask.any():
            return np.empty((0, 4)), np.empty((0,)), np.empty((0,), dtype=int)

        boxes_cxcywh = boxes_cxcywh[mask]
        confs = confs[mask]
        class_ids = class_ids[mask]

        cx, cy, w, h = boxes_cxcywh[:, 0], boxes_cxcywh[:, 1], boxes_cxcywh[:, 2], boxes_cxcywh[:, 3]
        boxes_xyxy = np.stack([cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2], axis=1)

        # 逐类别 NMS（不同类别互不抑制）
        keep_all = []
        for cid in np.unique(class_ids):
            idx = np.where(class_ids == cid)[0]
            keep = _nms(boxes_xyxy[idx], confs[idx], IOU_THRESHOLD)
            keep_all.extend(idx[k] for k in keep)
        if not keep_all:
            return np.empty((0, 4)), np.empty((0,)), np.empty((0,), dtype=int)

        keep_all = np.array(sorted(keep_all, key=lambda i: confs[i], reverse=True))
        return boxes_xyxy[keep_all], confs[keep_all], class_ids[keep_all]

    def _infer(self, image_path):
        arr = self._preprocess(image_path)
        outputs = self._session.run(None, {self._input_name: arr})
        boxes, confs, class_ids = self._postprocess(outputs[0])

        # 缩放到原图尺寸
        with Image.open(image_path) as im:
            orig_w, orig_h = im.size
        sx = orig_w / INPUT_SIZE
        sy = orig_h / INPUT_SIZE
        if len(boxes):
            boxes[:, [0, 2]] *= sx
            boxes[:, [1, 3]] *= sy

        detections = []
        for (box, conf, cid) in zip(boxes, confs, class_ids):
            defect = self.classes[int(cid)] if int(cid) < len(self.classes) else self.classes[-1]
            detections.append(
                {
                    "class_id": int(cid),
                    "defect": defect,
                    "defect_cn": CLASS_CN.get(defect, defect),
                    "confidence": round(float(conf), 4),
                    "box": [round(float(v), 1) for v in box],
                }
            )

        if not detections:
            raise ValueError("未检出任何超过 conf=%.2f 的目标" % CONF_THRESHOLD)

        return detections

    def _draw(self, image_path, detections):
        """把 NMS 后的检测框画回原图并保存为 base64 预览与文件。"""
        with Image.open(image_path).convert("RGB") as im:
            canvas = im.copy()
        draw = ImageDraw.Draw(canvas)
        for det in detections:
            x1, y1, x2, y2 = det["box"]
            color = BOX_COLORS[det["class_id"] % len(BOX_COLORS)]
            draw.rectangle([x1, y1, x2, y2], outline=color, width=3)
            label = "%s %.2f" % (det["defect_cn"], det["confidence"])
            tx, ty = x1, max(0, y1 - 14)
            draw.rectangle([tx, ty, tx + max(64, len(label) * 7), ty + 14], fill=color)
            draw.text((tx + 3, ty + 1), label, fill=(14, 27, 46))

        self.annotated_dir.mkdir(exist_ok=True)
        out_name = "annotated_" + Path(image_path).name
        out_path = self.annotated_dir / out_name
        canvas.save(out_path, quality=90)

        buf = io.BytesIO()
        canvas.save(buf, format="JPEG", quality=90)
        b64 = base64.b64encode(buf.getvalue()).decode("ascii")
        return out_name, "data:image/jpeg;base64," + b64

    # ---------- 主入口 ----------
    def detect(self, image_path):
        image_path = Path(image_path)
        name = image_path.name

        # 通道 A
        if self.realtime_ready:
            try:
                detections = self._infer(image_path)
                top = detections[0]
                annotated_name, annotated_data_url = self._draw(image_path, detections)
                return self._build_result(
                    mode="realtime",
                    available=True,
                    file=name,
                    defect=top["defect"],
                    confidence=top["confidence"],
                    detections=detections,
                    annotated_name=annotated_name,
                    annotated_data_url=annotated_data_url,
                )
            except Exception as exc:  # 推理失败则回退通道 B
                fallback_reason = "实时推理失败：" + str(exc)
        else:
            fallback_reason = "实时模型未就绪"

        # 通道 B
        entry = self._match_offline(name)
        if entry:
            return self._build_result(
                mode="offline",
                available=True,
                file=entry.get("file", name),
                defect=entry.get("defect"),
                confidence=float(entry.get("confidence", 0.0)),
                note=fallback_reason,
            )

        # 通道 C
        return {
            "mode": "offline",
            "mode_cn": "离线评测结果",
            "available": False,
            "file": name,
            "reason": fallback_reason + "，且该图片不在示例样件离线评测清单中，无可用置信度。",
        }

    def _match_offline(self, name):
        """按文件名精确匹配，其次按上传文件名中包含的样件名匹配。"""
        entry = self.by_file.get(name) or self.by_source.get(name)
        if entry:
            return entry
        for manifest_name, m in self.by_file.items():
            if manifest_name and manifest_name in name:
                return m
        return None

    def _build_result(self, mode, available, file, defect, confidence, note=None, **extra):
        confidence = round(float(confidence), 4)
        result = {
            "mode": mode,
            "mode_cn": "实时推理" if mode == "realtime" else "离线评测结果",
            "available": available,
            "file": file,
            "defect": defect,
            "defect_cn": CLASS_CN.get(defect, defect),
            "confidence": confidence,
            "confidence_pct": round(confidence * 100, 2),
            "severity": classify_severity(confidence),
        }
        if defect == "crazing":
            result["note"] = CRAZING_NOTE
        if mode == "offline" and note:
            result["fallback_reason"] = note
        if mode == "realtime":
            detections = extra.get("detections") or []
            result["detections"] = detections
            result["detection_count"] = len(detections)
            result["annotated_name"] = extra.get("annotated_name")
            result["annotated_data_url"] = extra.get("annotated_data_url")
        return result


if __name__ == "__main__":
    import pprint
    import sys

    from .paths import DEMO_DIR

    detector = Detector()
    pprint.pprint(detector.status())
    target = sys.argv[1] if len(sys.argv) > 1 else "crazing_01.jpg"
    pprint.pprint(detector.detect(DEMO_DIR / target))
