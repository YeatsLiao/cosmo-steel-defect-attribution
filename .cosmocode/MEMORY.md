# 用户指令记忆

本文件记录了用户的指令、偏好和教导，用于在未来的交互中提供参考。

## 格式

### 用户指令条目
用户指令条目应遵循以下格式：

[用户指令摘要]
- Date: [YYYY-MM-DD]
- Context: [提及的场景或时间]
- Instructions:
  - [用户教导或指示的内容，逐行描述]

### 项目知识条目
Agent 在任务执行过程中发现的条目应遵循以下格式：

[项目知识摘要]
- Date: [YYYY-MM-DD]
- Context: Agent 在执行 [具体任务描述] 时发现
- Category: [运维部署|构建方法|测试方法|排错调试|工作流协作|环境配置]
- Instructions:
  - [具体的知识点，逐行描述]

## 去重策略
- 添加新条目前，检查是否存在相似或相同的指令
- 若发现重复，跳过新条目或与已有条目合并
- 合并时，更新上下文或日期信息
- 这有助于避免冗余条目，保持记忆文件整洁

## 条目

[项目固定技术约束]
- Date: 2026-10-13
- Context: 用户明确要求本轮及后续每一轮都遵守
- Instructions:
  - 后端 Python + FastAPI；前端原生 HTML/CSS/JS 单页（static/ 目录），禁止 React / Vite / npm 构建
  - 图表统一使用 ECharts CDN
  - 数据存 SQLite，路径为项目根目录 data.db
  - 视觉严格按根目录 style_guide.md 执行，所有页面配色/字号/间距必须统一，只用字重 400 和 500
  - 不编造冶金工艺内容，一律读 knowledge_base.json
  - 不重写归因逻辑，直接复用 attribution_engine.py，只包一层 FastAPI 路由
  - 演示数据一律取 records.json 或 platform_data.json，禁用 random 现编
  - 凡展示模拟/仿真数据的位置，必须就近标注来源

[每轮交付要求]
- Date: 2026-10-13
- Context: 用户明确要求
- Instructions:
  - 每轮结束后启动服务，确认 http://0.0.0.0:8000 可访问，并给出预览地址

[项目运行与依赖]
- Date: 2026-10-13
- Context: Agent 在搭建骨架与检测工作台时发现
- Category: 运维部署
- Instructions:
  - 启动服务命令：cd /workspace && python3 -m uvicorn app:app --host 0.0.0.0 --port 8000
  - Python 依赖记录在 requirements.txt（fastapi、uvicorn[standard]、pillow、numpy、onnxruntime、python-multipart）；安装用 pip install --break-system-packages
  - 实时推理模型约定路径为 model/best_fp16.onnx（输入 224x224，六类顺序见 detector.py CLASSES，可用 model/classes.json 覆盖）
  - SQLite 位于项目根目录 data.db，首次初始化从 records.json 导入前 200 条历史记录
  - 上传图片保存在 uploads/，示例样件在 demo_images/
  - 检测记录中 records.json 的 defect_type 为 null 的表示无缺陷（约 730 条），导入时映射为「无缺陷」

[归因引擎复用与验证]
- Date: 2026-10-13
- Context: Agent 在实现归因诊断模块时发现
- Category: 排错调试
- Instructions:
  - 归因一律复用 attribution_engine.py，禁止另写规则；路由为 GET /api/attribute/schema 与 POST /api/attribute（封装在 attribute_service.py）
  - knowledge_base.json 的规则条件字段用 flux_batch，但 attribution_engine.CHECKS 读取的是 flux_batch_abnormal；两者不一致，故该候选根因强度恒为 0，属引擎既有行为，勿"修复"
  - attribution_engine 的 CHECKS lambda 直接下标访问字段，缺字段会抛 KeyError；缺失字段需在封装层做中性填充并从证据中剔除，不可直接传空
  - 验证方法：platform_data.json 的 attribution_demos 可用其 record_id 从 records.json 取回 context，引擎输出与 demo 完全一致（top_root_cause 与 confidence 均吻合），可作为回归基准

[对话模型网关调用]
- Date: 2026-10-13
- Context: Agent 在实现自然语言问答时发现
- Category: 环境配置
- Instructions:
  - 可用环境变量 MCAI_LLM_BASE_URL（OpenAI 兼容，已含 /v1）、MCAI_LLM_API_KEY、MCAI_LLM_MODEL，通过 POST {BASE_URL}/chat/completions 调用；密钥严禁输出到回复或日志
  - 模型为推理模型：最终答案在 message.content，思维链在 message.reasoning_content；max_tokens 给小会把额度耗在思维链上导致 content 为空，需给足（本应用用 1600）并设置较长超时
  - 问答实现见 qa_service.py，回答强制注入本次归因证据链与知识库规则，超范围需明确说不确定

[知识库与工单存储]
- Date: 2026-10-13
- Context: Agent 在实现知识库/建议/工单模块时发现
- Category: 工作流协作
- Instructions:
  - 知识库规则存于 SQLite 表 kb_rules，初始化时从 knowledge_base.json 导入 30 条；归因引擎由「启用状态」的规则动态构建（见 attribute_service.get_engine），因此知识库启停/编辑解决策略会影响归因与建议
  - 建议可执行率判定见 suggestion_service.py，三条同时满足：含具体数值 / 含量化依据（物理量纲、≥≤、区间、可数单位）/ 不含空泛口号词（加强/重视/意识/责任心）；当前 30 条规则判定结果为 30/30=100%
  - 整改工单存于 SQLite 表 work_orders，状态流转固定为 待处理→处理中→已解决→已关闭
  - 新增文件 fields.py 集中存放工艺字段中文名/量纲/维度映射，归因表单、知识库触发条件格式化共用

[闭环验证判定阈值与推演口径]
- Date: 2026-10-13
- Context: 用户在设计闭环验证模块时明确指示
- Instructions:
  - 闭环判定达标线用降幅 ≥20% 判「闭环有效」，≥30% 判「效果显著」，低于 20% 判「效果不显著」；禁止把 30% 当作唯一达标线（本数据集整体保守推演降幅 25.64%，39.17%→29.12%，按 20% 判定才符合实际）
  - 整改后缺陷率 = 整改前缺陷率 × (1 - 已执行建议预期降幅的累乘 × 归因正确率)；只统计归因正确的件，归因错误的件不产生改善
  - 页面显著位置必须标注「闭环验证为基于规则库预期降幅参数的工况推演，用于演示闭环逻辑，不代表真实产线效果」，并说明接入真实产线后替换预期降幅为实测数据即可输出真实对比，不许隐瞒是仿真
  - 实现见 closed_loop_service.py，接口 /api/closed-loop/batches、/api/closed-loop/verify、/api/closed-loop/runs；工单「执行整改」走 /api/work-orders/{id}/rectify 后进入闭环验证页

[分析看板数据口径与告警规则]
- Date: 2026-10-13
- Context: 用户要求实现分析看板与质量告警时明确的口径
- Instructions:
  - 看板聚合接口 /api/dashboard，实现见 dashboard_service.py；指标卡、缺陷/严重/维度分布、月度趋势直接取 platform_data.json；Top5 根因命中次数按 records.json 的 true_root_cause 统计并回连规则库取策略；平均处置时长取工单创建→处置时长（无已推进工单时显示「—」）；闭环达标率 = closed_loop.per_class 中「有效降幅=综合预期降幅×归因正确率 ≥20%」的缺陷类占比
  - platform_data.json 的 monthly_trend 仅含 2026-06~2026-09 共 4 个月，页面须如实标注覆盖范围，不得编造到 12 个月
  - 质量告警规则：单次检测出现「严重」等级，或某缺陷类型最近 24 小时（以当前时间为准）出现 >3 次；实现见 alert_service.py，接口 /api/alerts、/api/alerts/notify
  - 告警推送 Webhook 从环境变量读取，优先级 FEISHU_WEBHOOK_URL > DINGTALK_WEBHOOK_URL > ALERT_WEBHOOK_URL > MCAI_ALERT_WEBHOOK；未配置时不发起请求并返回配置指引；URL 含 feishu/lark 用飞书格式、含 dingtalk 用钉钉格式，否则通用格式
  - 前端图表统一走 CHART 调色板（primary/accent/warn/ok/danger/muted，对应 #2FD4C4/#378ADD/#EF9F27/#639922/#E24B4A/#7E9BBE），图表容器均为宽度 100%、自适应窗口 resize

[告警 Webhook 推送排错]
- Date: 2026-10-13
- Context: Agent 在验证飞书告警推送时发现
- Category: 排错调试
- Instructions:
  - 飞书自定义机器人若开启「签名校验」，直接 POST 会返回 HTTP 200 但 body 为 code=19021（sign match fail）；此时必须配置 FEISHU_WEBHOOK_SECRET，并在请求体带 timestamp + sign（sign=base64(HMAC-SHA256(key=f"{timestamp}\n{secret}", msg=""))）；成功响应为 code==0 或 StatusCode==0
  - 判定送达不能只看 HTTP 状态码，必须解析响应体的 code/errcode，否则会把失败当成功；实现见 alert_service._check_response
  - 后端 `.env` 由 app.py 的 _load_dotenv() 在启动时载入且不覆盖已存在的环境变量，改动 .env 后必须重启 uvicorn 才生效
  - 推送可用 POST /api/alert/push 或 POST /api/alerts/notify 验证（同源逻辑）；Webhook 地址与密钥只存 .env（已 gitignore），严禁写入前端 static/

[实时推理模型与后处理口径]
- Date: 2026-10-13
- Context: Agent 在接入 best_fp16.onnx 实时推理时发现
- Category: 排错调试
- Instructions:
  - 模型 model/best_fp16.onnx（YOLOv8n FP16 导出）：输入 [1,3,224,224]，输出 [1,10,1029]（前 4 为 cx,cy,w,h 像素坐标，后 6 为六类分数）
  - 关键：该 ONNX 的 Detect 头已包含 sigmoid，类别分数已是 [0,1] 概率（实测 crazing_01.jpg 最高类分数 0.5444）；重复 sigmoid 会变成 0.63 与预期 0.55 偏离，故只在检测到越界原始分数（>1 或 <0，即 logits）时才补 sigmoid
  - 预处理只用 /255 归一化，不能用 ImageNet mean/std（用了会把 crazing_01 误判为类 3），输入尺寸固定 224
  - 后处理参数与训练一致：conf=0.25 阈值过滤 + 逐类别 NMS(iou=0.7)，取置信度最高框类别
  - 校验基准：demo_images/crazing_01.jpg 实时推理应为类别 0（crazing 龟裂）、置信度约 0.5444（≈0.55）；18 张示例图实时推理全部命中各自文件名对应类别
- 推理依赖 onnxruntime（本环境已装 1.31.0，勿装 ultralytics）；三通道：A 实时 / B 离线 manifest 回退 / C 报错，结果带 mode(realtime|offline) 与 mode_cn
- NMS 后检测框用 PIL 画回原图，输出到 annotated/（已 gitignore）并挂载 /annotated；上传自定义图片走同一实时推理路径

[前端改动快速校验方法]
- Date: 2026-10-13
- Context: Agent 在多轮前端（static/ 原生单页）改动后需要快速校验时发现
- Category: 测试方法
- Instructions:
  - 校验 JS 语法：node --check static/js/app.js
  - 校验 CSS 括号平衡：用 node 统计 static/css/app.css 的 { 与 } 数量是否相等
  - 校验静态资源：curl -s -o /dev/null -w "%{http_code}" http://localhost:8000/ 及 /static/css/app.css、/static/js/app.js 应为 200
  - 前端无构建步骤，改完直接刷新即可；无需 npm
