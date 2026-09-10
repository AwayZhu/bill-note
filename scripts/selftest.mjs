import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'src', 'js');

let pass = 0;
const failures = [];

function ok(name){
  pass++;
  console.log('  通过  ' + name);
}
function bad(name, detail){
  failures.push(name + ' :: ' + detail);
  console.log('  失败  ' + name + '  ' + detail);
}
function eq(name, got, want){
  if (got === want) ok(name + ' = ' + JSON.stringify(got));
  else bad(name, 'got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want));
}

function walk(dir, acc = []){
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, acc);
    else if (e.name.endsWith('.js')) acc.push(p);
  }
  return acc;
}

function exportsOf(src){
  const names = new Set();
  let m;
  const re1 = /export\s+(?:async\s+)?(?:function|const|let|var|class)\s+([A-Za-z0-9_$]+)/g;
  while ((m = re1.exec(src))) names.add(m[1]);
  const re2 = /export\s*\{([^}]+)\}/g;
  while ((m = re2.exec(src))) {
    m[1].split(',').forEach(s => {
      const t = s.trim();
      if (!t) return;
      const parts = t.split(/\s+as\s+/);
      names.add((parts[1] || parts[0]).trim());
    });
  }
  return names;
}

function importsOf(src){
  const out = [];
  const re = /import\s+([^;]*?)\s+from\s+['"]([^'"]+)['"]/g;
  let m;
  while ((m = re.exec(src))) {
    const clause = m[1];
    const named = [];
    const brace = clause.match(/\{([^}]*)\}/);
    if (brace) {
      brace[1].split(',').forEach(s => {
        const t = s.trim();
        if (!t) return;
        named.push(t.split(/\s+as\s+/)[0].trim());
      });
    }
    out.push({ spec: m[2], named, ns: /\*\s+as/.test(clause) });
  }
  return out;
}

console.log('');
console.log('=== 1. 模块引用检查 ===');

const files = walk(SRC);
if (!files.length) bad('找到源文件', 'src/js 下没有 .js 文件');
else ok('扫描到 ' + files.length + ' 个源文件');

const exportMap = new Map();
for (const f of files) exportMap.set(f, exportsOf(fs.readFileSync(f, 'utf8')));

let external = 0;
for (const f of files) {
  const rel = path.relative(ROOT, f).replace(/\\/g, '/');
  const src = fs.readFileSync(f, 'utf8');
  for (const imp of importsOf(src)) {
    if (!imp.spec.startsWith('.')) {
      external++;
      bad(rel + ' 引用外部依赖', imp.spec + ' —— 本项目要求零第三方依赖');
      continue;
    }
    const target = path.resolve(path.dirname(f), imp.spec);
    if (!fs.existsSync(target)) {
      bad(rel + ' 引用不存在的模块', imp.spec);
      continue;
    }
    if (imp.ns) continue;
    const avail = exportMap.get(target) || new Set();
    for (const n of imp.named) {
      if (!avail.has(n)) bad(rel + ' 导入了不存在的导出', n + ' <- ' + imp.spec);
    }
  }
}
if (external === 0) ok('零第三方依赖（不联网约束的一致性检查）');
ok('模块引用检查完成');

console.log('');
console.log('=== 2. 金额与日期核心逻辑实测 ===');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'money-selftest-'));
function prep(){
  for (const f of files) {
    const rel = path.relative(SRC, f);
    const dest = path.join(tmp, rel.replace(/\.js$/, '.mjs'));
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const rewritten = fs.readFileSync(f, 'utf8')
      .replace(/from\s+'(\.[^']*?)\.js'/g, "from '$1.mjs'")
      .replace(/from\s+"(\.[^"]*?)\.js"/g, 'from "$1.mjs"');
    fs.writeFileSync(dest, rewritten);
  }
}
prep();
const U = await import(pathToFileURL(path.join(tmp, 'util.mjs')).href);

eq('parse("12.5") 转分', U.parseAmountToCents('12.5'), 1250);
eq('parse("0.05") 转分', U.parseAmountToCents('0.05'), 5);
eq('parse("0.1") 转分', U.parseAmountToCents('0.1'), 10);
eq('parse("1234.56") 转分', U.parseAmountToCents('1234.56'), 123456);
eq('parse("7") 转分', U.parseAmountToCents('7'), 700);
eq('parse("") 转分', U.parseAmountToCents(''), 0);
eq('parse("abc") 非法输入', U.parseAmountToCents('abc'), 0);
eq('parse("1.234") 超过两位小数', U.parseAmountToCents('1.234'), 0);

eq('fmt(123456)', U.fmtCents(123456), '1,234.56');
eq('fmt(5)', U.fmtCents(5), '0.05');
eq('fmt(-5)', U.fmtCents(-5), '-0.05');
eq('fmt(0)', U.fmtCents(0), '0.00');
eq('fmt(100000000)', U.fmtCents(100000000), '1,000,000.00');

const fpSum = U.parseAmountToCents('0.1') + U.parseAmountToCents('0.2');
eq('浮点陷阱 0.1+0.2 用整数分计算', fpSum, 30);
if (U.fmtCents(fpSum) === '0.30') ok('0.1+0.2 显示为 0.30（不是 0.30000000000000004）');
else bad('浮点陷阱', '显示成了 ' + U.fmtCents(fpSum));

let acc = 0;
for (let i = 0; i < 100; i++) acc += U.parseAmountToCents('0.07');
eq('累加 100 次 0.07 元', U.fmtCents(acc), '7.00');

eq('monthKey(2026-09-10)', U.monthKey(new Date(2026, 8, 10).getTime()), '2026-09');
eq('monthKey(2026-01-01)', U.monthKey(new Date(2026, 0, 1).getTime()), '2026-01');
eq('shiftMonth(2026-01, -1) 跨年', U.shiftMonth('2026-01', -1), '2025-12');
eq('shiftMonth(2026-12, +1) 跨年', U.shiftMonth('2026-12', 1), '2027-01');
eq('shiftMonth(2026-09, -8)', U.shiftMonth('2026-09', -8), '2026-01');

const r = U.monthRange('2026-09');
const sd = new Date(r.start), ed = new Date(r.end);
eq('monthRange 起始月', sd.getMonth() + 1, 9);
eq('monthRange 起始日', sd.getDate(), 1);
eq('monthRange 结束月（不含）', ed.getMonth() + 1, 10);
if (r.end > r.start) ok('monthRange 区间有效（左闭右开）');
else bad('monthRange 区间', 'end <= start');

const boundary = U.monthKey(r.end - 1);
eq('月末最后一毫秒归属', boundary, '2026-09');
const nextDay = U.monthKey(r.end);
eq('次月第一天归属', nextDay, '2026-10');

const now = Date.now();
eq('daysBetween 同一时刻', U.daysBetween(now, now), 0);
eq('daysBetween 两天前', U.daysBetween(now - 2 * 86400000, now), 2);
eq('daysBetween 从未备份(null)', U.daysBetween(null, now), null);

fs.rmSync(tmp, { recursive: true, force: true });

console.log('');
console.log('=== 3. 交付物存在性检查 ===');
for (const rel of ['src/index.html', 'src/css/app.css', 'src/js/app.js', 'scripts/serve.py', 'scripts/start-preview.bat']) {
  if (fs.existsSync(path.join(ROOT, rel))) ok(rel + ' 存在');
  else bad(rel, '文件缺失');
}

const html = fs.readFileSync(path.join(ROOT, 'src/index.html'), 'utf8');
if (/INTERNET|https?:\/\//i.test(html)) bad('index.html 含外部资源', '与"不联网"约束冲突');
else ok('index.html 无外部资源引用（完全离线可用）');

const css = fs.readFileSync(path.join(ROOT, 'src/css/app.css'), 'utf8');
if (/@import|url\(\s*['"]?http/i.test(css)) bad('CSS 引用外部资源', '与"不联网"约束冲突');
else ok('CSS 无外部资源引用');

console.log('');
console.log('========================================');
if (failures.length) {
  console.log('  失败 ' + failures.length + ' 项，通过 ' + pass + ' 项');
  failures.forEach(f => console.log('   - ' + f));
  process.exit(1);
} else {
  console.log('  全部通过：' + pass + ' 项');
}
console.log('========================================');
console.log('');
