import { repo } from './repository.js';
import { logger, replay } from './logger.js';

const META_KEY = 'lock';
const IDLE_MS = 60 * 1000;   // 切到后台超过 60 秒再回来要重新解锁
const MAX_FAIL = 5;

// 是否已解锁（本次会话内有效）
let unlocked = !false;
let lastHiddenAt = 0;
let cfgCache = null;

function makeSalt(){
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

// 优先用 SHA-256；但 http 局域网预览不是安全上下文，crypto.subtle 不可用，
// 这时退化为 FNV-1a（不具备密码学强度，只防随手翻看，不防专业提取）。
async function hashPin(pin, salt){
  const raw = String(pin) + '|' + salt;
  if (typeof crypto !== 'undefined' && crypto.subtle && crypto.subtle.digest && typeof TextEncoder !== 'undefined') {
    try {
      const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
      return 'sha256:' + Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
    } catch (e) { /* 退化到下面的简单哈希 */ }
  }
  let h = 2166136261;
  for (let i = 0; i < raw.length; i++) {
    h ^= raw.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return 'fnv1a:' + h.toString(16);
}

async function readCfg(){
  if (cfgCache) return cfgCache;
  cfgCache = await repo.meta(META_KEY, null);
  return cfgCache;
}

async function writeCfg(cfg){
  cfgCache = cfg;
  await repo.setMeta(META_KEY, cfg);
  return cfg;
}

export async function lockInfo(){
  const cfg = await readCfg();
  if (!cfg || !cfg.enabled) return { enabled: false, strong: false };
  return { enabled: true, strong: String(cfg.hash || '').startsWith('sha256:'), since: cfg.since || null };
}

export async function setPin(pin){
  const salt = makeSalt();
  const hash = await hashPin(pin, salt);
  return writeCfg({ enabled: true, salt, hash, since: Date.now(), fails: 0 });
}

export async function clearPin(){
  return writeCfg({ enabled: false, salt: '', hash: '', since: null, fails: 0 });
}

export async function verifyPin(pin){
  const cfg = await readCfg();
  if (!cfg || !cfg.enabled) return true;
  return (await hashPin(pin, cfg.salt)) === cfg.hash;
}

export function isUnlocked(){ return unlocked; }
export function lockNow(){ unlocked = false; }

export function maybeLockOnForeground(){
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { lastHiddenAt = Date.now(); return; }
    if (lastHiddenAt && Date.now() - lastHiddenAt >= IDLE_MS) {
      unlocked = false;
      showLockScreen(currentApi);
    }
  });
}

let currentApi = null;
let lockEl = null;

function lockHtml(state, extra){
  const dots = [0, 1, 2, 3, 4, 5].map(i =>
    '<i class="' + (i < state.len ? 'on' : '') + '"></i>').join('');
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '清空', '0', '⌫'];
  return '<div class="lock-wrap">' +
    '<div class="lock-title">' + (state.title || '请输入密码') + '</div>' +
    '<div class="lock-dots">' + dots + '</div>' +
    (extra ? '<div class="lock-msg">' + extra + '</div>' : '<div class="lock-msg muted"></div>') +
    '<div class="lock-pad">' + keys.map(k =>
      '<button data-k="' + k + '"' + ((k === '清空' || k === '⌫') ? ' class="fn"' : '') + '>' + k + '</button>'
    ).join('') + '</div>' +
    (state.canReset ? '<button class="lock-forgot" id="lockForgot">忘了密码？清空数据重新设置</button>' : '') +
  '</div>';
}

async function doVerify(pin){
  const ok = await verifyPin(pin);
  const cfg = await readCfg();
  if (ok) {
    unlocked = true;
    if (cfg) { cfg.fails = 0; await writeCfg(cfg); }
    logger.info('lock: unlocked', 'lock');
    replay.step('解锁成功');
    closeLock();
    if (currentApi && currentApi.refresh) await currentApi.refresh();
    return true;
  }
  if (cfg) { cfg.fails = (cfg.fails || 0) + 1; await writeCfg(cfg); }
  logger.warn('lock: wrong pin', 'lock');
  return false;
}

function closeLock(){
  if (lockEl) { lockEl.remove(); lockEl = null; }
}

async function showLockScreen(api){
  if (api) currentApi = api;
  const info = await lockInfo();
  if (!info.enabled || unlocked) return;
  if (lockEl) return;

  closeLock();
  lockEl = document.createElement('div');
  lockEl.className = 'lock-screen';
  document.body.appendChild(lockEl);

  const state = { len: 0, buf: '', title: '请输入密码', canReset: false };
  let fails = ((await readCfg()) || {}).fails || 0;

  const paint = (msg) => {
    lockEl.innerHTML = lockHtml(state, msg);
    if (state.canReset) {
      lockEl.querySelector('#lockForgot').addEventListener('click', async () => {
        if (!currentApi) return;
        const ok = await currentApi.confirm('清空全部数据并关闭应用锁？所有账目会被删除，无法恢复。如果之前导出过备份，清完后可以从备份恢复。');
        if (!ok) return;
        try {
          const { repo } = await import('./repository.js');
          await repo.wipe();
          await clearPin();
          unlocked = true;
          closeLock();
          if (currentApi.refresh) await currentApi.refresh();
        } catch (e) {
          logger.error('lock reset failed: ' + e.message, 'lock');
        }
      });
    }
  };

  paint(fails > 0 ? '密码不对，已错 ' + fails + ' 次' : '');

  lockEl.addEventListener('click', async e => {
    const b = e.target.closest('[data-k]');
    if (!b) return;
    const k = b.dataset.k;
    if (k === '⌫') { state.buf = state.buf.slice(0, -1); }
    else if (k === '清空') { state.buf = ''; }
    else {
      if (state.buf.length >= 6) return;
      state.buf += k;
    }
    state.len = state.buf.length;
    paint('');
    if (state.buf.length >= 4) {
      const ok = await doVerify(state.buf);
      if (!ok) {
        fails++;
        state.buf = '';
        state.len = 0;
        state.canReset = fails >= MAX_FAIL;
        paint('密码不对，已错 ' + fails + ' 次' + (state.canReset ? '。可以用下面的按钮重置' : ''));
      }
    }
  });
}

export function openLockSetup(api){
  currentApi = api;
  const el = api.sheet.open(
    '<div class="sheet-head"><h3>应用锁</h3></div>' +
    '<div style="padding:12px 16px">' +
      '<div class="tiny muted">设置 4-6 位数字密码。开启后，打开 App、或切到后台超过 1 分钟再回来，都需要输入密码。</div>' +
      '<input id="p1" type="tel" inputmode="numeric" maxlength="6" placeholder="新密码（4-6 位数字）" style="margin-top:12px;letter-spacing:6px;text-align:center">' +
      '<input id="p2" type="tel" inputmode="numeric" maxlength="6" placeholder="再输一次" style="margin-top:8px;letter-spacing:6px;text-align:center">' +
      '<button class="btn primary block lg" id="pSave" style="margin-top:16px">开启应用锁</button>' +
      '<button class="btn block lg danger" id="pOff" style="margin-top:8px">关闭应用锁</button>' +
      '<div class="tiny muted center" style="margin-top:12px">密码只存在本机，没有任何找回方式。<br>忘了只能清空数据重来，所以务必先导出一次备份。</div>' +
    '</div>');

  el.querySelector('#pSave').addEventListener('click', async () => {
    const a = el.querySelector('#p1').value.trim();
    const b = el.querySelector('#p2').value.trim();
    if (!/^\d{4,6}$/.test(a)) { api.sheet.close(); return; }
    if (a !== b) { el.querySelector('#p2').value = ''; el.querySelector('#p2').placeholder = '两次不一致，重输'; return; }
    await setPin(a);
    unlocked = true;
    logger.info('lock: enabled', 'lock');
    api.sheet.close();
    api.refresh();
  });

  el.querySelector('#pOff').addEventListener('click', async () => {
    await clearPin();
    unlocked = true;
    logger.info('lock: disabled', 'lock');
    api.sheet.close();
    api.refresh();
  });
}

export async function installLock(api){
  currentApi = api;
  const info = await lockInfo();
  if (!info.enabled) { unlocked = true; return false; }
  unlocked = false;
  await showLockScreen(api);
  return true;
}

export { showLockScreen };
