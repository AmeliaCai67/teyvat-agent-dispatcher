#!/usr/bin/env bash
# 派活薄壳 · 最小实现
#
# ★ 分工：编排逻辑在 bash（因为它要 exec 命令），消息逻辑在 leyline.mjs。
#   薄壳只做四件事，别的都不做。
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LEYLINE="$HERE/leyline.mjs"
ROOT="${LEYLINE_ROOT:-$(cd "$HERE/.." && pwd)/leylines}"
export LEYLINE_ROOT="$ROOT"

FROM=""; TO=""; THREAD=""; TITLE=""; FORCE=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --from)   FROM="${2:?--from 需要值}"; shift 2 ;;
    --to)     TO="${2:?--to 需要值}";     shift 2 ;;
    --thread) THREAD="${2:?--thread 需要值}"; shift 2 ;;
    --title)  TITLE="${2:-}"; shift 2 ;;
    --force)  FORCE=1; shift ;;
    --)       shift; break ;;
    *)        break ;;
  esac
done

# ★ 变量一律写成 ${VAR}：后面跟中文标点时，bash 会把标点当成变量名的一部分
[[ -n "${FROM}"   ]] || { echo "✗ 缺 --from"   >&2; exit 2; }
[[ -n "${TO}"     ]] || { echo "✗ 缺 --to"     >&2; exit 2; }
[[ -n "${THREAD}" ]] || { echo "✗ 缺 --thread" >&2; exit 2; }
[[ $# -gt 0 ]]        || { echo "✗ 缺要执行的命令（用 -- 分隔）" >&2; exit 2; }

mkdir -p "${ROOT}/mailbox" "${ROOT}/logs" "${ROOT}/heartbeat"

# ① 提醒发起者：还有几条没关的线程
OPEN_COUNT="$(node "${LEYLINE}" open --agent "${FROM}" 2>/dev/null | grep -c '→' || true)"
if [[ "${OPEN_COUNT}" -gt 0 ]]; then
  echo "⚠ ${FROM} 还有 ${OPEN_COUNT} 条未关闭的线程 —— 记得 close" >&2
fi

# ② 被派方正在跑？⇒ 挡下来（★ 除非 --force）
BUSY="$(node -e "
  import('${LEYLINE}').then(m => {
    const hb = m.isBusy('${TO}');
    process.stdout.write(hb ? (hb.event + ' @ ' + hb.ts) : '');
  });
" 2>/dev/null || true)"
if [[ -n "${BUSY}" && "${FORCE}" -ne 1 ]]; then
  echo "✗ ${TO} 正在跑（${BUSY}）—— 等它结束，或加 --force 强行派" >&2
  exit 3
fi

# ③ 落档 —— ★ 失败则【不执行】（fail-closed）
# ★ stderr 不重定向进变量 —— 否则详细原因（比如合法边列表）会被吞掉 ✗
HANDOFF_ID="$(node -e "
  import('${LEYLINE}').then(m => {
    try {
      const id = m.send({ from: '${FROM}', to: '${TO}', type: 'handoff',
                          thread: '${THREAD}', body: process.argv[1] });
      process.stdout.write(id);
    } catch (e) {
      console.error('✗ 留档失败: ' + e.message);
      process.exit(1);
    }
  });
" "$(printf '%s' "$*")")" || { echo "✗ 留档失败，命令【未执行】（fail-closed）" >&2; exit 4; }

LOG="${ROOT}/logs/${HANDOFF_ID}.log"
echo "▶ handoff ${HANDOFF_ID} → 日志 ${LOG}" >&2

# ④ 注入开工须知 + 执行
node -e "
  import('${LEYLINE}').then(m => m.setHeartbeat('${TO}', 'dispatch/working', { handoff: '${HANDOFF_ID}' }));
"
set +e
{ echo "### command: $*"; echo "### started: $(date -u +%FT%TZ)"; } > "${LOG}"
"$@" >> "${LOG}" 2>&1
CODE=$?
set -e
node -e "
  import('${LEYLINE}').then(m => m.setHeartbeat('${TO}', 'dispatch/end', { exit: ${CODE} }));
"

# ⑤ report 落档（★ 被 kill / 超时也要走到这里 —— 真实实现用 trap 兜底）
TAIL="$(tail -c 800 "${LOG}" 2>/dev/null || true)"
node -e "
  import('${LEYLINE}').then(m => m.send({
    from: '${TO}', to: '${FROM}', type: 'report', thread: '${THREAD}',
    ref: '${HANDOFF_ID}',
    body: ['## 结果', '', '退出码: ${CODE}', '', '## 输出尾巴', '', '\`\`\`', process.argv[1], '\`\`\`'].join('\n')
  }));
" "${TAIL}" 2>/dev/null || echo "⚠ report 落档失败（命令已执行完，结果在 ${LOG}）" >&2

echo "✓ 完成（退出码 ${CODE}）" >&2
exit "${CODE}"
