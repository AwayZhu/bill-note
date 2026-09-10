import { store, monthStats } from '../store.js';
import { repo } from '../repository.js';
import { logger, replay } from '../logger.js';
import { fmtCents, parseAmountToCents, monthKey, escapeHtml, toast, dateInputValue, dateFromInput, dayKey } from '../util.js';

const S = {
  type: 'expense',
  amount: '',
  note: '',
  categoryId: null,
  accountId: null,
  toAccountId: null,
  occurredAt: Date.now(),
  overviewOpen: true
};

let _api = null;
let _draftLoaded = false;
let _keyHandler = null;
let _dock = null;

async function loadDefaults(){
  if (!S.accountId) {
    const last = await repo.meta('lastAccountId', null);
    S.accountId = (last && store.acc(last)) ? last : (store.accounts[0] ? store.accounts[0].id : null);
  }
  if (!S.toAccountId) S.toAccountId = store.accounts[1] ? store.accounts[1].id : null;
  if (!S.categoryId) {
    const lastCat = await repo.meta('lastCategoryId', null);
    const hit = lastCat && store.cat(lastCat) && store.cat(lastCat).kind === S.type ? lastCat : null;
    const list = store.cats(S.type);
    S.categoryId = hit || (list[0] ? list[0].id : null);
  }
}

export async function restoreDraft(){
  const d = await repo.meta('draft', null);
  if (d && (d.amount || d.note)) {
    S.type = d.type || S.type;
    S.amount = d.amount || '';
    S.note = d.note || '';
    S.categoryId = d.categoryId || S.categoryId;
    S.accountId = d.accountId || S.accountId;
    S.toAccountId = d.toAccountId || S.toAccountId;
    S.occurredAt = d.occurredAt || Date.now();
    return true;
  }
  return false;
}

async function persistDraft(){
  const empty = !S.amount && !S.note;
  await repo.setMeta('draft', empty ? null : {
    type: S.type, amount: S.amount, note: S.note, categoryId: S.categoryId,
    accountId: S.accountId, toAccountId: S.toAccountId, occurredAt: S.occurredAt, savedAt: Date.now()
  });
}

function overviewHtml(){
  const key = monthKey();
  const st = monthStats(key);
  const b = store.budgetFor(key, null);
  const cur = store.settings.currency || '¥';
  let line = '本月已花 ' + cur + fmtCents(st.expense) + ' · 共 ' + st.count + ' 笔';
  if (b) {
    const left = b.limitCents - st.expense;
    line += left >= 0 ? ' · 预算剩余 ' + cur + fmtCents(left) : ' · 已超支 ' + cur + fmtCents(-left);
  }
  const detailed = S.overviewOpen
    ? '<div style="margin-top:8px;display:flex;gap:16px;font-size:13px">' +
        '<span class="muted">收入 <b class="amount-i">' + cur + fmtCents(st.income) + '</b></span>' +
        '<span class="muted">结余 <b>' + cur + fmtCents(st.net) + '</b></span>' +
      '</div>'
    : '';
  const over = b && st.expense > b.limitCents;
  return '<div class="card tight" style="margin:8px 12px 0">' +
    '<div class="list-item" data-act="toggle-overview">' +
      '<span class="grow small ' + (over ? 'amount-e' : 'muted') + '">' + escapeHtml(line) + '</span>' +
      '<span class="tiny muted">' + (S.overviewOpen ? '收起' : '明细') + '</span>' +
    '</div>' + detailed +
  '</div>';
}

function typeHtml(){
  return '<div style="padding:10px 12px 0"><div class="seg">' +
    '<button data-act="type" data-v="expense" class="' + (S.type === 'expense' ? 'on' : '') + '">支出</button>' +
    '<button data-act="type" data-v="income" class="' + (S.type === 'income' ? 'on' : '') + '">收入</button>' +
    '<button data-act="type" data-v="transfer" class="' + (S.type === 'transfer' ? 'on' : '') + '">转账</button>' +
  '</div></div>';
}

function noteHtml(){
  return '<div class="card tight" style="margin:8px 12px 0">' +
    '<div class="list-item">' +
      '<span class="small muted" style="width:44px">备注</span>' +
      '<input id="noteIn" type="text" placeholder="添加备注（可不填）" value="' + escapeHtml(S.note) + '" ' +
        'style="border:0;padding:0;font-size:14px;background:transparent;flex:1;min-width:0">' +
    '</div>' +
  '</div>';
}

function catsHtml(){
  if (S.type === 'transfer') return '';
  const list = store.cats(S.type);
  if (!list.length) {
    return '<div class="card small muted center" style="margin:10px 12px 0">还没有「' +
      (S.type === 'expense' ? '支出' : '收入') + '」分类，去「我的 → 分类管理」加一个</div>';
  }
  return '<div class="grid-cats" style="margin:10px 12px 0">' + list.map(c =>
    '<div class="cat' + (c.id === S.categoryId ? ' on' : '') + '" data-act="pick-cat" data-id="' + c.id + '">' +
      '<div class="ic">' + escapeHtml(c.icon || '❓') + '</div>' +
      '<div class="nm">' + escapeHtml(c.name) + '</div>' +
    '</div>').join('') + '</div>';
}

function accountsHtml(){
  const opts = id => store.accounts.map(a =>
    '<div class="chip' + (a.id === id ? ' on' : '') + '" data-act="pick-acc" data-id="' + a.id + '">' +
      escapeHtml((a.icon || '') + ' ' + a.name) + '</div>').join('');
  if (S.type === 'transfer') {
    return '<div class="card tight" style="margin:10px 12px 0">' +
      '<div class="list-item"><span class="small muted" style="width:44px">从</span><div class="chips grow">' + opts(S.accountId) + '</div></div>' +
      '<div class="list-item"><span class="small muted" style="width:44px">到</span><div class="chips grow" data-slot="to">' +
        store.accounts.map(a =>
          '<div class="chip' + (a.id === S.toAccountId ? ' on' : '') + '" data-act="pick-to" data-id="' + a.id + '">' +
            escapeHtml((a.icon || '') + ' ' + a.name) + '</div>').join('') +
      '</div></div>' +
    '</div>';
  }
  return '<div class="card tight" style="margin:10px 12px 0">' +
    '<div class="list-item"><span class="small muted" style="width:44px">账户</span><div class="chips grow">' + opts(S.accountId) + '</div></div>' +
  '</div>';
}

function dateLabel(){
  const t = S.occurredAt;
  const now = Date.now();
  if (dayKey(t) === dayKey(now)) return '今天';
  if (dayKey(t) === dayKey(now - 86400000)) return '昨天';
  if (dayKey(t) === dayKey(now - 172800000)) return '前天';
  const d = new Date(t);
  return (d.getMonth() + 1) + '月' + d.getDate() + '日';
}

function tailHtml(){
  const quick = [['今天', 0], ['昨天', 1], ['前天', 2]].map(([n, d]) => {
    const b = new Date();
    b.setDate(b.getDate() - d);
    const on = dayKey(b.getTime()) === dayKey(S.occurredAt);
    return '<div class="chip' + (on ? ' on' : '') + '" data-act="dquick" data-d="' + d + '">' + n + '</div>';
  }).join('');
  return '<div class="card tight" style="margin:10px 12px 0">' +
    '<div class="list-item">' +
      '<span class="small muted" style="width:44px">日期</span>' +
      '<input type="date" id="dateIn" class="date-in grow" value="' + dateInputValue(S.occurredAt) + '">' +
      '<span class="tiny muted" style="margin-left:6px">' + escapeHtml(dateLabel()) + '</span>' +
    '</div>' +
    '<div class="list-item"><div class="chips grow">' + quick +
      '<span class="tiny muted" style="align-self:center;margin-left:4px">点日期可调</span>' +
    '</div></div>' +
  '</div>';
}

function keypadHtml(){
  const keys = ['1', '2', '3', '⌫', '4', '5', '6', 'C', '7', '8', '9', '今天', '.', '0', '00', '保存'];
  return '<div class="keypad-wrap"><div class="keypad">' + keys.map(k => {
    if (k === '保存') return '<button class="ok" data-act="save">保存</button>';
    const fn = (k === '⌫' || k === 'C' || k === '今天') ? ' fn' : '';
    return '<button class="' + fn.trim() + '" data-key="' + k + '">' + k + '</button>';
  }).join('') + '</div></div>';
}

/* 底部固定区：金额 + 键盘。这整块不随页面滚动，打字时金额永远在眼前。 */
function dockHtml(){
  const cls = S.type === 'expense' ? 'exp' : (S.type === 'income' ? 'inc' : 'tf');
  const cur = store.settings.currency || '¥';
  let left = '未选分类', right = '';
  if (S.type === 'transfer') {
    const a = store.acc(S.accountId), b = store.acc(S.toAccountId);
    left = '转账';
    right = (a ? a.name : '?') + ' → ' + (b ? b.name : '?');
  } else {
    const c = store.cat(S.categoryId);
    if (c) left = (c.icon ? c.icon + ' ' : '') + c.name;
    const a = store.acc(S.accountId);
    if (a) right = a.name;
  }
  return '<div class="dock-amt"><span class="amt-out ' + cls + '">' +
      '<span class="cur">' + cur + '</span><span id="amtText">' +
      escapeHtml(S.amount === '' ? '0' : S.amount) + '</span></span></div>' +
    '<div class="dock-sub"><span><b>' + escapeHtml(left) + '</b></span>' +
      '<span>' + escapeHtml(right) + '</span></div>' +
    keypadHtml();
}

/* 金额和键盘是紧挨着的一整组，作为普通内容放在页面最末尾，跟着页面一起滚。
   要点是两者必须相邻——只要键盘在视野里，金额就一定在它正上方，不会隔着一个分类网格。 */
function contentHtml(){
  return overviewHtml() + typeHtml() + noteHtml() + catsHtml() + accountsHtml() + tailHtml() +
    '<div class="record-dock" id="recordDock">' + dockHtml() + '</div>';
}

function press(k){
  replay.step('按键 ' + k);
  if (k === '⌫') { S.amount = S.amount.slice(0, -1); return; }
  if (k === 'C') { S.amount = ''; return; }
  if (k === '今天') { S.occurredAt = Date.now(); return; }
  if (k === '.') {
    if (S.amount.includes('.')) return;
    if (!S.amount) S.amount = '0';
    S.amount += '.';
    return;
  }
  if (k === '00') {
    if (S.amount === '' || S.amount === '0') return;
    S.amount += '00';
    return;
  }
  const dot = S.amount.indexOf('.');
  if (dot >= 0 && S.amount.length - dot > 2) return;
  if (S.amount === '0') S.amount = k;
  else if (S.amount.replace('.', '').length >= 9) return;
  else S.amount += k;
}

async function save(api){
  const cents = parseAmountToCents(S.amount);
  const list = store.accounts;
  if (cents <= 0) { toast('请输入金额'); return; }
  if (S.type !== 'transfer' && !S.categoryId) { toast('请选择分类'); return; }
  if (!S.accountId) { toast('请选择账户'); return; }
  if (S.type === 'transfer') {
    if (!S.toAccountId) { toast('请选择转入账户'); return; }
    if (S.toAccountId === S.accountId) { toast('转出和转入不能是同一个账户'); return; }
  }
  if (!list.length) { toast('请先到「我的」新增账户'); return; }

  try {
    await store.addTransaction({
      type: S.type,
      amountCents: cents,
      accountId: S.accountId,
      toAccountId: S.type === 'transfer' ? S.toAccountId : null,
      categoryId: S.type === 'transfer' ? null : S.categoryId,
      note: S.note,
      occurredAt: S.occurredAt
    });
    await repo.setMeta('lastAccountId', S.accountId);
    if (S.categoryId) await repo.setMeta('lastCategoryId', S.categoryId);
    await repo.setMeta('draft', null);
    S.amount = '';
    S.note = '';
    S.occurredAt = Date.now();
    replay.step('保存成功一笔 ' + S.type);
    toast('已记录 ' + (store.settings.currency || '¥') + fmtCents(cents));
    api.refresh();
  } catch (e) {
    logger.error('save failed: ' + e.message, 'record');
    toast('保存失败：' + e.message);
  }
}

// 电脑浏览器上用物理键盘也能记账；手机上用不到，但没它时会直接报错白屏。
function onKey(ev){
  const tag = document.activeElement ? document.activeElement.tagName : '';
  if (tag === 'INPUT' || tag === 'TEXTAREA') return;
  const amtText = document.getElementById('amtText');
  const sync = () => { if (amtText) amtText.textContent = S.amount === '' ? '0' : S.amount; };
  if (/^[0-9]$/.test(ev.key)) { press(ev.key); sync(); persistDraft(); }
  else if (ev.key === '.') { press('.'); sync(); persistDraft(); }
  else if (ev.key === 'Backspace') { press('⌫'); sync(); persistDraft(); ev.preventDefault(); }
  else if (ev.key === 'Enter') { ev.preventDefault(); if (_api) save(_api); }
}


export async function render(root, api){
  _api = api;
  if (!_draftLoaded) {
    _draftLoaded = true;
    const had = await restoreDraft();
    if (had) toast('已恢复上次没记完的内容');
  }
  await loadDefaults();
  if (S.type !== 'transfer' && S.categoryId) {
    const c = store.cat(S.categoryId);
    if (!c || c.kind !== S.type) {
      const l = store.cats(S.type);
      S.categoryId = l[0] ? l[0].id : null;
    }
  }
  root.innerHTML = contentHtml();

  // 金额 + 键盘这一组就在滚动内容里，切页时随 root 一起回收
  _dock = root.querySelector('#recordDock');

  const amtText = _dock ? _dock.querySelector('#amtText') : null;
  const noteIn = root.querySelector('#noteIn');
  const dateIn = root.querySelector('#dateIn');

  const paintAmount = () => { if (amtText) amtText.textContent = S.amount === '' ? '0' : S.amount; };

  root.addEventListener('click', async e => {
    const hit = e.target.closest('[data-act]');
    if (!hit) return;
    const act = hit.dataset.act;
    if (act === 'type') {
      const v = hit.dataset.v;
      if (v !== S.type) {
        S.type = v;
        const l = store.cats(v === 'transfer' ? S.type : v);
        S.categoryId = l[0] ? l[0].id : null;
        replay.step('切换类型 ' + v);
        api.refresh();
      }
    } else if (act === 'pick-cat') { S.categoryId = hit.dataset.id; api.refresh(); }
    else if (act === 'pick-acc') { S.accountId = hit.dataset.id; api.refresh(); }
    else if (act === 'pick-to') { S.toAccountId = hit.dataset.id; api.refresh(); }
    else if (act === 'toggle-overview') { S.overviewOpen = !S.overviewOpen; api.refresh(); }
    else if (act === 'dquick') {
      const b = new Date();
      b.setDate(b.getDate() - Number(hit.dataset.d || 0));
      S.occurredAt = b.getTime();
      dateIn.value = dateInputValue(S.occurredAt);
      api.refresh();
    }
  });

  if (_dock) _dock.addEventListener('click', async e => {
    const hit = e.target.closest('[data-act]');
    if (hit && hit.dataset.act === 'save') { await save(api); return; }
    const k = e.target.closest('[data-key]');
    if (!k) return;
    press(k.dataset.key);
    paintAmount();
    if (k.dataset.key === '今天' && dateIn) dateIn.value = dateInputValue(S.occurredAt);
    persistDraft();
  });

  if (noteIn) {
    noteIn.addEventListener('input', () => { S.note = noteIn.value; persistDraft(); });
    // 点备注会唤起系统输入法，这时把自定义数字键盘收起来，避免两个键盘叠在一起
    noteIn.addEventListener('focus', () => { if (_dock) _dock.classList.add('note-on'); });
    noteIn.addEventListener('blur', () => { if (_dock) _dock.classList.remove('note-on'); });
  }
  if (dateIn) {
    dateIn.addEventListener('change', () => { S.occurredAt = dateFromInput(dateIn.value); persistDraft(); });
  }

  if (_keyHandler) window.removeEventListener('keydown', _keyHandler);
  _keyHandler = onKey;
  window.addEventListener('keydown', onKey);
}

// 固定区那一版需要把它从 body 上摘掉；现在它在 root 里，随 root 回收，只需断引用
function removeDock(){
  _dock = null;
}

export function cleanup(){
  if (_keyHandler) {
    window.removeEventListener('keydown', _keyHandler);
    _keyHandler = null;
  }
  removeDock();
}
