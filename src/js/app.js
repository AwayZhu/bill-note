import { store } from './store.js';
import { repo, detectEngine } from './repository.js';
import { ensureSeed } from './seed.js';
import { logger, logRoute, replay, recordCrash } from './logger.js';
import { escapeHtml, toast, copyText } from './util.js';
import { openDiagnostics } from './diagnostics.js';
import { installLock, maybeLockOnForeground } from './lock.js';
import * as RecordView from './views/record.js';
import * as LedgerView from './views/ledger.js';
import * as StatsView from './views/stats.js';
import * as AccountsView from './views/accounts.js';
import * as SettingsView from './views/settings.js';

const ROUTES = {
  record: RecordView,
  ledger: LedgerView,
  stats: StatsView,
  accounts: AccountsView,
  settings: SettingsView
};

const TABS = [
  ['record', '⌨️', '记账'],
  ['ledger', '📋', '明细'],
  ['stats', '📊', '统计'],
  ['accounts', '💳', '账户'],
  ['settings', '⚙️', '我的']
];

let screen = null;
let sheetRoot = null;
let tabbar = null;
let currentView = null;
let currentName = 'record';

function routeFromHash(){
  const h = (location.hash || '').replace(/^#\/?/, '');
  return ROUTES[h] ? h : 'record';
}

function apiFactory(){
  return {
    go(name){
      if (!ROUTES[name]) return;
      location.hash = '#/' + name;
    },
    refresh(){ return renderCurrent(); },
    sheet: {
      open(html){
        sheetRoot.innerHTML = '<div class="mask"><div class="sheet">' + html + '</div></div>';
        const mask = sheetRoot.firstElementChild;
        mask.addEventListener('click', e => {
          if (e.target === mask) apiRef.sheet.close();
        });
        return mask.querySelector('.sheet');
      },
      close(){ sheetRoot.innerHTML = ''; }
    },
    confirm(msg){ return confirmDialog(msg); }
  };
}

let apiRef = null;

function confirmDialog(msg){
  return new Promise(resolve => {
    const wrap = document.createElement('div');
    wrap.className = 'mask';
    wrap.style.zIndex = '150';
    wrap.innerHTML = '<div class="sheet" style="padding:16px">' +
      '<div style="font-size:15px;margin:6px 2px 16px;line-height:1.6">' + escapeHtml(msg) + '</div>' +
      '<div style="display:flex;gap:10px">' +
        '<button class="btn" data-n style="flex:1">取消</button>' +
        '<button class="btn primary" data-y style="flex:1">确定</button>' +
      '</div></div>';
    document.body.appendChild(wrap);
    const done = v => { wrap.remove(); resolve(v); };
    wrap.addEventListener('click', e => {
      if (e.target === wrap) done(false);
      if (e.target.closest('[data-n]')) done(false);
      if (e.target.closest('[data-y]')) done(true);
    });
  });
}

function paintTab(name){
  tabbar.innerHTML = '<div class="inner">' + TABS.map(([k, icon, label]) =>
    '<a data-r="' + k + '" class="' + (k === name ? 'on' : '') + '">' +
      '<span class="ti">' + icon + '</span><span>' + label + '</span></a>').join('') + '</div>';
}

function paintError(err, where){
  const msg = (err && err.message) ? err.message : String(err);
  const stack = (err && err.stack) ? String(err.stack) : '';
  const brief = '【' + where + '】' + msg + '\n' + stack + '\nUA: ' + navigator.userAgent;
  logger.error('render failed @' + where + ': ' + msg, 'app');
  recordCrash(where, err);
  screen.innerHTML = '<header class="bar"><h1>出错了</h1></header>' +
    '<div class="card" style="margin:12px">' +
      '<div style="font-size:14px;margin-bottom:8px">页面没能正常打开。</div>' +
      '<div class="tiny muted" style="margin-bottom:10px">出错位置：<b>' + escapeHtml(where) + '</b></div>' +
      '<pre class="errbox">' + escapeHtml(msg + (stack ? '\n' + stack : '')) + '</pre>' +
      '<div class="row" style="gap:10px;margin-top:12px">' +
        '<button class="btn primary" id="copyErr" style="flex:1">复制错误信息</button>' +
        '<button class="btn" id="toDiag" style="flex:1">打开诊断面板</button>' +
      '</div>' +
      '<button class="btn block" id="retryBtn" style="margin-top:8px">重试</button>' +
    '</div>';
  const copy = screen.querySelector('#copyErr');
  if (copy) copy.addEventListener('click', async () => {
    const ok = await copyText(brief);
    toast(ok ? '已复制，直接发给我' : '复制失败，请长按上方文字手动复制');
  });
  const diag = screen.querySelector('#toDiag');
  if (diag) diag.addEventListener('click', () => openDiagnostics(apiRef));
  const retry = screen.querySelector('#retryBtn');
  if (retry) retry.addEventListener('click', () => renderCurrent());
}

async function renderCurrent(){
  const name = routeFromHash();
  currentName = name;
  paintTab(name);
  const view = ROUTES[name];
  screen.innerHTML = '<div class="center muted" style="padding:60px 0;font-size:13px">加载中…</div>';
  try {
    await store.reload();
    if (currentView && currentView.cleanup) {
      try { currentView.cleanup(); } catch (e) { logger.warn('cleanup: ' + e.message, 'app'); }
    }
    currentView = null;
    logRoute(name);
    // 关键：每次渲染给视图一个全新的容器元素。
    // 视图把 click 监听器挂在 root 上，若复用常驻的 #screen，
    // 每次重绘都会叠加一个监听器 —— 点一次翻月会翻 1、2、3… 个月，且越来越卡。
    const holder = document.createElement('div');
    holder.className = 'view';
    await view.render(holder, apiRef);
    screen.innerHTML = '';
    screen.appendChild(holder);
    currentView = view;
  } catch (err) {
    currentView = null;
    paintError(err, name);
  }
  window.scrollTo(0, 0);
}

async function boot(){
  screen = document.getElementById('screen');
  sheetRoot = document.getElementById('sheet-root');
  tabbar = document.getElementById('tabbar');
  apiRef = apiFactory();

  tabbar.addEventListener('click', e => {
    const a = e.target.closest('[data-r]');
    if (a) apiRef.go(a.dataset.r);
  });
  window.addEventListener('hashchange', renderCurrent);

  try {
    const engine = await detectEngine();
    logger.info('engine: ' + engine, 'boot');
    await ensureSeed();
    await store.reload();
    const hadDraft = await repo.meta('draft', null);
    if (hadDraft) toast('检测到上次没记完的内容，已自动恢复');
  } catch (err) {
    paintError(err, '初始化');
    return;
  }

  await installLock(apiRef);
  maybeLockOnForeground(apiRef);

  await renderCurrent();
  logger.info('boot ok', 'app');
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
