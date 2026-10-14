#!/usr/bin/env node
/**
 * 哨兵 · 最小实现（生产上 cron 每小时跑一次）
 *
 * ★ 两个机制都遵守同一条：只报警，不处置。
 *   起因是一次真实误判——有人误判正在跑的 agent"僵死"，差点杀掉它。
 *   "看起来停了"和"真的停了"是两件事，而【误杀不可逆】。
 */
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { read, openThreads, setHeartbeat } from './leyline.mjs';

const ROOT  = path.resolve(process.env.LEYLINE_ROOT || './leylines');
const INBOX = path.join(ROOT, 'inbox');
const ROUND_TRIP_LIMIT = 6;      // 一个线程里 handoff+report 到几次就升级
const GRACE_MS = 5 * 60 * 1000;  // 裸跑宽限（合法 detach 的启动时间贴着它的 handoff）

fs.mkdirSync(INBOX, { recursive: true });
const alerts = [];

// ── 机制 ①：往返熔断 ──────────────────────────────────
for (const th of new Set(openThreads().map(m => m.thread))) {
  const msgs = read().filter(m => m.thread === th);
  const n = msgs.filter(m => m.type === 'handoff' || m.type === 'report').length;
  if (n >= ROUND_TRIP_LIMIT) {
    alerts.push(`往返熔断：线程 ${th} 已有 ${n} 次往返仍未关闭`);
  }
}

// ── 机制 ②：裸跑检测 ──────────────────────────────────
// ★ 判据【只看时间序】：有执行器在跑，且它的启动时间【晚于】最后一次留档。
//   为什么不看"有没有未关闭的 handoff"？—— 那会被
//   "发起人已离场、没人关的老线程"【永久静音】（实测踩过）。
const EXECUTORS = [/claude\s+(-p|--resume)/, /codex\s+exec/, /kimi\s+.*-p/];
let lastArchive = 0;
for (const m of read()) {
  const t = Date.parse(m.created || '');
  if (!Number.isNaN(t) && t > lastArchive) lastArchive = t;
}
for (const [pid, cmd] of listProcesses()) {
  if (!EXECUTORS.some(re => re.test(cmd))) continue;
  const started = procStartMs(pid);   // ★ 真实实现：解析 `ps -o lstart=`
  if (started > lastArchive + GRACE_MS) {
    alerts.push(`疑似裸跑（未留档就起执行器）：pid ${pid} ${cmd.slice(0, 80)}`);
  }
}

function procStartMs(pid) {
  // 真实系统里这样拿进程启动时间；拿不到就返回 0（宁可不报，也不要误报）
  try {
    const t = execSync(`ps -o lstart= -p ${pid}`, { encoding: 'utf8' }).trim();
    const ms = Date.parse(t);
    return Number.isNaN(ms) ? 0 : ms;
  } catch { return 0; }
}

function listProcesses() {
  try {
    const out = execSync('ps -eo pid=,command=', { encoding: 'utf8' });
    return out.split('\n').map(l => l.trim()).filter(Boolean)
              .map(l => [l.split(/\s+/)[0], l.split(/\s+/).slice(1).join(' ')]);
  } catch { return []; }
}

// ── 写进 inbox（★ 只报警，不杀任何进程）────────────────
if (alerts.length) {
  const f = path.join(INBOX, `${new Date().toISOString().slice(0, 10)}.md`);
  const text = `\n## ${new Date().toISOString()}\n\n` +
               alerts.map(a => `- ⚠ ${a}`).join('\n') + '\n';
  fs.appendFileSync(f, text, 'utf8');
  console.error(alerts.map(a => '⚠ ' + a).join('\n'));
  console.error(`\n（已写入 ${f} —— ★ 只报警，没有处置任何进程）`);
} else {
  setHeartbeat('sentinel', 'sentinel/ok');
  console.log('✓ 哨兵检查完毕：无异常');
}
