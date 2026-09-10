import { store } from '../store.js';
import { logger, replay } from '../logger.js';
import { fmtCents, escapeHtml, toast, monthKey, monthRange, shiftMonth, monthLabel, dayKey, fmtDayHead, fmtTime, dateInputValue, dateFromInput } from '../util.js';

const F = {
  month: monthKey(),
  type: 'all',
  accountId: ''
};

function cur(v){
  return store.settings.currency || '¥';
}

function filtered(){
  const { start, end } = monthRange(F.month);
  let list = store.transactions.filter(t => t.occurredAt >= start && t.occurredAt < end);
  if (F.type !== 'all') list = list.filter(t => t.type === F.type);
  if (F.accountId) list = list.filter(t => t.accountId === F.accountId || t.toAccountId === F.accountId);
  return list;
}

function groupByDay(list){
  const map = new Map();
  for (const t of list) {
    const k = dayKey(t.occurredAt);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(t);
  }
  return [...map.entries()].map(([k, items]) => ({
    key: k, ts: items[0].occurredAt, items
  }));
}

function iconOf(t){
  if (t.type === 'transfer') return '🔄';
  const c = store.cat(t.categoryId);
  return c ? c.icon : '❓';
}

function titleOf(t){
  if (t.type === 'transfer') {
    const a = store.acc(t.accountId), b = store.acc(t.toAccountId);
    return '转账 ' + (a ? a.name : '?') + ' → ' + (b ? b.name : '?');
  }
  const c = store.cat(t.categoryId);
  return c ? c.name : '未分类';
}

function amountOf(t){
  const v = t.type === 'income' ? '+' : (t.type === 'expense' ? '-' : '');
  const cls = t.type === 'income' ? 'amount-i' : (t.type === 'expense' ? 'amount-e' : 'amount-t');
  return '<span class="' + cls + '">' + v + cur() + fmtCents(t.amountCents) + '</span>';
}

function itemHtml(t){
  const acc = store.acc(t.accountId);
  const sub = [acc ? acc.name : '未知账户', t.note].filter(Boolean).join(' · ');
  return '<div class="list-item" data-act="edit" data-id="' + t.id + '">' +
    '<div class="ic-box">' + escapeHtml(iconOf(t)) + '</div>' +
    '<div class="grow">' +
      '<div style="font-size:14px">' + escapeHtml(titleOf(t)) + '</div>' +
      '<div class="tiny muted" style="margin-top:1px">' + escapeHtml(sub) + ' · ' + fmtTime(t.occurredAt) + '</div>' +
    '</div>' +
    '<div style="font-size:15px">' + amountOf(t) + '</div>' +
  '</div>';
}

function filterHtml(){
  const types = [['all', '全部'], ['expense', '支出'], ['income', '收入'], ['transfer', '转账']];
  return '<div class="card tight" style="margin:8px 12px 0">' +
    '<div class="list-item">' +
      '<span class="btn small" data-act="prev" style="padding:4px 10px">‹</span>' +
      '<span class="grow center" style="font-weight:500">' + monthLabel(F.month) +
        (F.month !== monthKey() ? ' <span class="btn small" data-act="thismonth" style="padding:2px 8px">回本月</span>' : '') +
      '</span>' +
      '<span class="btn small" data-act="next" style="padding:4px 10px">›</span>' +
    '</div>' +
    '<div class="list-item"><div class="chips grow">' +
      types.map(([k, n]) => '<div class="chip' + (F.type === k ? ' on' : '') + '" data-act="ftype" data-v="' + k + '">' + n + '</div>').join('') +
    '</div></div>' +
    '<div class="list-item"><div class="chips grow">' +
      '<div class="chip' + (F.accountId === '' ? ' on' : '') + '" data-act="facc" data-v="">全部账户</div>' +
      store.accounts.map(a => '<div class="chip' + (F.accountId === a.id ? ' on' : '') + '" data-act="facc" data-v="' + a.id + '">' +
        escapeHtml((a.icon || '') + ' ' + a.name) + '</div>').join('') +
    '</div></div>' +
  '</div>';
}

function html(){
  const list = filtered();
  if (!list.length) {
    return filterHtml() + '<div class="empty">这个月还没有符合条件的记录<br><span class="tiny">换个筛选条件，或者去记一笔</span></div>';
  }
  const groups = groupByDay(list);
  let exp = 0, inc = 0;
  for (const t of list) {
    if (t.type === 'expense') exp += t.amountCents;
    if (t.type === 'income') inc += t.amountCents;
  }
  const head = '<div class="small muted center" style="padding:10px 0 2px">共 ' + list.length + ' 笔 · 支出 ' +
    cur() + fmtCents(exp) + ' · 收入 ' + cur() + fmtCents(inc) + '</div>';
  return filterHtml() + head + groups.map(g => {
    let de = 0, di = 0;
    for (const t of g.items) {
      if (t.type === 'expense') de += t.amountCents;
      if (t.type === 'income') di += t.amountCents;
    }
    const right = [de ? '支出 ' + cur() + fmtCents(de) : '', di ? '收入 ' + cur() + fmtCents(di) : ''].filter(Boolean).join(' · ');
    return '<div class="day-head"><span>' + fmtDayHead(g.ts) + '</span><span>' + right + '</span></div>' +
      '<div class="card tight" style="margin:0 12px 8px">' + g.items.map(itemHtml).join('') + '</div>';
  }).join('');
}

function editorHtml(t){
  const cats = store.cats(t.type === 'income' ? 'income' : 'expense');
  return '<div class="sheet-head"><h3>编辑记录</h3><span class="tiny muted">' + fmtTime(t.occurredAt) + '</span></div>' +
    '<div style="padding:12px 16px">' +
      '<div class="seg" data-role="typeSeg">' +
        ['expense', 'income', 'transfer'].map(v =>
          '<button data-t="' + v + '" class="' + (t.type === v ? 'on' : '') + '">' +
          (v === 'expense' ? '支出' : v === 'income' ? '收入' : '转账') + '</button>').join('') +
      '</div>' +
      '<div style="margin-top:12px">' +
        '<div class="tiny muted">金额</div>' +
        '<input id="eAmt" type="text" inputmode="decimal" value="' + (t.amountCents / 100).toFixed(2) + '">' +
      '</div>' +
      '<div data-role="cats" style="margin-top:12px;display:' + (t.type === 'transfer' ? 'none' : 'block') + '">' +
        '<div class="tiny muted">分类</div>' +
        '<div class="chips" style="margin-top:6px">' + cats.map(c =>
          '<div class="chip' + (c.id === t.categoryId ? ' on' : '') + '" data-c="' + c.id + '">' +
            escapeHtml((c.icon || '') + ' ' + c.name) + '</div>').join('') + '</div>' +
      '</div>' +
      '<div style="margin-top:12px">' +
        '<div class="tiny muted">账户</div>' +
        '<div class="chips" style="margin-top:6px" data-role="fromAcc">' + store.accounts.map(a =>
          '<div class="chip' + (a.id === t.accountId ? ' on' : '') + '" data-a="' + a.id + '">' +
            escapeHtml((a.icon || '') + ' ' + a.name) + '</div>').join('') + '</div>' +
      '</div>' +
      '<div data-role="toRow" style="margin-top:12px;display:' + (t.type === 'transfer' ? 'block' : 'none') + '">' +
        '<div class="tiny muted">转入账户</div>' +
        '<div class="chips" style="margin-top:6px" data-role="toAcc">' + store.accounts.map(a =>
          '<div class="chip' + (a.id === t.toAccountId ? ' on' : '') + '" data-a="' + a.id + '">' +
            escapeHtml((a.icon || '') + ' ' + a.name) + '</div>').join('') + '</div>' +
      '</div>' +
      '<div style="margin-top:12px"><div class="tiny muted">日期时间</div>' +
        '<input id="eDate" type="date" value="' + dateInputValue(t.occurredAt) + '" style="margin-top:6px"></div>' +
      '<div style="margin-top:12px"><div class="tiny muted">备注</div>' +
        '<input id="eNote" type="text" value="' + escapeHtml(t.note) + '" style="margin-top:6px"></div>' +
      '<div style="display:flex;gap:10px;margin-top:16px">' +
        '<button class="btn danger" id="eDel" style="flex:1">删除</button>' +
        '<button class="btn primary" id="eSave" style="flex:2">保存</button>' +
      '</div>' +
    '</div>';
}

export async function openEditor(id, api){
  const t = store.transactions.find(x => x.id === id);
  if (!t) { toast('记录不存在'); return; }
  const draft = { type: t.type, amountCents: t.amountCents, categoryId: t.categoryId, accountId: t.accountId, toAccountId: t.toAccountId, note: t.note, occurredAt: t.occurredAt };
  const el = api.sheet.open(editorHtml(t));

  el.querySelector('[data-role=typeSeg]').addEventListener('click', e => {
    const b = e.target.closest('[data-t]');
    if (!b) return;
    draft.type = b.dataset.t;
    [...el.querySelectorAll('[data-t]')].forEach(x => x.classList.toggle('on', x === b));
    el.querySelector('[data-role=cats]').style.display = draft.type === 'transfer' ? 'none' : 'block';
    el.querySelector('[data-role=toRow]').style.display = draft.type === 'transfer' ? 'block' : 'none';
    const list = store.cats(draft.type === 'income' ? 'income' : 'expense');
    el.querySelector('[data-role=cats] .chips').innerHTML = list.map(c =>
      '<div class="chip' + (c.id === draft.categoryId ? ' on' : '') + '" data-c="' + c.id + '">' +
        escapeHtml((c.icon || '') + ' ' + c.name) + '</div>').join('');
    draft.categoryId = list[0] ? list[0].id : null;
    el.querySelector('[data-role=cats] .chips .chip').classList.add('on');
  });

  el.addEventListener('click', e => {
    const c = e.target.closest('[data-c]');
    if (c) {
      draft.categoryId = c.dataset.c;
      [...c.parentElement.children].forEach(x => x.classList.toggle('on', x === c));
      return;
    }
    const from = e.target.closest('[data-role=fromAcc] [data-a]');
    if (from) {
      draft.accountId = from.dataset.a;
      [...from.parentElement.children].forEach(x => x.classList.toggle('on', x === from));
      return;
    }
    const to = e.target.closest('[data-role=toAcc] [data-a]');
    if (to) {
      draft.toAccountId = to.dataset.a;
      [...to.parentElement.children].forEach(x => x.classList.toggle('on', x === to));
    }
  });

  el.querySelector('#eSave').addEventListener('click', async () => {
    const raw = el.querySelector('#eAmt').value.trim();
    const m = String(raw).match(/^(\d*)(?:\.(\d{0,2}))?$/);
    if (!m || (!m[1] && !m[2])) { toast('金额格式不对'); return; }
    const cents = parseInt(m[1] || '0', 10) * 100 + parseInt(((m[2] || '') + '00').slice(0, 2), 10);
    if (cents <= 0) { toast('金额要大于 0'); return; }
    if (draft.type === 'transfer' && draft.toAccountId === draft.accountId) { toast('转出和转入不能是同一个账户'); return; }
    const patch = {
      type: draft.type,
      amountCents: cents,
      categoryId: draft.type === 'transfer' ? null : draft.categoryId,
      accountId: draft.accountId,
      toAccountId: draft.type === 'transfer' ? draft.toAccountId : null,
      note: el.querySelector('#eNote').value,
      occurredAt: dateFromInput(el.querySelector('#eDate').value)
    };
    try {
      await store.updateTransaction(t.id, patch);
      replay.step('编辑保存 ' + t.id);
      toast('已保存');
      api.sheet.close();
      api.refresh();
    } catch (err) {
      logger.error('edit save failed: ' + err.message, 'ledger');
      toast('保存失败：' + err.message);
    }
  });

  el.querySelector('#eDel').addEventListener('click', async () => {
    if (!await api.confirm('确定删除这条记录？删除后可在设置里查看软删除数量，数据不会立刻物理消失。')) return;
    try {
      await store.deleteTransaction(t.id);
      replay.step('删除记录 ' + t.id);
      toast('已删除');
      api.sheet.close();
      api.refresh();
    } catch (err) {
      toast('删除失败：' + err.message);
    }
  });
}

export async function render(root, api){
  root.innerHTML = '<header class="bar"><h1>明细</h1></header>' + html();
  root.addEventListener('click', async e => {
    const hit = e.target.closest('[data-act]');
    if (!hit) return;
    const act = hit.dataset.act;
    if (act === 'prev') { F.month = shiftMonth(F.month, -1); api.refresh(); }
    else if (act === 'next') { F.month = shiftMonth(F.month, 1); api.refresh(); }
    else if (act === 'thismonth') { F.month = monthKey(); api.refresh(); }
    else if (act === 'ftype') { F.type = hit.dataset.v; api.refresh(); }
    else if (act === 'facc') { F.accountId = hit.dataset.v; api.refresh(); }
    else if (act === 'edit') { await openEditor(hit.dataset.id, api); }
  });
}

export function cleanup(){}
