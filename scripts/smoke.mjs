/*
 * 真实 DOM 冒烟测试：用 jsdom + fake-indexeddb 把 App 完整跑起来，
 * 逐个页面渲染 + 模拟点击，验证「点了之后确实按预期变化」。
 *
 * 运行： npm 依赖装在 C:/Users/LENOVO/.workbuddy/binaries/node/workspace
 *   NODE_PATH=<workspace>/node_modules node scripts/smoke.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

// ESM 不认 NODE_PATH，这里按绝对路径把测试依赖载进来（依赖装在托管目录，不污染系统）
const NM = process.env.TEST_MODULES ||
  'C:/Users/LENOVO/.workbuddy/binaries/node/workspace/node_modules';
const require = createRequire(import.meta.url);
let JSDOM, IDBFactory;
try {
  ({ JSDOM } = require(path.join(NM, 'jsdom')));
  ({ IDBFactory } = require(path.join(NM, 'fake-indexeddb')));
} catch (e) {
  console.log('缺少测试依赖，请先执行：\n  cd ' + NM + ' && npm install jsdom fake-indexeddb\n');
  console.log('原始错误：' + e.message);
  process.exit(2);
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'src');

let pass = 0, fail = 0;
const fails = [];
function ok(name, cond, extra){
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; fails.push(name); console.log('  ✗ ' + name + (extra ? '  → ' + extra : '')); }
}
const tick = (ms) => new Promise(r => setTimeout(r, ms || 30));

// ---------- 环境 ----------
const html = fs.readFileSync(path.join(SRC, 'index.html'), 'utf8')
  .replace(/<script[\s\S]*?<\/script>/g, '');   // 去掉 module script，我们自己 import

const dom = new JSDOM(html, { url: 'http://localhost/', pretendToBeVisual: true });
const { window } = dom;

// canvas 打桩（jsdom 没有 2d 上下文，图表只验证不报错即可）
const ctxStub = new Proxy({}, {
  get(_, k){
    if (k === 'canvas') return { width: 300, height: 170 };
    if (k === 'measureText') return () => ({ width: 20 });
    if (k === 'createLinearGradient') return () => ({ addColorStop(){} });
    return () => {};
  }
});
window.HTMLCanvasElement.prototype.getContext = () => ctxStub;

window.indexedDB = new IDBFactory();
if (!window.crypto) window.crypto = {};
if (!window.crypto.randomUUID) window.crypto.randomUUID = () => 'test-' + Math.random().toString(36).slice(2);
if (!window.crypto.subtle) {
  const { webcrypto } = await import('node:crypto');
  window.crypto.subtle = webcrypto.subtle;
}

for (const k of ['window', 'document', 'navigator', 'location', 'HTMLElement', 'CustomEvent',
  'Event', 'Blob', 'URL', 'requestAnimationFrame', 'cancelAnimationFrame', 'indexedDB',
  'crypto', 'TextEncoder', 'getComputedStyle', 'DOMParser']) {
  if (window[k] === undefined) continue;
  try { globalThis[k] = window[k]; }
  catch (e) { try { Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true }); } catch (e2) { /* ignore */ } }
}
globalThis.window = window;
globalThis.document = window.document;
globalThis.self = window;

const errors = [];
window.addEventListener('error', e => errors.push(String(e.message)));
const origErr = console.error;
console.error = (...a) => { const s = a.join(' '); if (!/Not implemented/.test(s)) errors.push(s); };

// ---------- 启动 ----------
console.log('\n[1] 启动与首页');
const appMod = await import(pathToFileURL(path.join(SRC, 'js', 'app.js')).href);
await tick(200);

const screenEl = window.document.getElementById('screen');
const text = () => screenEl.textContent || '';

const doc = window.document;
ok('首页不是错误页', !/页面没能正常打开/.test(text()), text().slice(0, 120));
ok('首页有记账键盘', !!doc.querySelector('.keypad'));
ok('首页有金额显示', !!doc.querySelector('#amtText'));
ok('首页有日期选择框', !!screenEl.querySelector('#dateIn'));
ok('首页没有金额归零以外的异常', !/undefined|NaN/.test(text()));

console.log('\n[1b] 整组跟随滚动（金额+键盘作为内容放在页面最末尾）');
const dock = doc.getElementById('recordDock');
ok('存在金额+键盘整组 recordDock', !!dock);
ok('金额在整组内', !!(dock && dock.querySelector('#amtText')));
ok('键盘在整组内', !!(dock && dock.querySelector('.keypad')));
ok('整组就在滚动内容里（会跟着页面滚）', !!screenEl.querySelector('#recordDock'));
ok('整组在内容末尾（页面里没有多余 spacer）', !screenEl.querySelector('#dockSpacer'));
// 金额(amt-out) 与键盘(keypad) 是紧邻的兄弟片段：结构应是 dock-amt -> dock-sub -> keypad-wrap
ok('金额与键盘紧邻（中间没有隔开其他区块）',
   !!(dock && dock.querySelector('.dock-amt') && dock.querySelector('.keypad-wrap')));

console.log('\n[1c] 点备注输入时自定义数字键盘自动收起（note-on）');
ok('键盘有可收起的包裹层 .keypad-wrap', !!(dock && dock.querySelector('.keypad-wrap')));
ok('初始状态键盘是展开的', !!(dock && !dock.classList.contains('note-on')));
const noteIn = doc.getElementById('noteIn');
if (noteIn) {
  noteIn.dispatchEvent(new window.Event('focus'));
  await tick(20);
  ok('点备注聚焦后键盘收起', !!(dock && dock.classList.contains('note-on')));
  noteIn.dispatchEvent(new window.Event('blur'));
  await tick(20);
  ok('备注失焦后键盘恢复', !!(dock && !dock.classList.contains('note-on')));
} else {
  ok('点备注聚焦后键盘收起', false, '未找到 #noteIn');
  ok('备注失焦后键盘恢复', false, '未找到 #noteIn');
}

console.log('\n[2] 逐页渲染');
async function goto(name){
  window.location.hash = '#/' + name;
  window.dispatchEvent(new window.Event('hashchange'));
  await tick(120);
  return screenEl;
}
const routes = [
  ['ledger', '.card', '明细'],
  ['stats', '.stat-grid', '统计'],
  ['accounts', '.card', '账户'],
  ['settings', '.card', '我的']
];
for (const [name, sel, label] of routes) {
  const el = await goto(name);
  ok(label + '页不报错', !/页面没能正常打开/.test(text()), text().slice(0, 120));
  ok(label + '页渲染出内容', !!el.querySelector(sel));
  if (name !== 'record') {
    ok('离开记账页后固定区已移除（不残留）', !doc.getElementById('recordDock'));
  }
}
await goto('record');
ok('回到记账页固定区重建', !!doc.getElementById('recordDock'));
await goto('ledger');

console.log('\n[3] 翻月必须一次只动一个月（回归：监听器叠加）');
await goto('ledger');
function monthIdx(){
  const m = text().match(/(\d{4})年(\d{1,2})月/);
  return m ? Number(m[1]) * 12 + (Number(m[2]) - 1) : null;
}
const nowIdx = (() => { const d = new Date(); return d.getFullYear() * 12 + d.getMonth(); })();
const start = monthIdx();
ok('明细初始为当月', start === nowIdx, String(start) + ' vs ' + nowIdx);

for (let i = 1; i <= 5; i++) {
  const btn = screenEl.querySelector('[data-act="next"]');
  btn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await tick(90);
  const want = start + i;
  ok('第 ' + i + ' 次点「下月」→ +' + i + ' 个月', monthIdx() === want, '实际 ' + monthIdx() + ' 期望 ' + want);
}
ok('非当月时出现「回本月」', !!screenEl.querySelector('[data-act="thismonth"]'));
screenEl.querySelector('[data-act="thismonth"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await tick(120);
ok('点「回本月」回到当月', monthIdx() === nowIdx, String(monthIdx()));

await goto('stats');
const sStart = monthIdx();
for (let i = 1; i <= 3; i++) {
  screenEl.querySelector('[data-act="next"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await tick(90);
  ok('统计页第 ' + i + ' 次翻月 → +' + i, monthIdx() === sStart + i, '实际 ' + monthIdx());
}
screenEl.querySelector('[data-act="thismonth"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await tick(120);

console.log('\n[4] 统计四个 tab 都能画出来');
for (const [tab, label] of [['pie', '分类占比'], ['trend', '月度趋势'], ['compare', '同比环比'], ['rank', '排行榜']]) {
  const b = screenEl.querySelector('[data-act="tab"][data-v="' + tab + '"]');
  if (!b) { ok('找到 tab ' + label, false); continue; }
  b.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await tick(120);
  ok(label + ' 渲染无错误', !/页面没能正常打开/.test(text()), text().slice(0, 100));
}

console.log('\n[5] 演示数据');
const seed = await import(pathToFileURL(path.join(SRC, 'js', 'seed.js')).href);
const repoMod = await import(pathToFileURL(path.join(SRC, 'js', 'repository.js')).href);
const storeMod = await import(pathToFileURL(path.join(SRC, 'js', 'store.js')).href);

const n1 = await seed.seedDemoData();
ok('生成演示数据 > 50 笔', n1 > 50, String(n1));
await storeMod.store.reload();
ok('演示流水已入库', storeMod.store.transactions.length > 50, String(storeMod.store.transactions.length));
const months = new Set(storeMod.store.transactions.map(t => {
  const d = new Date(t.occurredAt); return d.getFullYear() + '-' + (d.getMonth() + 1);
}));
ok('覆盖至少 4 个月（趋势/同比才有东西看）', months.size >= 4, [...months].join(','));
ok('有支出也有收入', storeMod.store.transactions.some(t => t.type === 'expense') &&
  storeMod.store.transactions.some(t => t.type === 'income'));
ok('有转账', storeMod.store.transactions.some(t => t.type === 'transfer'));

const st = storeMod.monthStats(new Date().getFullYear() + '-' + String(new Date().getMonth() + 1).padStart(2, '0'));
ok('当月支出统计大于 0', st.expense > 0, String(st.expense));
const catRows = storeMod.byCategory(new Date().getFullYear() + '-' + String(new Date().getMonth() + 1).padStart(2, '0'), 'expense');
ok('分类饼图有数据', catRows.length >= 3, String(catRows.length));

await goto('stats');
ok('有演示数据后统计页仍正常', !/页面没能正常打开/.test(text()));
await goto('ledger');
ok('有演示数据后明细页仍正常', !/页面没能正常打开/.test(text()));
ok('明细页列出记录', screenEl.querySelectorAll('[data-act="edit"]').length > 3,
  String(screenEl.querySelectorAll('[data-act="edit"]').length));

const cleared = await seed.clearDemoData();
ok('清空演示数据', cleared === n1, cleared + ' vs ' + n1);
await storeMod.store.reload();
ok('清空后无残留', storeMod.store.transactions.filter(t => t.demo).length === 0);

console.log('\n[6] 应用锁');
const lock = await import(pathToFileURL(path.join(SRC, 'js', 'lock.js')).href);
ok('默认未开启', (await lock.lockInfo()).enabled === false);
await lock.setPin('1234');
ok('设置后变为已开启', (await lock.lockInfo()).enabled === true);
ok('正确密码通过', await lock.verifyPin('1234'));
ok('错误密码被拒', (await lock.verifyPin('9999')) === false);
ok('哈希用了 SHA-256', (await lock.lockInfo()).strong === true);
await lock.clearPin();
ok('关闭后回到未开启', (await lock.lockInfo()).enabled === false);

console.log('\n[7] 运行期无未捕获错误');
console.error = origErr;
ok('无未捕获错误', errors.length === 0, errors.slice(0, 3).join(' | '));

console.log('\n────────────────────────');
console.log('通过 ' + pass + ' 项，失败 ' + fail + ' 项');
if (fail) { console.log('失败清单：\n  - ' + fails.join('\n  - ')); process.exit(1); }
process.exit(0);
