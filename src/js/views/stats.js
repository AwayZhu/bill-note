import { store, monthStats, byCategory, monthlyTrend, recentMonths, compareMonth, budgetStatus } from '../store.js';
import { pie, bars } from '../charts.js';
import { fmtCents, escapeHtml, monthKey, monthLabel, shiftMonth, toast } from '../util.js';
import { replay } from '../logger.js';

const V = { month: monthKey(), tab: 'pie', trendKind: 'expense' };

function cur(){ return store.settings.currency || '¥'; }

function headHtml(){
  return '<header class="bar">' +
    '<span class="btn small" data-act="prev" style="padding:4px 10px">‹</span>' +
    '<h1 style="font-size:17px">' + monthLabel(V.month) +
      (V.month !== monthKey() ? ' <span class="btn small" data-act="thismonth" style="padding:2px 8px">回本月</span>' : '') +
    '</h1>' +
    '<span class="btn small" data-act="next" style="padding:4px 10px">›</span>' +
  '</header>';
}

function budgetCard(){
  const st = budgetStatus(V.month);
  if (st.total.limitCents == null) {
    return '<div class="card" style="margin:6px 12px 0">' +
      '<div class="row between"><span class="small muted">本月还没有设置预算</span>' +
      '<span class="btn small" data-act="go-settings" style="padding:4px 10px">去设置</span></div></div>';
  }
  const used = st.total.usedCents;
  const limit = st.total.limitCents;
  const pct = Math.min(100, Math.round(used / limit * 100));
  const left = limit - used;
  const cls = left < 0 ? 'over' : (pct >= 80 ? 'warn' : '');
  return '<div class="card" style="margin:6px 12px 0">' +
    '<div class="row between"><span class="small">月度总预算</span>' +
      '<span class="small mono-num ' + (left < 0 ? 'amount-e' : '') + '">' + cur() + fmtCents(used) + ' / ' + cur() + fmtCents(limit) + '</span></div>' +
    '<div class="progress ' + cls + '"><i style="width:' + pct + '%"></i></div>' +
    '<div class="tiny muted" style="margin-top:6px">' +
      (left < 0 ? '已超支 ' + cur() + fmtCents(-left) : '剩余 ' + cur() + fmtCents(left) + ' · 已用 ' + pct + '%') +
    '</div></div>';
}

function summaryHtml(){
  const s = monthStats(V.month);
  return '<div class="stat-grid">' +
    '<div class="stat"><div class="lb">支出</div><div class="vl amount-e">' + cur() + fmtCents(s.expense) + '</div></div>' +
    '<div class="stat"><div class="lb">收入</div><div class="vl amount-i">' + cur() + fmtCents(s.income) + '</div></div>' +
    '<div class="stat"><div class="lb">结余</div><div class="vl">' + cur() + fmtCents(s.net) + '</div></div>' +
  '</div>' + budgetCard();
}

function tabsHtml(){
  const tabs = [['pie', '分类占比'], ['trend', '月度趋势'], ['compare', '同比环比'], ['rank', '排行榜']];
  return '<div style="padding:6px 12px 0"><div class="seg">' +
    tabs.map(([k, n]) => '<button data-act="tab" data-v="' + k + '" class="' + (V.tab === k ? 'on' : '') + '">' + n + '</button>').join('') +
  '</div></div>';
}

function pieView(){
  const rows = byCategory(V.month, 'expense');
  const total = rows.reduce((a, r) => a + r.cents, 0);
  const legend = rows.map(r => {
    const pct = total ? (r.cents / total * 100) : 0;
    return '<div class="meter-line">' +
      '<span class="nm">' + escapeHtml((r.icon || '') + ' ' + r.name) + '</span>' +
      '<span class="bar"><span class="progress" style="margin:0"><i style="width:' + Math.max(2, pct) + '%;background:' + r.color + '"></i></span></span>' +
      '<span class="vl"><b>' + pct.toFixed(0) + '%</b> <span class="muted">' + cur() + fmtCents(r.cents) + '</span></span>' +
    '</div>';
  }).join('');
  return '<div class="card" style="margin:10px 12px 0">' +
      '<div class="small muted center">支出结构</div>' +
      '<canvas id="pieCv" style="width:100%;max-width:220px;display:block;margin:6px auto 0"></canvas>' +
    '</div>' +
    '<div class="card tight" style="margin:10px 12px 12px">' + legend + '</div>';
}

function trendView(){
  const keys = recentMonths(12, V.month);
  const rows = monthlyTrend(keys).map(r => ({ label: r.label, value: V.trendKind === 'expense' ? r.expense : r.income }));
  return '<div style="padding:6px 12px 0"><div class="seg">' +
      '<button data-act="kind" data-v="expense" class="' + (V.trendKind === 'expense' ? 'on' : '') + '">支出</button>' +
      '<button data-act="kind" data-v="income" class="' + (V.trendKind === 'income' ? 'on' : '') + '">收入</button>' +
    '</div></div>' +
    '<div class="card" style="margin:10px 12px 12px">' +
      '<div class="small muted center">近 12 个月' + (V.trendKind === 'expense' ? '支出' : '收入') + '</div>' +
      '<canvas id="barCv" style="width:100%;display:block;margin-top:8px"></canvas>' +
    '</div>';
}

function compareRow(label, a, b){
  const diff = a - b;
  const pct = b === 0 ? null : (diff / b * 100);
  const up = diff > 0;
  const cls = up ? 'amount-e' : 'amount-i';
  return '<div class="meter-line">' +
    '<span class="nm">' + label + '</span>' +
    '<span class="bar small mono-num">' + cur() + fmtCents(a) + '<span class="tiny muted"> vs ' + cur() + fmtCents(b) + '</span></span>' +
    '<span class="vl small ' + (diff === 0 ? 'muted' : cls) + '">' +
      (diff === 0 ? '持平' : (up ? '↑' : '↓') + cur() + fmtCents(Math.abs(diff)) +
        (pct == null ? '' : ' <span class="tiny">(' + (up ? '+' : '-') + Math.abs(pct).toFixed(0) + '%)</span>')) +
    '</span></div>';
}

function compareView(){
  const c = compareMonth(V.month);
  return '<div class="card" style="margin:10px 12px 0">' +
      '<div class="small muted">环比 · 对比 ' + monthLabel(c.prevKey) + '</div>' +
      '<div class="card tight" style="margin:8px 0 0">' +
        compareRow('支出', c.cur.expense, c.prev.expense) +
        compareRow('收入', c.cur.income, c.prev.income) +
        compareRow('结余', c.cur.net, c.prev.net) +
      '</div>' +
    '</div>' +
    '<div class="card" style="margin:10px 12px 12px">' +
      '<div class="small muted">同比 · 对比 ' + monthLabel(c.lastYearKey) + '</div>' +
      '<div class="card tight" style="margin:8px 0 0">' +
        compareRow('支出', c.cur.expense, c.lastYear.expense) +
        compareRow('收入', c.cur.income, c.lastYear.income) +
        compareRow('结余', c.cur.net, c.lastYear.net) +
      '</div>' +
    '</div>';
}

function rankView(){
  const rows = byCategory(V.month, 'expense');
  const total = rows.reduce((a, r) => a + r.cents, 0);
  if (!rows.length) return '<div class="empty">本月还没有支出记录</div>';
  return '<div class="card tight" style="margin:10px 12px 12px">' + rows.map((r, i) => {
    const b = store.budgetFor(V.month, r.id);
    let badge = '';
    if (b) {
      const over = r.cents > b.limitCents;
      badge = '<div class="progress ' + (over ? 'over' : '') + '" style="margin:4px 0 0"><i style="width:' +
        Math.min(100, Math.round(r.cents / b.limitCents * 100)) + '%"></i></div>' +
        '<div class="tiny ' + (over ? 'amount-e' : 'muted') + '">预算 ' + cur() + fmtCents(b.limitCents) +
        (over ? ' · 超支 ' + cur() + fmtCents(r.cents - b.limitCents) : '') + '</div>';
    }
    const pct = total ? (r.cents / total * 100) : 0;
    return '<div class="list-item" style="align-items:flex-start">' +
      '<div style="width:22px;font-weight:600;color:' + (i < 3 ? '#dd8b1a' : '#b0b0b8') + ';font-size:15px">' + (i + 1) + '</div>' +
      '<div class="ic-box">' + escapeHtml(r.icon || '❓') + '</div>' +
      '<div class="grow">' +
        '<div style="font-size:14px">' + escapeHtml(r.name) + ' <span class="tiny muted">' + pct.toFixed(0) + '%</span></div>' +
        badge +
      '</div>' +
      '<div class="amount-e">' + cur() + fmtCents(r.cents) + '</div>' +
    '</div>';
  }).join('') + '</div>';
}

function bodyHtml(){
  if (V.tab === 'pie') return pieView();
  if (V.tab === 'trend') return trendView();
  if (V.tab === 'compare') return compareView();
  return rankView();
}

function afterPaint(root){
  if (V.tab === 'pie') {
    const cv = root.querySelector('#pieCv');
    if (cv) pie(cv, byCategory(V.month, 'expense'));
  } else if (V.tab === 'trend') {
    const cv = root.querySelector('#barCv');
    if (cv) {
      const keys = recentMonths(12, V.month);
      const rows = monthlyTrend(keys).map(r => ({ label: r.label, value: V.trendKind === 'expense' ? r.expense : r.income }));
      bars(cv, rows, { height: 170, picked: rows.length - 1, color: V.trendKind === 'expense' ? '#f0b3ae' : '#a8d8bf', activeColor: V.trendKind === 'expense' ? '#e0524a' : '#1f9d63' });
    }
  }
}

export async function render(root, api){
  root.innerHTML = headHtml() + summaryHtml() + tabsHtml() + bodyHtml();
  requestAnimationFrame(() => afterPaint(root));
  root.addEventListener('click', e => {
    const hit = e.target.closest('[data-act]');
    if (!hit) return;
    const act = hit.dataset.act;
    if (act === 'prev') { V.month = shiftMonth(V.month, -1); api.refresh(); }
    else if (act === 'next') { V.month = shiftMonth(V.month, 1); api.refresh(); }
    else if (act === 'tab') { V.tab = hit.dataset.v; replay.step('统计切到 ' + V.tab); api.refresh(); }
    else if (act === 'thismonth') { V.month = monthKey(); api.refresh(); }
    else if (act === 'kind') { V.trendKind = hit.dataset.v; api.refresh(); }
    else if (act === 'go-settings') { api.go('settings'); }
  });
}

export function cleanup(){}
