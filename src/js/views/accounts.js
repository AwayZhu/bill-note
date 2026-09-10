import { store, netAssets, balanceOf } from '../store.js';
import { ACCOUNT_TYPES, nextSortOrder } from '../seed.js';
import { logger, replay } from '../logger.js';
import { fmtCents, escapeHtml, toast } from '../util.js';

const ICONS = ['💵', '🏦', '💳', '🅰️', '💬', '🧧', '📈', '💰', '🏠', '🚗', '🎁', '📦'];

function cur(){ return store.settings.currency || '¥'; }

function typeLabel(k){
  const t = ACCOUNT_TYPES.find(x => x.key === k);
  return t ? t.label : k;
}

function listHtml(){
  if (!store.accounts.length) return '<div class="empty">还没有账户<br><span class="tiny">点下面「新增账户」建一个</span></div>';
  return store.accounts.map(a => {
    const bal = balanceOf(a.id);
    const cls = bal < 0 ? 'amount-e' : '';
    return '<div class="list-item" data-act="edit" data-id="' + a.id + '">' +
      '<div class="ic-box">' + escapeHtml(a.icon || '💰') + '</div>' +
      '<div class="grow">' +
        '<div style="font-size:14px">' + escapeHtml(a.name) + '</div>' +
        '<div class="tiny muted">' + typeLabel(a.type) + (a.type === 'credit' && a.creditLimitCents ? ' · 额度 ' + cur() + fmtCents(a.creditLimitCents) : '') + '</div>' +
      '</div>' +
      '<div class="mono-num ' + cls + '">' + cur() + fmtCents(bal) + '</div>' +
    '</div>';
  }).join('');
}

function editorHtml(a){
  const isNew = !a.id;
  return '<div class="sheet-head"><h3>' + (isNew ? '新增账户' : '编辑账户') + '</h3>' +
    (isNew ? '' : '<span class="btn small danger" id="aDel">删除</span>') + '</div>' +
    '<div style="padding:12px 16px">' +
      '<div class="tiny muted">名称</div><input id="aName" type="text" value="' + escapeHtml(a.name || '') + '" placeholder="例如 招商银行卡" style="margin-top:6px">' +
      '<div style="margin-top:12px"><div class="tiny muted">类型</div>' +
        '<div class="chips" style="margin-top:6px" data-role="type">' +
          ACCOUNT_TYPES.map(t => '<div class="chip' + (a.type === t.key ? ' on' : '') + '" data-t="' + t.key + '">' + t.label + '</div>').join('') +
        '</div></div>' +
      '<div style="margin-top:12px"><div class="tiny muted">图标</div>' +
        '<div class="chips" style="margin-top:6px" data-role="icon">' +
          ICONS.map(i => '<div class="chip" data-i="' + i + '" style="font-size:17px;padding:5px 11px">' + i + '</div>').join('') +
        '</div></div>' +
      '<div style="margin-top:12px"><div class="tiny muted">期初余额（建账时的钱，之后由流水自动算出）</div>' +
        '<input id="aInit" type="text" inputmode="decimal" value="' + ((a.initialBalanceCents || 0) / 100).toFixed(2) + '" style="margin-top:6px"></div>' +
      '<div style="margin-top:12px"><div class="tiny muted">信用额度（选填，仅信用卡）</div>' +
        '<input id="aLimit" type="text" inputmode="decimal" value="' + ((a.creditLimitCents || 0) / 100).toFixed(2) + '" style="margin-top:6px"></div>' +
      '<button class="btn primary block lg" id="aSave" style="margin-top:16px">保存</button>' +
    '</div>';
}

function parseMoney(raw){
  const s = String(raw || '').trim();
  if (!s) return 0;
  if (s.startsWith('-')) {
    const m = s.slice(1).match(/^(\d*)(?:\.(\d{0,2}))?$/);
    if (!m) return null;
    return -(parseInt(m[1] || '0', 10) * 100 + parseInt(((m[2] || '') + '00').slice(0, 2), 10));
  }
  const m = s.match(/^(\d*)(?:\.(\d{0,2}))?$/);
  if (!m) return null;
  return parseInt(m[1] || '0', 10) * 100 + parseInt(((m[2] || '') + '00').slice(0, 2), 10);
}

export function openEditor(id, api){
  const a = id ? store.accounts.find(x => x.id === id) : null;
  const draft = a ? { ...a } : { name: '', type: 'cash', icon: '💵', initialBalanceCents: 0, creditLimitCents: 0, sortOrder: nextSortOrder(store.accounts) };
  const el = api.sheet.open(editorHtml(draft));

  const pickIcon = el.querySelector('[data-i="' + (draft.icon || '💵') + '"]');
  if (pickIcon) pickIcon.classList.add('on');

  el.addEventListener('click', e => {
    const t = e.target.closest('[data-t]');
    if (t) { draft.type = t.dataset.t; [...t.parentElement.children].forEach(x => x.classList.toggle('on', x === t)); return; }
    const i = e.target.closest('[data-i]');
    if (i) { draft.icon = i.dataset.i; [...i.parentElement.children].forEach(x => x.classList.toggle('on', x === i)); }
  });

  el.querySelector('#aSave').addEventListener('click', async () => {
    draft.name = el.querySelector('#aName').value.trim();
    if (!draft.name) { toast('请填名称'); return; }
    const init = parseMoney(el.querySelector('#aInit').value);
    const lim = parseMoney(el.querySelector('#aLimit').value);
    if (init === null || lim === null) { toast('金额格式不对，最多两位小数'); return; }
    draft.initialBalanceCents = init;
    draft.creditLimitCents = lim;
    try {
      await store.saveAccount(draft);
      replay.step('保存账户 ' + draft.name);
      toast('已保存');
      api.sheet.close();
      api.refresh();
    } catch (err) {
      logger.error('account save failed: ' + err.message, 'account');
      toast('保存失败：' + err.message);
    }
  });

  const del = el.querySelector('#aDel');
  if (del) del.addEventListener('click', async () => {
    if (!await api.confirm('确定删除账户「' + draft.name + '」？')) return;
    try {
      await store.deleteAccount(draft.id);
      toast('已删除');
      api.sheet.close();
      api.refresh();
    } catch (err) {
      toast(err.message);
    }
  });
}

export async function render(root, api){
  const total = netAssets();
  root.innerHTML = '<header class="bar"><h1>账户</h1>' +
      '<span class="btn small primary" data-act="add" style="padding:5px 12px">＋ 新增</span></header>' +
    '<div class="card" style="margin:6px 12px 0">' +
      '<div class="small muted">净资产（各账户余额合计）</div>' +
      '<div class="amt-out mono-num" style="font-size:28px;margin-top:2px">' + cur() + fmtCents(total) + '</div>' +
    '</div>' +
    '<div class="card tight" style="margin:10px 12px 12px">' + listHtml() + '</div>' +
    '<div class="small muted center">信用卡算作负值，合计时自动扣减</div>';

  root.addEventListener('click', e => {
    const hit = e.target.closest('[data-act]');
    if (!hit) return;
    if (hit.dataset.act === 'add') openEditor(null, api);
    else if (hit.dataset.act === 'edit') openEditor(hit.dataset.id, api);
  });
}

export function cleanup(){}
