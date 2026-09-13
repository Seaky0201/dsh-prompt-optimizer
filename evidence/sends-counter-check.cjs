#!/usr/bin/env node
/*
 * 接管计数徽标 —— 语义回归自检（v0.1.1-beta.5）
 *
 * 目的：锁死徽标数字的三个约定，防止再次退化：
 *   ① 一次发送只算 1（不是 2）—— keydown-enter/click-send 算，optimize-start 不算
 *   ② 按会话独立 —— A 会话拦过，切到 B 会话不能显示 A 的数字
 *   ③ 跨刷新/重启保留 —— 从 host 落盘的 perSession[sid].sends 回灌后不归零
 *
 * 做法：不重写实现，用括号匹配从真实的 lib/client.js / lib/index.js 里**原文提取**函数，
 *       在桩环境（store / persistState / fs）里执行真实代码路径。
 *
 * 用法：node evidence/sends-counter-check.cjs
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const CLIENT = fs.readFileSync(path.join(ROOT, 'lib', 'client.js'), 'utf8');
const HOST = fs.readFileSync(path.join(ROOT, 'lib', 'index.js'), 'utf8');

/* 从源码里按函数名提取函数体（括号匹配；这些函数体内无字符串/注释括号，够用） */
function extractFn(src, name) {
  const m = new RegExp('function ' + name + '\\s*\\(').exec(src);
  if (!m) throw new Error('function not found: ' + name);
  let i = src.indexOf('{', m.index), depth = 0, j = i;
  for (; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') { depth--; if (depth === 0) { j++; break; } }
  }
  return src.slice(m.index, j);
}
function extractLine(src, prefix) {
  const line = src.split('\n').find(function (l) { return l.trim().startsWith(prefix); });
  if (!line) throw new Error('line not found: ' + prefix);
  return line.trim();
}

let fails = 0;
function check(label, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  const ok = g === w;
  if (!ok) fails++;
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + label + '  got=' + g + ' want=' + w);
}

/* ─────────── 一、client 侧：计数语义 ─────────── */
const C_NAMES = ['sessionKey', 'interceptedSends', 'bumpSends', 'record'];
const cParts = C_NAMES.map(function (n) { return extractFn(CLIENT, n); });
console.log('client extracted =', C_NAMES.join(' '));

const posted = [];
const STORE = { viewSessionId: null, intercepts: [], sendsBySession: {}, tier: 'basic', permission: 'review', modelSel: null };
const cSandbox = { store: STORE, persistState: function (p) { posted.push(p); }, emit: function () {} };
const client = new Function('sandbox', [
  'const store = sandbox.store;',
  'const persistState = function (p) { sandbox.persistState(p); };',
  'const emit = function () { sandbox.emit(); };',
  cParts.join('\n'),
  'return { sessionKey: sessionKey, interceptedSends: interceptedSends, bumpSends: bumpSends, record: record };'
].join('\n'))(cSandbox);

function resetStore() {
  STORE.viewSessionId = null; STORE.intercepts = []; STORE.sendsBySession = {};
  STORE.tier = 'basic'; STORE.permission = 'review'; STORE.modelSel = null;
}

resetStore();
check('C1 全新会话（无落盘）', client.interceptedSends(), 0);

STORE.viewSessionId = 'S1';
client.record('keydown-enter', '你好');
client.record('optimize-start', '你好');
check('C2 一次发送后计数（不是 2）', client.interceptedSends(), 1);
check('C3 落盘上报内容', posted[posted.length - 1], { sends: 1 });

/* 模拟刷新：内存清空，从落盘值回灌 */
resetStore();
STORE.viewSessionId = 'S1';
STORE.sendsBySession['S1'] = 1;
check('C4 刷新回灌后不归零', client.interceptedSends(), 1);

STORE.viewSessionId = 'S2';
check('C5 切到未拦过的 S2', client.interceptedSends(), 0);
client.record('click-send', '第二条');
check('C6 S2 计数', client.interceptedSends(), 1);
STORE.viewSessionId = 'S1';
check('C7 切回 S1 计数保持', client.interceptedSends(), 1);

STORE.viewSessionId = null;
check('C8 无会话时为 0', client.interceptedSends(), 0);

/* ─────────── 二、host 侧：落盘与校验 ─────────── */
const hPieces = [
  extractLine(HOST, 'const STATE_FILE'),
  extractLine(HOST, 'const TIER_IDS'),
  extractLine(HOST, 'const PERMISSION_IDS'),
  extractLine(HOST, 'const PER_SESSION_CAP'),
  extractFn(HOST, 'sanitizeUi'),
  extractFn(HOST, 'sanitizePerSession'),
  extractFn(HOST, 'loadPluginState'),
  extractFn(HOST, 'savePluginState'),
];
console.log('host   extracted =', hPieces.length, 'pieces');

const hSandbox = { disk: null };
const host = new Function('sandbox', [
  'const readJson = function () { return sandbox.disk; };',
  'const writeFileSync = function (f, txt) { sandbox.disk = JSON.parse(txt); };',
  'const mirrorToSettings = function () {};',
  'const join = function () { return "STUB"; };',
  'const homedir = function () { return "STUB"; };',
  'const process = { env: {} };',
  hPieces.join('\n'),
  'return { sanitizePerSession: sanitizePerSession, loadPluginState: loadPluginState, savePluginState: savePluginState };'
].join('\n'))(hSandbox);

check('H1 保留合法 sends', host.sanitizePerSession({ S1: { tier: 'basic', sends: 3 } }), { S1: { tier: 'basic', sends: 3 } });
check('H2 丢弃 0', host.sanitizePerSession({ S1: { sends: 0 } }), {});
check('H3 丢弃负数', host.sanitizePerSession({ S1: { sends: -5 } }), {});
check('H4 丢弃非数字', host.sanitizePerSession({ S1: { sends: 'x' } }), {});
check('H5 丢弃 NaN/Infinity', host.sanitizePerSession({ S1: { sends: NaN }, S2: { sends: Infinity } }), {});
check('H6 小数取整', host.sanitizePerSession({ S1: { sends: 2.7 } }), { S1: { sends: 3 } });
check('H7 上限 1e9', host.sanitizePerSession({ S1: { sends: 1e12 } }), { S1: { sends: 1e9 } });
check('H8 只有 sends 也保留', host.sanitizePerSession({ S1: { sends: 1 } }), { S1: { sends: 1 } });

hSandbox.disk = { tier: 'basic', permission: 'review', model: null, ui: null, perSession: {}, revision: 0 };
host.savePluginState({ sessionId: 'S1', tier: 'advanced', sends: 4 });
check('H9 落盘后 perSession.S1', hSandbox.disk.perSession.S1, { tier: 'advanced', sends: 4 });
check('H10 重新读回（跨重启）', host.loadPluginState().perSession.S1, { tier: 'advanced', sends: 4 });
host.savePluginState({ sessionId: 'S1', sends: 5 });
check('H11 二次覆盖', host.loadPluginState().perSession.S1.sends, 5);
host.savePluginState({ sessionId: 'S1', sends: 0 });
check('H12 非法 0 不覆盖旧值', host.loadPluginState().perSession.S1.sends, 5);

console.log('\nRESULT: ' + (fails === 0 ? 'PASS — 20/20 全部通过' : 'FAIL — ' + fails + ' 项不符'));
process.exit(fails === 0 ? 0 : 1);
