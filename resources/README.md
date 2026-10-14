# 素材

参赛提交、文章配图、复现脚本、喂给平台的原始素材。应用不读这里，运行时数据在 `data/`。

| 目录 | 内容 |
| --- | --- |
| `showcase/` | 4 张展示图，仓库头图和应用中心封面 |
| `video/` | `demo-30s.mp4`，参赛提交用 B 站 41 秒版 |
| `article/` | 作品说明文章两版 + 30 张截图 |
| `prompts/` | 16 份开发提示词，按轮次编号 |
| `data/` | 复现脚本、评测报告、模型上传包 |
| `platform-assets/` | 上传平台的原样素材和三个压缩包 |

## data/

| 文件 | 作用 |
| --- | --- |
| `train_neu_det.py` + `neu-det.yaml` | NEU-DET 训 YOLOv8n，导出 FP16 |
| `generate_records.py` | 生成 1200 条带确定根因的记录 |
| `eval_metrics.py` | 复算 94.44% / 94.68% / 100% |
| `refine_solutions.py` | 可执行率 46.6% → 100% 的修正 |
| `pick_demo_images.py` | 挑演示样件 |
| `*_eval.md`、`*_simulation.md`、`*_executability.md` | 三项指标评测报告 |
| `model/best_fp16.zip` | 模型上传包 5.61 MB，含 `report.md` |

## 重复项

这里存上传平台的原样，`data/`、`docs/` 存运行时版本，两边各留一份便于对照。

- `records.json`、`knowledge_base.json`、`platform_data.json` — 与 `data/` 一致
- `attribution_engine.py` — 190 行上传原样，`backend/` 那份 202 行加了工程包装
- `style_guide.md` — 仓内 `docs/` 那份更新
- `demo_images/` — 这里 18 张，仓内 30 张

## 上传的三个包

`best_fp16.zip`（5.61 MB，自定义模型入口）、`platform_assets.zip`（478 KB）、`demo_images.zip`（269 KB）。



## 复现

下载 NEU-DET → `train_neu_det.py` 训模型 → `generate_records.py` 造数据 → `eval_metrics.py` 复算指标 → 按 `prompts/` 逐轮在平台上搭应用。换企业 MES 数据后逻辑不改。

NEU-DET 版权归东北大学。
