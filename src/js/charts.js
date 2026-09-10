import { fmtCents, fmtCentsShort } from './util.js';

function prep(canvas, height){
  const dpr = window.devicePixelRatio || 1;
  const cssW = canvas.clientWidth || 320;
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(height * dpr);
  canvas.style.height = height + 'px';
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, height);
  return { ctx, w: cssW, h: height };
}

export function pie(canvas, rows){
  const size = 200;
  const { ctx, w, h } = prep(canvas, size);
  const total = rows.reduce((a, r) => a + r.cents, 0);
  const cx = w / 2, cy = h / 2;
  const outer = Math.min(w, h) / 2 - 6;
  const inner = outer * 0.58;

  ctx.strokeStyle = '#e8e8ed';
  ctx.beginPath();
  ctx.arc(cx, cy, outer, 0, Math.PI * 2);
  ctx.stroke();

  if (total <= 0) {
    ctx.fillStyle = '#b0b0b8';
    ctx.font = '13px -apple-system,"PingFang SC",sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('本月还没有支出', cx, cy);
    return;
  }

  let start = -Math.PI / 2;
  for (const r of rows) {
    const angle = (r.cents / total) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, outer, start, start + angle);
    ctx.closePath();
    ctx.fillStyle = r.color || '#888780';
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    start += angle;
  }

  ctx.globalCompositeOperation = 'destination-out';
  ctx.beginPath();
  ctx.arc(cx, cy, inner, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalCompositeOperation = 'source-over';

  ctx.fillStyle = '#1b1b1f';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '600 13px -apple-system,"PingFang SC",sans-serif';
  ctx.fillText('合计', cx, cy - 12);
  ctx.font = '600 17px -apple-system,"PingFang SC",sans-serif';
  ctx.fillText(fmtCents(total), cx, cy + 7);
}

export function bars(canvas, rows, opts){
  const o = opts || {};
  const height = o.height || 160;
  const { ctx, w, h } = prep(canvas, height);
  const padL = 8, padR = 8, padT = 16, padB = 22;
  const plotW = w - padL - padR;
  const plotH = h - padT - padB;
  const max = Math.max(1, ...rows.map(r => r.value));
  const step = plotW / rows.length;
  const bw = Math.min(26, step * 0.55);

  ctx.strokeStyle = '#ececf1';
  ctx.beginPath();
  ctx.moveTo(padL, padT + plotH + 0.5);
  ctx.lineTo(padL + plotW, padT + plotH + 0.5);
  ctx.stroke();

  rows.forEach((r, i) => {
    const x = padL + step * i + step / 2;
    const bh = r.value > 0 ? Math.max(2, (r.value / max) * plotH) : 0;
    const y = padT + plotH - bh;
    ctx.fillStyle = (o.picked === i) ? (o.activeColor || '#2f6fed') : (o.color || '#9fbcf5');
    const rx = Math.min(4, bw / 2);
    roundRect(ctx, x - bw / 2, y, bw, bh, rx);
    ctx.fill();
    ctx.fillStyle = '#8a8a92';
    ctx.font = '10px -apple-system,"PingFang SC",sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(r.label, x, padT + plotH + 5);
    if (r.value > 0 && (o.showValue !== false)) {
      ctx.fillStyle = '#8a8a92';
      ctx.font = '9px -apple-system,"PingFang SC",sans-serif';
      ctx.textBaseline = 'bottom';
      ctx.fillText(fmtCentsShort(r.value), x, y - 2);
    }
  });
}

function roundRect(ctx, x, y, w, h, r){
  if (h <= 0) return;
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
  ctx.lineTo(x + w, y + h);
  ctx.lineTo(x, y + h);
  ctx.lineTo(x, y + rr);
  ctx.quadraticCurveTo(x, y, x + rr, y);
  ctx.closePath();
}
