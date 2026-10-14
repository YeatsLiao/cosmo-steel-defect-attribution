# 数据目录

| 路径 | 说明 |
| --- | --- |
| `records.json` | 离线检测记录（闭环与看板口径） |
| `knowledge_base.json` | 行业归因规则库 |
| `platform_data.json` | 离线评测 KPI / 闭环基准 |
| `demo_images/` | NEU-DET **示例样件**与 `manifest.json`（对外 URL：`/demo_images/`） |
| `model/` | ONNX 权重 `best_fp16.onnx` |
| `app.db` | SQLite（首次启动生成，已 gitignore） |
| `uploads/` | 用户上传图（运行时） |
| `annotated/` | 检测框标注输出（运行时） |
