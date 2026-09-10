export function uid(){
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

export function parseAmountToCents(s){
  if (s === '' || s == null) return 0;
  const m = String(s).match(/^(\d*)(?:\.(\d{0,2}))?$/);
  if (!m) return 0;
  const int = m[1] || '0';
  const frac = (m[2] || '').padEnd(2, '0');
  return parseInt(int, 10) * 100 + parseInt(frac || '0', 10);
}

export function fmtCents(cents){
  const neg = cents < 0;
  const c = Math.abs(Math.round(cents || 0));
  const yuan = Math.floor(c / 100);
  const frac = c % 100;
  const s = yuan.toLocaleString('zh-CN') + '.' + String(frac).padStart(2, '0');
  return (neg ? '-' : '') + s;
}

export function fmtCentsShort(cents){
  const c = Math.abs(Math.round(cents || 0));
  return c >= 1000000 ? (c / 1000000).toFixed(1) + '万' : fmtCents(cents);
}

export function monthKey(ts){
  const d = ts == null ? new Date() : new Date(ts);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}

export function monthRange(key){
  const parts = String(key).split('-').map(Number);
  const y = parts[0], m = parts[1];
  const start = new Date(y, m - 1, 1, 0, 0, 0, 0).getTime();
  const end = new Date(y, m, 1, 0, 0, 0, 0).getTime();
  return { start, end };
}

export function shiftMonth(key, delta){
  const parts = String(key).split('-').map(Number);
  const d = new Date(parts[0], parts[1] - 1 + delta, 1);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}

export function monthLabel(key){
  const parts = String(key).split('-').map(Number);
  return parts[0] + '年' + parts[1] + '月';
}

export function dayKey(ts){
  const d = new Date(ts);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

const WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

export function fmtDayHead(ts){
  const d = new Date(ts);
  const today = new Date();
  const sameYear = d.getFullYear() === today.getFullYear();
  let head = sameYear ? (d.getMonth() + 1) + '月' + d.getDate() + '日' : d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日';
  if (dayKey(ts) === dayKey(today.getTime())) head = '今天';
  else if (dayKey(ts) === dayKey(today.getTime() - 86400000)) head = '昨天';
  return head + ' ' + WEEK[d.getDay()];
}

export function fmtTime(ts){
  const d = new Date(ts);
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}

export function fmtDateTime(ts){
  const d = new Date(ts);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') +
    ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0') + ':' + String(d.getSeconds()).padStart(2, '0');
}

export function dateInputValue(ts){
  const d = new Date(ts);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

export function dateFromInput(v){
  const parts = String(v).split('-').map(Number);
  if (parts.length !== 3) return Date.now();
  const now = new Date();
  return new Date(parts[0], parts[1] - 1, parts[2], now.getHours(), now.getMinutes(), now.getSeconds(), 0).getTime();
}

export function daysBetween(ts, now){
  if (!ts) return null;
  return Math.floor((now - ts) / 86400000);
}

export function escapeHtml(s){
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

let toastTimer = null;
export function toast(msg, ms){
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('on'), ms || 1800);
}

export function downloadFile(filename, content, mime){
  const blob = new Blob([content], { type: (mime || 'text/plain') + ';charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
    a.remove();
  }, 200);
}

export async function copyText(text){
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (e) { /* fall through */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'absolute';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch (e) {
    return false;
  }
}

export function sumCents(list){
  return list.reduce((acc, x) => acc + (x || 0), 0);
}
