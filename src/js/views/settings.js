import { store, budgetStatus } from '../store.js';
import { repo } from '../repository.js';
import { logger, replay, APP_BUILD } from '../logger.js';
import { openDiagnostics } from '../diagnostics.js';
import { fmtCents, escapeHtml, toast, monthKey, monthLabel, downloadFile, fmtDateTime, daysBetween } from '../util.js';
import { nextSortOrder, seedDemoData, clearDemoData, demoCount } from '../seed.js';
import { openLockSetup, lockInfo } from '../lock.js';

const CAT_ICONS = ['🍜', '🚌', '🛍️', '🏠', '🎮', '💊', '📚', '📱', '🎁', '🧴', '✈️', '📦', '💰', '🏆', '💼', '📈', '🧧', '↩️', '✨', '☕', '🍺', '🎬', '🏃', '🐱', '🚗', '⛽', '🎫', '🍎', '🧾', '💇'];
const CAT_COLORS = ['#e0524a', '#e08a1e', '#1f9d63', '#3a7bd5', '#8b5cf6', '#d94684', '#0ea5a5', '#7c6a3a'];

function cur(){ return store.settings.currency || '¥'; }

function parseMoney(raw){
  const s = String(raw || '').trim();
  if (!s) return null;
  const m = s.match(/^(\d*)(?:\.(\d{0,2}))?$/);
  if (!m || (!m[1] && !m[2])) return null;
  return parseInt(m[1] || '0', 10) * 100 + parseInt(((m[2] || '') + '00').slice(0, 2), 10);
}

function row(label, sub, right){
  return '<div class="list-item" ' + (right && right.act ? 'data-act="' + right.act + '"' : '') + '>' +
    '<div class="grow"><div style="font-size:14px">' + escapeHtml(label) + '</div>' +
      (sub ? '<div class="tiny muted" style="margin-top:1px">' + escapeHtml(sub) + '</div>' : '') + '</div>' +
    '<div class="small muted">' + (right && right.text ? escapeHtml(right.text) : '') + '</div></div>';
}

function backupDays(){
  const d = daysBetween(store.lastBackupAt, Date.now());
  if (store.lastBackupAt == null) return '从未备份';
  return d === 0 ? '今天已备份' : d + ' 天前备份';
}

// 浏览器在手机存储紧张时有权清掉 IndexedDB。申请持久化存储可以让它别清。
async function persistState(){
  try {
    if (!navigator.storage || !navigator.storage.persisted) return 'unknown';
    return (await navigator.storage.persisted()) ? 'on' : 'off';
  } catch (e) { return 'unknown'; }
}

function persistText(state){
  if (state === 'on') return '已保护';
  if (state === 'off') return '未保护 · 点此申请';
  return '打包后自动保护';
}

export function renderBudgetSheet(api){
  const key = monthKey();
  const st = budgetStatus(key);
  const el = api.sheet.open(
    '<div class="sheet-head"><h3>预算 · ' + monthLabel(key) + '</h3></div>' +
    '<div style="padding:12px 16px">' +
      '<div class="tiny muted">月度总预算（留空 = 不限制）</div>' +
      '<div class="row" style="margin-top:6px">' +
        '<span style="font-size:17px">' + cur() + '</span>' +
        '<input id="bTotal" type="text" inputmode="decimal" value="' + (st.total.limitCents != null ? (st.total.limitCents / 100).toFixed(2) : '') + '" placeholder="0.00">' +
      '</div>' +
      '<div class="divider"></div>' +
      '<div class="tiny muted">分类预算（只对支出分类生效）</div>' +
      '<div class="card tight" style="margin:6px 0 0">' +
        store.cats('expense').map(c => {
          const b = store.budgetFor(key, c.id);
          return '<div class="list-item">' +
            '<div class="ic-box">' + escapeHtml(c.icon || '❓') + '</div>' +
            '<div class="grow"><div style="font-size:14px">' + escapeHtml(c.name) + '</div>' +
              '<div class="tiny muted">本月已用 ' + cur() + fmtCents(st.categories.find(x => x.id === c.id) ? st.categories.find(x => x.id === c.id).cents : 0) + '</div></div>' +
            '<input class="cbudget" data-c="' + c.id + '" type="text" inputmode="decimal" placeholder="不限" ' +
              'value="' + (b ? (b.limitCents / 100).toFixed(2) : '') + '" style="width:96px;text-align:right">' +
          '</div>';
        }).join('') +
      '</div>' +
      '<button class="btn primary block lg" id="bSave" style="margin-top:16px">保存预算</button>' +
    '</div>');

  el.querySelector('#bSave').addEventListener('click', async () => {
    try {
      const totalRaw = el.querySelector('#bTotal').value.trim();
      const totalCents = totalRaw === '' ? null : parseMoney(totalRaw);
      if (totalRaw !== '' && totalCents === null) { toast('总预算金额格式不对'); return; }
      await store.setBudget(key, null, totalCents);
      for (const inp of el.querySelectorAll('.cbudget')) {
        const raw = inp.value.trim();
        if (raw === '') { await store.setBudget(key, inp.dataset.c, null); continue; }
        const cents = parseMoney(raw);
        if (cents === null) { toast('「' + store.cat(inp.dataset.c).name + '」金额格式不对'); return; }
        await store.setBudget(key, inp.dataset.c, cents);
      }
      await store.reload();
      toast('预算已保存');
      replay.step('保存预算');
      api.sheet.close();
      api.refresh();
    } catch (err) {
      logger.error('budget save failed: ' + err.message, 'settings');
      toast('保存失败：' + err.message);
    }
  });
}

export function renderCategorySheet(api, kindArg){
  let kind = kindArg || 'expense';
  const el = api.sheet.open('<div data-role="body"></div>');
  const body = el.querySelector('[data-role=body]');

  const paint = () => {
    const list = store.cats(kind);
    body.innerHTML =
      '<div class="sheet-head"><h3>分类管理</h3><span class="btn small primary" id="cAdd">＋ 新增</span></div>' +
      '<div style="padding:8px 16px 0"><div class="seg">' +
        '<button data-k="expense" class="' + (kind === 'expense' ? 'on' : '') + '">支出分类</button>' +
        '<button data-k="income" class="' + (kind === 'income' ? 'on' : '') + '">收入分类</button>' +
      '</div></div>' +
      '<div class="card tight" style="margin:10px 12px 12px">' +
        (list.length ? list.map((c, i) =>
          '<div class="list-item">' +
            '<div class="ic-box" style="background:' + (c.color || '#f0f1f5') + '22">' + escapeHtml(c.icon || '❓') + '</div>' +
            '<div class="grow"><div style="font-size:14px">' + escapeHtml(c.name) +
              (c.isSystem ? ' <span class="badge">预置</span>' : '') + '</div>' +
              '<div class="tiny muted">排序 ' + (c.sortOrder + 1) + '</div></div>' +
            '<span class="btn small" data-up="' + c.id + '"' + (i === 0 ? ' style="opacity:.4"' : '') + '>↑</span>' +
            '<span class="btn small" data-down="' + c.id + '"' + (i === list.length - 1 ? ' style="opacity:.4"' : '') + '>↓</span>' +
            '<span class="btn small" data-edit="' + c.id + '">改</span>' +
            '<span class="btn small danger" data-del="' + c.id + '">删</span>' +
          '</div>').join('') : '<div class="empty">还没有分类</div>') +
      '</div>' +
      '<div class="small muted center" style="padding:0 24px 12px">预置分类删不掉但有记录时也无法删除；想停用可以先把名字改成 "zz旧分类" 之类排在最后</div>';
  };
  paint();

  body.addEventListener('click', async e => {
    const k = e.target.closest('[data-k]');
    if (k) { kind = k.dataset.k; paint(); return; }
    if (e.target.closest('#cAdd')) { openCatEditor(null, kind, api, paint); return; }

    const up = e.target.closest('[data-up]');
    if (up) { await move(up.dataset.up, -1); return; }
    const down = e.target.closest('[data-down]');
    if (down) { await move(down.dataset.down, 1); return; }
    const ed = e.target.closest('[data-edit]');
    if (ed) { openCatEditor(ed.dataset.edit, kind, api, paint); return; }
    const del = e.target.closest('[data-del]');
    if (del) {
      const c = store.cat(del.dataset.del);
      try {
        await store.deleteCategory(del.dataset.del);
        await store.reload();
        toast('已删除「' + c.name + '」');
        api.refresh();
        paint();
      } catch (err) { toast(err.message); }
    }
  });

  async function move(id, dir){
    const list = store.cats(kind);
    const i = list.findIndex(c => c.id === id);
    const j = i + dir;
    if (j < 0 || j >= list.length) return;
    const tmp = list[i].sortOrder;
    list[i].sortOrder = list[j].sortOrder;
    list[j].sortOrder = tmp;
    await repo.putCategory(list[i]);
    await repo.putCategory(list[j]);
    await store.reload();
    paint();
    api.refresh();
  }
}

function openCatEditor(id, kind, api, onDone){
  const c = id ? store.cat(id) : null;
  const draft = c ? { ...c } : { name: '', icon: '📦', color: CAT_COLORS[0], kind, sortOrder: nextSortOrder(store.cats(kind)), isSystem: 0 };
  const el = api.sheet.open(
    '<div class="sheet-head"><h3>' + (c ? '编辑分类' : '新增' + (kind === 'expense' ? '支出' : '收入') + '分类') + '</h3></div>' +
    '<div style="padding:12px 16px">' +
      '<div class="tiny muted">名称</div><input id="nName" type="text" value="' + escapeHtml(draft.name) + '" placeholder="例如 宠物" style="margin-top:6px">' +
      '<div style="margin-top:12px"><div class="tiny muted">图标（可在下面方框里直接输入任意字符）</div>' +
        '<input id="nIcon" type="text" value="' + escapeHtml(draft.icon) + '" style="margin-top:6px;width:80px;text-align:center">' +
        '<div class="chips" style="margin-top:8px" data-role="icons">' +
          CAT_ICONS.map(i => '<div class="chip" data-i="' + i + '" style="font-size:17px;padding:5px 11px">' + i + '</div>').join('') +
        '</div></div>' +
      '<div style="margin-top:12px"><div class="tiny muted">颜色（用于饼图和排行）</div>' +
        '<div class="chips" style="margin-top:6px" data-role="colors">' +
          CAT_COLORS.map(col => '<div class="chip" data-c="' + col + '" style="background:' + col + ';width:32px;height:32px;border-radius:50%;padding:0"></div>').join('') +
        '</div></div>' +
      '<button class="btn primary block lg" id="nSave" style="margin-top:16px">保存</button>' +
    '</div>');

  el.addEventListener('click', e => {
    const i = e.target.closest('[data-i]');
    if (i) { el.querySelector('#nIcon').value = i.dataset.i; return; }
    const c2 = e.target.closest('[data-c]');
    if (c2) { draft.color = c2.dataset.c; [...c2.parentElement.children].forEach(x => x.style.outline = 'none'); c2.style.outline = '2px solid #1b1b1f'; }
  });

  el.querySelector('#nSave').addEventListener('click', async () => {
    draft.name = el.querySelector('#nName').value.trim();
    draft.icon = el.querySelector('#nIcon').value.trim() || '📦';
    if (!draft.name) { toast('请填分类名称'); return; }
    try {
      await store.saveCategory(draft);
      await store.reload();
      toast('已保存');
      replay.step('保存分类 ' + draft.name);
      api.sheet.close();
      api.refresh();
      if (onDone) onDone();
    } catch (err) {
      logger.error('category save failed: ' + err.message, 'settings');
      toast('保存失败：' + err.message);
    }
  });
}

export function renderBackupSheet(api){
  const el = api.sheet.open(
    '<div class="sheet-head"><h3>备份与恢复</h3></div>' +
    '<div style="padding:12px 16px">' +
      '<div class="small muted">当前状态：<b>' + backupDays() + '</b>' +
        (store.lastBackupAt ? '<br><span class="tiny">上次：' + fmtDateTime(store.lastBackupAt) + '</span>' : '') + '</div>' +
      '<div class="card" style="margin:10px 0 0;background:#fbf7ec">' +
        '<div class="tiny">这个 App 不联网、没有云同步。手机丢了、清了缓存，数据就找不回来了。' +
        '导出的 JSON 文件请自己转存到电脑或网盘 —— 它是你唯一的后悔药。</div>' +
      '</div>' +
      '<button class="btn primary block lg" data-act="json" style="margin-top:12px">导出完整备份（JSON，可恢复）</button>' +
      '<button class="btn block lg" data-act="csv" style="margin-top:8px">导出明细（CSV，Excel 可看）</button>' +
      '<button class="btn block lg" data-act="import" style="margin-top:8px">从 JSON 备份恢复</button>' +
      '<div class="tiny muted center" style="margin-top:10px">恢复会覆盖同 ID 的旧数据，不会清库</div>' +
    '</div>');

  el.addEventListener('click', async e => {
    const hit = e.target.closest('[data-act]');
    if (!hit) return;
    if (hit.dataset.act === 'json') {
      try {
        const data = await repo.exportAll();
        downloadFile('记账备份-' + fmtDateTime(Date.now()).slice(0, 10) + '.json', JSON.stringify(data, null, 2), 'application/json');
        await store.touchBackupStamp();
        toast('已导出备份');
        replay.step('导出 JSON 备份');
        api.sheet.close();
        api.refresh();
      } catch (err) {
        logger.error('export json failed: ' + err.message, 'backup');
        toast('导出失败：' + err.message);
      }
    } else if (hit.dataset.act === 'csv') {
      try {
        const rows = [['日期', '类型', '分类', '转出账户', '转入账户', '金额(元)', '备注']];
        const typeName = { expense: '支出', income: '收入', transfer: '转账' };
        for (const t of store.transactions.slice().sort((a, b) => a.occurredAt - b.occurredAt)) {
          const c = store.cat(t.categoryId);
          rows.push([
            fmtDateTime(t.occurredAt),
            typeName[t.type] || t.type,
            t.type === 'transfer' ? '' : (c ? c.name : '未分类'),
            (store.acc(t.accountId) || {}).name || '',
            t.type === 'transfer' ? ((store.acc(t.toAccountId) || {}).name || '') : '',
            (t.type === 'expense' ? '-' : '') + (t.amountCents / 100).toFixed(2),
            t.note || ''
          ]);
        }
        const csv = '\ufeff' + rows.map(r => r.map(cell => '"' + String(cell).replace(/"/g, '""') + '"').join(',')).join('\r\n');
        downloadFile('记账明细-' + fmtDateTime(Date.now()).slice(0, 10) + '.csv', csv, 'text/csv');
        toast('已导出 CSV');
        replay.step('导出 CSV');
      } catch (err) {
        logger.error('export csv failed: ' + err.message, 'backup');
        toast('导出失败：' + err.message);
      }
    } else if (hit.dataset.act === 'import') {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.json,application/json';
      input.addEventListener('change', async () => {
        const f = input.files && input.files[0];
        if (!f) return;
        try {
          const text = await f.text();
          const data = JSON.parse(text);
          await repo.importAll(data);
          await store.reload();
          toast('已恢复 ' + store.transactions.length + ' 条记录');
          replay.step('导入备份恢复');
          api.sheet.close();
          api.refresh();
        } catch (err) {
          logger.error('import failed: ' + err.message, 'backup');
          toast('导入失败：' + err.message);
        }
      });
      input.click();
    }
  });
}

export function renderDemoSheet(api){
  const el = api.sheet.open(
    '<div class="sheet-head"><h3>演示数据</h3></div>' +
    '<div style="padding:12px 16px">' +
      '<div class="small muted">生成最近 4 个月的模拟账目，用来看统计、趋势、同比环比长什么样。' +
        '每笔都带 demo 标记，可以一键清掉，不会和你自己记的账混淆。</div>' +
      '<button class="btn primary block lg" data-act="gen" style="margin-top:12px">生成 / 重新生成演示数据</button>' +
      '<button class="btn block lg danger" data-act="clear" style="margin-top:8px">清空演示数据</button>' +
      '<div class="tiny muted center" style="margin-top:10px">清空只删演示数据，你自己记的账不受影响</div>' +
    '</div>');

  el.addEventListener('click', async e => {
    const hit = e.target.closest('[data-act]');
    if (!hit) return;
    try {
      if (hit.dataset.act === 'gen') {
        const n = await seedDemoData();
        await store.reload();
        toast('已生成 ' + n + ' 笔演示数据');
        replay.step('生成演示数据 ' + n + ' 笔');
        api.sheet.close();
        api.refresh();
      } else if (hit.dataset.act === 'clear') {
        const n = await clearDemoData();
        await store.reload();
        toast(n ? '已清空 ' + n + ' 笔演示数据' : '没有演示数据');
        replay.step('清空演示数据 ' + n + ' 笔');
        api.sheet.close();
        api.refresh();
      }
    } catch (err) {
      logger.error('demo data failed: ' + err.message, 'seed');
      toast('操作失败：' + err.message);
    }
  });
}

export async function render(root, api){
  let taps = 0;
  let tapTimer = null;
  const lock = await lockInfo();
  const demos = await demoCount();
  const persist = await persistState();

  root.innerHTML = '<header class="bar"><h1>我的</h1></header>' +
    '<div class="card tight" style="margin:6px 12px 0">' +
      row('预算管理', '月度总预算 + 分类预算', { act: 'budget', text: '设置 ›' }) +
      row('分类管理', '新增自定义分类、改图标、排序', { act: 'cats', text: '管理 ›' }) +
      row('账户管理', '现金 / 银行卡 / 支付宝 / 微信', { act: 'accounts', text: '管理 ›' }) +
    '</div>' +
    '<div class="card tight" style="margin:10px 12px 0">' +
      row('应用锁', '4-6 位数字密码，打开 App 时校验', {
        act: 'lock', text: lock.enabled ? '已开启 ›' : '未开启 ›'
      }) +
      row('存储保护', persist === 'off' ? '防止浏览器自动清理数据' : '浏览器不会自动清理你的账目', { act: 'persist', text: persistText(persist) }) +
      row('备份与恢复', backupDays(), { act: 'backup', text: '导出 ›' }) +
      row('演示数据', demos ? '当前有 ' + demos + ' 笔演示记录' : '生成一批假数据看效果', { act: 'demo', text: '管理 ›' }) +
      row('诊断与反馈', '一键生成问题报告发给我', { act: 'diag', text: '打开 ›' }) +
    '</div>' +
    '<div class="card tight" style="margin:10px 12px 0">' +
      row('清空全部数据', '会连同设置一起删除，请先备份', { act: 'wipe', text: '' }) +
    '</div>' +
    '<div class="center small muted" style="padding:16px">' +
      '个人记账 · v0.1.0 (build ' + APP_BUILD + ')<br>' +
      '<span class="tiny">数据全部留在本机，本 App 不申请联网权限</span>' +
      '<div style="margin-top:8px"><span id="verTap" class="tiny muted" style="padding:4px 10px;border:0.5px solid var(--line);border-radius:8px">关于</span></div>' +
    '</div>';

  root.addEventListener('click', async e => {
    const hit = e.target.closest('[data-act]');
    if (hit) {
      const act = hit.dataset.act;
      if (act === 'budget') renderBudgetSheet(api);
      else if (act === 'cats') renderCategorySheet(api, 'expense');
      else if (act === 'accounts') api.go('accounts');
      else if (act === 'lock') openLockSetup(api);
      else if (act === 'persist') {
        try {
          if (!navigator.storage || !navigator.storage.persist) {
            toast('这个浏览器不支持，打包成 APK 后不受影响');
            return;
          }
          let got = await navigator.storage.persisted();
          if (!got) got = await navigator.storage.persist();
          logger.info('persist request: ' + (got ? 'granted' : 'denied'), 'storage');
          replay.step('申请存储持久化 ' + (got ? '成功' : '被拒'));
          toast(got ? '已保护：浏览器不会再自动清理你的数据'
                    : '被拒绝了（常见于没把页面加到主屏幕）。定期导出备份，或打包成 APK');
          api.refresh();
        } catch (err) {
          toast('申请失败：' + err.message);
        }
      }
      else if (act === 'demo') renderDemoSheet(api);
      else if (act === 'backup') renderBackupSheet(api);
      else if (act === 'diag') openDiagnostics(api);
      else if (act === 'wipe') {
        if (!await api.confirm('确定清空全部数据？这会删掉所有账户、分类和流水，且无法撤销。建议先导出备份。')) return;
        try {
          await repo.wipe();
          await store.reload();
          toast('已清空');
          api.refresh();
        } catch (err) {
          toast('清空失败：' + err.message);
        }
      }
      return;
    }
    if (e.target.closest('#verTap')) {
      taps++;
      clearTimeout(tapTimer);
      tapTimer = setTimeout(() => { taps = 0; }, 1200);
      if (taps >= 3) { taps = 0; openDiagnostics(api); }
    }
  });
}

export function cleanup(){}
