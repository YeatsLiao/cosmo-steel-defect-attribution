#!/usr/bin/env bash
# 停止「钢材质量缺陷归因与闭环处置平台」服务。
# 端口固定 8000；使用 ss 提取监听该端口的 PID 后终止，避免 fuser/lsof 缺失。

set -u

PORT=8000

# 通过 ss 提取监听端口的进程 PID（可能多个），去重输出
collect_pids() {
  ss -ltnp "sport = :${PORT}" | grep -oP 'pid=\K[0-9]+' | sort -u
}

pids=$(collect_pids)

if [ -z "${pids}" ]; then
  echo "端口 ${PORT} 无监听进程，无需停止"
  exit 0
fi

echo "停止端口 ${PORT} 上的进程：${pids}"

# 先发送 TERM，给进程优雅退出（含 uvicorn 子进程）的机会
for pid in ${pids}; do
  kill "${pid}"
done

# 有界轮询等待端口释放（不使用 timeout，避免误杀后续服务）
for _ in $(seq 1 20); do
  if [ -z "$(collect_pids)" ]; then
    break
  fi
  sleep 0.5
done

# 仍未退出则强制终止，确保端口彻底释放
remain=$(collect_pids)
if [ -n "${remain}" ]; then
  echo "进程未在等待时间内退出，强制终止：${remain}"
  for pid in ${remain}; do
    kill -9 "${pid}"
  done
  sleep 0.5
fi

if [ -z "$(collect_pids)" ]; then
  echo "服务已停止，端口 ${PORT} 已释放"
  exit 0
fi

echo "服务停止失败，端口 ${PORT} 仍被占用"
exit 1
