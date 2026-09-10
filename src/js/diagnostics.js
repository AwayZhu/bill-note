import { store, netAssets, balanceOf } from './store.js';
import { repo, SCHEMA_VERSION, currentEngine } from './repository.js';
import { logger, replay, lastCrash, APP_BUILD, fmtLogLine } from './logger.js';
import { fmtCents, fmtDateTime, escapeHtml, toast, copyText, downloadFile, daysBetween } from './util.js';

const APP_VERSION = '0.1.0';

export async function collect(){
  const env = {
    version: APP_VERSION,
    build: APP_BUILD,
    shell: (typeof window.Capacitor !== 'undefined') ? 'Capacitor 原生' : '浏览器预览',
    ua: navigator.userAgent,
    screen: window.screen.width + 'x' + window.screen.height,
    viewport: window.innerWidth + 'x' + window.innerHeight,
    dpr: window.devicePixelRatio || 1,
    lang: navigator.language,
    tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
    online: navigator.onLine
  };

  const counts = await repo.counts();
  let usage = 0;
  let quota = 0;
  try {
    if (navigator.storage && navigator.storage.estimate) {
      const est = await navigator.storage.estimate();
      usage = est.usage || 0;
      quota = est.quota || 0;
    }
  } catch (e) { /* ignore */ }
  const selfTest = await repo.selfTest();
  const storage = {
    engine: currentEngine(),
    schema: SCHEMA_VERSION,
    counts, usage, quota, selfTest,
    lastBackupAt: store.lastBackupAt,
    draft: await repo.meta('draft', null),
    netAssets: netAssets()
  };

  const perms = await readPerms();

  const integrity = await runIntegrity();

  return { env, storage, perms, integrity };
}

async function readPerms(){
  const names = ['notifications', 'camera', 'persistent-storage'];
  const out = [];
  for (const n of names) {
    try {
      if (!navigator.permissions || !navigator.permissions.query) throw new Error('n/a');
      const st = await navigator.permissions.query({ name: n });
      out.push({ name: n, state: st.state });
    } catch (e) {
      out.push({ name: n, state: '不支持（需打包后查看）' });
    }
  }
  return out;
}

async function runIntegrity(){
  const accIds = new Set(store.accounts.map(a => a.id));
  const catIds = new Set(store.categories.map(c => c.id));
  const rows = [];
  let orphanAcc = 0, orphanCat = 0, badAmount = 0, missingTo = 0;

  const raw = await repo.transactionsRaw();
  const live = raw.filter(t => !t.deletedAt);

  for (const t of live) {
    if (!accIds.has(t.accountId)) orphanAcc++;
    if (t.type === 'transfer' && (!t.toAccountId || !accIds.has(t.toAccountId))) missingTo++;
    if (t.type !== 'transfer' && t.categoryId && !catIds.has(t.categoryId)) orphanCat++;
    if (!(t.amountCents > 0)) badAmount++;
  }

  let dup = 0;
  const sorted = live.slice().sort((a, b) => a.occurredAt - b.occurredAt);
  for (let i = 1; i < sorted.length; i++) {
    const a = sorted[i - 1], b = sorted[i];
    if (a.accountId === b.accountId && a.amountCents === b.amountCents &&
        a.type === b.type && (b.occurredAt - a.occurredAt) < 60000) dup++;
  }

  const computed = store.accounts.map(a => ({ name: a.name, bal: balanceOf(a.id) }));
  const negative = computed.filter(x => x.bal < 0 && !store.accounts.find(a => a.name === x.name && a.type === 'credit')).length;

  rows.push({ key: '孤儿记录（账户不存在）', count: orphanAcc });
  rows.push({ key: '转账缺转入账户', count: missingTo });
  rows.push({ key: '分类已不存在', count: orphanCat });
  rows.push({ key: '金额非正数', count: badAmount });
  rows.push({ key: '疑似重复（同账户同金额 60 秒内）', count: dup });
  rows.push({ key: '非信用卡账户余额为负', count: negative });

  return { rows, softDeleted: raw.length - live.length, total: raw.length };
}

function health(data){
  const bad = data.integrity.rows.reduce((a, r) => a + r.count, 0);
  const st = data.storage.selfTest;
  const writable = st.write && st.read && st.remove;
  if (!writable || bad > 0) return { level: 'danger', text: '发现异常' };
  const days = daysBetween(data.storage.lastBackupAt, Date.now());
  if (data.storage.lastBackupAt == null || (days != null && days > 30)) return { level: 'warn', text: '该备份了' };
  return { level: 'ok', text: '系统正常' };
}

function badge(level, text){
  return '<span class="badge ' + level + '">' + text + '</span>';
}

function line(name, right, extra){
  return '<div class="list-item">' +
    '<div class="grow"><div style="font-size:14px">' + escapeHtml(name) + '</div>' +
      (extra ? '<div class="tiny muted" style="margin-top:1px">' + escapeHtml(extra) + '</div>' : '') + '</div>' +
    '<div class="small mono-num" style="max-width:52%;text-align:right">' + right + '</div>' +
  '</div>';
}

export function diagnosticsHtml(data){
  const h = health(data);
  const days = daysBetween(data.storage.lastBackupAt, Date.now());
  const st = data.storage.selfTest;
  const writeMark = (st.write ? '写✓' : '写✗') + ' ' + (st.read ? '读✓' : '读✗') + ' ' + (st.remove ? '删✓' : '删✗');
  const badCount = data.integrity.rows.reduce((a, r) => a + r.count, 0);

  return '<div class="sheet-head"><h3>诊断面板</h3><span class="tiny muted">' + data.env.version + ' (build ' + data.env.build + ')</span></div>' +
    '<div class="card" style="margin:10px 12px 0">' +
      '<div class="row between"><span class="row small">' + badge(h.level, h.text) + '</span>' +
        '<span class="tiny muted">' + (data.storage.lastBackupAt ? '距上次备份 ' + days + ' 天' : '从未备份过') + '</span></div>' +
      '<div class="tiny muted" style="margin-top:6px">点下面任意按钮把报告发给我，我能直接定位问题</div>' +
    '</div>' +

    '<div class="card tight" style="margin:10px 12px 0">' +
      '<div class="day-head" style="padding:8px 14px">运行环境</div>' +
      line('运行壳', escapeHtml(data.env.shell)) +
      line('版本', data.env.version + ' (build ' + data.env.build + ')') +
      line('屏幕 / 视口', escapeHtml(data.env.viewport), '物理 ' + data.env.screen + ' · DPR ' + data.env.dpr) +
      line('语言 / 时区', escapeHtml(data.env.lang + ' · ' + data.env.tz)) +
    '</div>' +

    '<div class="card tight" style="margin:10px 12px 0">' +
      '<div class="day-head" style="padding:8px 14px">存储健康</div>' +
      line('引擎', escapeHtml(data.storage.engine)) +
      line('schema 版本', String(data.storage.schema)) +
      line('可写性自检', writeMark, st.error ? st.error : '') +
      line('记录数', '交易 ' + data.storage.counts.transactionsLive + ' · 账户 ' + data.storage.counts.accountsLive +
        ' · 分类 ' + data.storage.counts.categoriesLive, '含软删除：交易 ' + data.storage.counts.transactions) +
      line('占用体积', (data.storage.usage / 1024).toFixed(0) + ' KB', '配额 ' + (data.storage.quota / 1048576).toFixed(0) + ' MB') +
      line('净资产', '¥' + fmtCents(data.storage.netAssets), data.storage.draft ? '存在未完成的草稿输入' : '') +
    '</div>' +

    '<div class="card tight" style="margin:10px 12px 0">' +
      '<div class="day-head" style="padding:8px 14px">权限状态</div>' +
      data.perms.map(p => line(p.name, escapeHtml(p.state))).join('') +
    '</div>' +

    '<div class="card tight" style="margin:10px 12px 0">' +
      '<div class="day-head" style="padding:8px 14px">数据完整性自检' +
        (badCount ? ' <span class="badge danger">' + badCount + ' 项异常</span>' : ' <span class="badge ok">全部通过</span>') + '</div>' +
      data.integrity.rows.map(r => line(r.key,
        r.count ? '<span class="amount-e">' + r.count + '</span>' : '<span class="muted">0</span>')).join('') +
    '</div>' +

    '<div class="card tight" style="margin:10px 12px 0">' +
      '<div class="day-head" style="padding:8px 14px">错误与日志</div>' +
      line('未捕获错误', logger.errors().length ? '<span class="amount-e">' + logger.errors().length + '</span>' : '<span class="muted">0</span>') +
      line('日志条数', String(logger.count()), '环形缓冲上限 500') +
      (lastCrash() ? line('上次崩溃', fmtDateTime(lastCrash().at), lastCrash().where + ' · ' + lastCrash().message) : '') +
    '</div>' +

    '<div style="padding:12px 12px 0">' +
      '<button class="btn primary block lg" data-act="copy">复制诊断报告</button>' +
      '<button class="btn block lg" data-act="export" style="margin-top:8px">导出为 txt 文件</button>' +
      '<button class="btn block lg" data-act="clearlog" style="margin-top:8px">清空日志</button>' +
      '<div style="margin-top:12px"><div class="tiny muted">复现步骤记录器</div>' +
        '<button class="btn block lg" data-act="replay" style="margin-top:6px;border-color:var(--brand);color:var(--brand)">' +
          (replay.recording() ? '■ 结束并记录' : '● 开始记录复现步骤') + '</button>' +
        '<div class="tiny muted" style="margin-top:6px">先点开始 → 正常操作到出错 → 再点结束，时间线会附在报告里</div>' +
      '</div>' +
      '<details style="margin-top:12px"><summary class="small muted">查看原始报告文本</summary>' +
        '<pre class="report" id="reportPre"></pre></details>' +
    '</div>';
}

export async function buildReport(data, extraSteps){
  const st = data.storage.selfTest;
  const days = daysBetween(data.storage.lastBackupAt, Date.now());
  const L = [];
  L.push('===== 诊断报告 =====');
  L.push('生成时间: ' + fmtDateTime(Date.now()));
  L.push('注意: 本文件不联网、不上传，仅由用户手动导出');
  L.push('');
  L.push('[运行环境]');
  L.push('App 版本: ' + data.env.version + ' (build ' + data.env.build + ')');
  L.push('运行壳: ' + data.env.shell);
  L.push('屏幕/视口: ' + data.env.viewport + ' @' + data.env.dpr + 'x (物理 ' + data.env.screen + ')');
  L.push('语言/时区: ' + data.env.lang + ' / ' + data.env.tz);
  L.push('');
  L.push('[存储健康]');
  L.push('引擎: ' + data.storage.engine);
  L.push('schema: v' + data.storage.schema);
  L.push('可写性: ' + (st.write ? '写✓' : '写✗') + ' ' + (st.read ? '读✓' : '读✗') + ' ' + (st.remove ? '删✓' : '删✗') + (st.error ? ' err=' + st.error : ''));
  L.push('记录数: 交易 ' + data.storage.counts.transactionsLive + ' / 账户 ' + data.storage.counts.accountsLive + ' / 分类 ' + data.storage.counts.categoriesLive);
  L.push('占用: ' + (data.storage.usage / 1024).toFixed(0) + ' KB');
  L.push('上次备份: ' + (data.storage.lastBackupAt ? fmtDateTime(data.storage.lastBackupAt) + '（' + days + ' 天前）' : '从未备份'));
  L.push('草稿: ' + (data.storage.draft ? '有（未完成输入）' : '无'));
  L.push('净资产: ¥' + fmtCents(data.storage.netAssets) + '（不含金额明细，如需明细请手动开启）');
  L.push('');
  L.push('[权限]');
  data.perms.forEach(p => L.push(p.name + ': ' + p.state));
  L.push('');
  L.push('[完整性自检]');
  data.integrity.rows.forEach(r => L.push((r.count ? '[异常] ' : '[通过] ') + r.key + ': ' + r.count));
  L.push('软删除保留: ' + data.integrity.softDeleted + ' 条');
  L.push('');
  L.push('[错误]');
  const errs = logger.errors();
  L.push('未捕获错误: ' + errs.length);
  errs.slice(-5).forEach(e => L.push(fmtLogLine(e)));
  const c = lastCrash();
  if (c) {
    L.push('上次崩溃: ' + fmtDateTime(c.at) + ' @' + c.where);
    L.push(c.message);
    if (c.stack) L.push(c.stack);
  }
  L.push('');
  L.push('[最近日志]');
  logger.all().slice(-40).forEach(x => L.push(fmtLogLine(x)));
  if (extraSteps && extraSteps.length) {
    L.push('');
    L.push('[复现步骤时间线]');
    extraSteps.forEach(s => L.push('+' + (s.t / 1000).toFixed(1) + 's  ' + s.text));
  }
  L.push('===================');
  return L.join('\n');
}

export async function openDiagnostics(api){
  let data;
  try {
    data = await collect();
  } catch (e) {
    logger.error('diagnostics collect failed: ' + e.message, 'diag');
    api.sheet.open('<div class="sheet-head"><h3>诊断面板</h3></div><div class="empty">读取诊断信息失败：' + escapeHtml(e.message) +
      '<br><span class="tiny">请把这行字原样发给开发者</span></div>');
    return;
  }
  let steps = null;
  const el = api.sheet.open(diagnosticsHtml(data));
  const pre = el.querySelector('#reportPre');
  const paint = async () => {
    pre.textContent = await buildReport(data, steps);
  };
  paint();

  el.addEventListener('click', async e => {
    const hit = e.target.closest('[data-act]');
    if (!hit) return;
    const act = hit.dataset.act;
    if (act === 'copy') {
      const txt = await buildReport(data, steps);
      const ok = await copyText(txt);
      toast(ok ? '诊断报告已复制，粘贴发给我就行' : '复制失败，请改用「导出 txt」');
      replay.step('复制诊断报告');
    } else if (act === 'export') {
      const txt = await buildReport(data, steps);
      downloadFile('诊断报告-' + fmtDateTime(Date.now()).replace(/[: ]/g, '-') + '.txt', txt, 'text/plain');
      toast('已导出到下载目录');
      replay.step('导出诊断报告');
    } else if (act === 'clearlog') {
      logger.clear();
      toast('日志已清空');
      api.sheet.close();
      openDiagnostics(api);
    } else if (act === 'replay') {
      if (replay.recording()) {
        steps = replay.stop();
        toast('已记录 ' + steps.length + ' 步，重新导出报告即可带上');
        el.querySelector('[data-act=replay]').textContent = '● 开始记录复现步骤';
        paint();
      } else {
        replay.start();
        toast('开始记录，去复现问题吧');
        el.querySelector('[data-act=replay]').textContent = '■ 结束并记录';
      }
    }
  });
}
