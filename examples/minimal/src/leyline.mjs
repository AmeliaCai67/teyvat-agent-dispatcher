#!/usr/bin/env node
/**
 * 地脉（消息层）· 最小实现
 *
 * ★ 只有两个原语：写一个 markdown 文件、按条件读一堆 markdown 文件。
 *   没有数据库，因为【人类可读和机器可读不必二选一】。
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT   = path.resolve(process.env.LEYLINE_ROOT || './leylines');
const MAIL   = path.join(ROOT, 'mailbox');
const ARCH   = path.join(MAIL, 'archive');
const LOGS   = path.join(ROOT, 'logs');
const INBOX  = path.join(ROOT, 'inbox');
const HB_DIR = path.join(ROOT, 'heartbeat');

// ★ 落地时要改：你的 agent 名单
export const AGENTS = ['alice', 'bob', 'carol'];

// ★ 落地时要改：合法派活边（唯一准绳，非法直接拒绝）
export const HANDOFF_EDGES = ['alice>bob', 'bob>carol', 'carol>alice'];

const TYPES = ['handoff', 'report', 'question', 'ack', 'close'];

// ── 工具 ──────────────────────────────────────────────
function ensureDirs() {
  for (const d of [MAIL, ARCH, LOGS, INBOX, HB_DIR]) fs.mkdirSync(d, { recursive: true });
}

function stamp(d = new Date()) {
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

function nextId(prefix) {
  ensureDirs();
  const base = `${stamp()}-`;
  const n = fs.readdirSync(MAIL).filter(f => f.startsWith(base)).length + 1;
  return `${prefix || base + String(n).padStart(3, '0')}`;
}

/** 极简 frontmatter 解析 —— 够用就好，别引依赖 */
function parse(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) return { meta: {}, body: text };
  const meta = {};
  for (const line of m[1].split('\n')) {
    const i = line.indexOf(':');
    if (i > 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return { meta, body: m[2] };
}

function render(meta, body) {
  const fm = Object.entries(meta).map(([k, v]) => `${k}: ${v ?? ''}`).join('\n');
  return `---\n${fm}\n---\n\n${body}\n`;
}

// ── 原语 ①：发一条消息 ─────────────────────────────────
export function send({ from, to, type, thread, ref = '', body = '' }) {
  if (!AGENTS.includes(from)) throw new Error(`未知发起方: ${from}`);
  if (!AGENTS.includes(to))   throw new Error(`未知接收方: ${to}`);
  if (!TYPES.includes(type))  throw new Error(`未知消息类型: ${type}`);

  // ★ 只有 handoff 受边约束（report / question / ack / close 不限）
  if (type === 'handoff' && !HANDOFF_EDGES.includes(`${from}>${to}`)) {
    throw new Error(
      `非法派活边 ${from}>${to}\n当前合法边：\n  ` + HANDOFF_EDGES.join('\n  ')
    );
  }

  const id = nextId();
  const meta = { id, from, to, type, thread, ref, created: new Date().toISOString() };
  // ★ 先写临时文件再 rename —— 避免读到写了一半的文件
  const tmp = path.join(MAIL, `.${id}.tmp`);
  const dst = path.join(MAIL, `${id}-${type}.md`);
  fs.writeFileSync(tmp, render(meta, body), 'utf8');
  fs.renameSync(tmp, dst);
  return id;
}

// ── 原语 ②：读一堆消息 ─────────────────────────────────
export function read({ includeArchived = true } = {}) {
  ensureDirs();
  const dirs = includeArchived ? [MAIL, ARCH] : [MAIL];
  const out = [];
  for (const d of dirs) {
    for (const f of fs.readdirSync(d)) {
      if (!f.endsWith('.md') || f.startsWith('.')) continue;
      const full = path.join(d, f);
      const { meta, body } = parse(fs.readFileSync(full, 'utf8'));
      out.push({ ...meta, body, _file: full, _archived: d === ARCH });
    }
  }
  return out.sort((a, b) => String(a.id).localeCompare(String(b.id)));
}

/** 未关闭 = 有 handoff，但没有对应的 close */
export function openThreads(agent) {
  const all = read();
  const closed = new Set(all.filter(m => m.type === 'close').map(m => m.thread));
  return all.filter(m =>
    m.type === 'handoff' && !closed.has(m.thread) &&
    (!agent || m.from === agent || m.to === agent)
  );
}

// ── 心跳：★ 只有 event 以 dispatch/ 开头才是"真在跑" ────
export function heartbeat(agent) {
  const f = path.join(HB_DIR, `${agent}.json`);
  if (!fs.existsSync(f)) return null;
  try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; }
}

export function setHeartbeat(agent, event, extra = {}) {
  ensureDirs();
  const f = path.join(HB_DIR, `${agent}.json`);
  fs.writeFileSync(f, JSON.stringify({ event, ts: new Date().toISOString(), ...extra }), 'utf8');
}

export function isBusy(agent) {
  const hb = heartbeat(agent);
  return hb && String(hb.event).startsWith('dispatch/') ? hb : null;
}

// ── CLI ───────────────────────────────────────────────
if (import.meta.url === `file://${process.argv[1]}`) {
  const [cmd, ...rest] = process.argv.slice(2);
  const arg = (k) => { const i = rest.indexOf(k); return i >= 0 ? rest[i + 1] : undefined; };
  try {
    if (cmd === 'list') {
      for (const m of read()) {
        console.log(`${m._archived ? '[档]' : '[  ]'} ${m.id}  ${m.from}→${m.to}  ${m.type}  ${m.thread}`);
      }
    } else if (cmd === 'show') {
      const m = read().find(x => x.id === rest[0]);
      console.log(m ? `${JSON.stringify(m, null, 2)}` : `找不到 ${rest[0]}`);
    } else if (cmd === 'open') {
      const o = openThreads(arg('--agent'));
      console.log(o.length ? o.map(m => `${m.id}  ${m.from}→${m.to}  ${m.thread}`).join('\n') : '（没有未关闭的线程）');
    } else if (cmd === 'send') {
      console.log(send({ from: arg('--from'), to: arg('--to'), type: arg('--type') || 'question',
                         thread: arg('--thread'), body: rest.join(' ') }));
    } else {
      console.log('用法: leyline.mjs list | show <id> | open [--agent X] | send --from --to --thread');
    }
  } catch (e) { console.error('✗ ' + e.message); process.exit(1); }
}
