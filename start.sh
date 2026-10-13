#!/usr/bin/env bash
# 启动「钢材质量缺陷归因与闭环处置平台」服务。
# 生产模式：不启用 --reload、单 worker，显式压低内存峰值，避免容器 OOM。
# 端口固定 8000。返回码：已在运行=0，启动成功=0，启动失败=2。

set -u

PORT=8000
HOST=0.0.0.0
APP_DIR="/workspace"
LOG_FILE="${APP_DIR}/app.log"
PID_FILE="${APP_DIR}/app.pid"

# 通过 ss 提取监听端口的进程 PID，去重输出
collect_pids() {
  ss -ltnp "sport = :${PORT}" | grep -oP 'pid=\K[0-9]+' | sort -u
}

# 先校验是否已启动：已启动直接返回 0
if [ -n "$(collect_pids)" ]; then
  echo "服务已在端口 ${PORT} 运行，跳过启动"
  exit 0
fi

cd "${APP_DIR}" || exit 2

# 生产模式环境变量：先 export 再 nohup，避免环境变量前缀被 nohup 当作命令名执行
export PYTHONUNBUFFERED=1
export MALLOC_ARENA_MAX=2
export OMP_NUM_THREADS=1

# nohup 只接收可执行文件路径作为第一个参数，环境变量已通过 export 注入
nohup python3 -m uvicorn app:app --host "${HOST}" --port "${PORT}" --workers 1 > "${LOG_FILE}" 2>&1 &
echo $! > "${PID_FILE}"

# 有界轮询等待服务就绪（不使用 timeout，避免到时自动退出）
for _ in $(seq 1 40); do
  if [ -n "$(collect_pids)" ]; then
    if curl -s -o /dev/null "http://127.0.0.1:${PORT}/"; then
      echo "服务启动成功：http://${HOST}:${PORT}"
      exit 0
    fi
  fi
  sleep 0.5
done

echo "服务启动失败，请查看日志：${LOG_FILE}"
exit 2
