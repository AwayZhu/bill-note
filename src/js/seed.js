import { repo } from './repository.js';
import { uid } from './util.js';
import { logger } from './logger.js';

const DEFAULT_ACCOUNTS = [
  { name: '现金', type: 'cash', icon: '💵' },
  { name: '储蓄卡', type: 'debit', icon: '🏦' },
  { name: '信用卡', type: 'credit', icon: '💳' },
  { name: '支付宝', type: 'virtual', icon: '🅰️' },
  { name: '微信', type: 'virtual', icon: '💬' }
];

const EXPENSE_CATS = [
  { name: '餐饮', icon: '🍜' },
  { name: '交通', icon: '🚌' },
  { name: '购物', icon: '🛍️' },
  { name: '居住', icon: '🏠' },
  { name: '娱乐', icon: '🎮' },
  { name: '医疗', icon: '💊' },
  { name: '教育', icon: '📚' },
  { name: '通讯', icon: '📱' },
  { name: '人情', icon: '🎁' },
  { name: '日用', icon: '🧴' },
  { name: '旅行', icon: '✈️' },
  { name: '其他', icon: '📦' }
];

const INCOME_CATS = [
  { name: '工资', icon: '💰' },
  { name: '奖金', icon: '🏆' },
  { name: '兼职', icon: '💼' },
  { name: '理财', icon: '📈' },
  { name: '红包', icon: '🧧' },
  { name: '退款', icon: '↩️' },
  { name: '其他', icon: '✨' }
];

export const ACCOUNT_TYPES = [
  { key: 'cash', label: '现金' },
  { key: 'debit', label: '储蓄卡' },
  { key: 'credit', label: '信用卡' },
  { key: 'virtual', label: '支付宝/微信' }
];

const PALETTE = ['#e0524a', '#e08a1e', '#3a7bd5', '#1f9d63', '#8b5cf6', '#d94684', '#0ea5a5', '#7c6a3a'];

export async function ensureSeed(){
  const seeded = await repo.meta('seeded', false);
  if (seeded) return false;

  let order = 0;
  for (const a of DEFAULT_ACCOUNTS) {
    await repo.putAccount({
      id: uid(), name: a.name, type: a.type, icon: a.icon,
      initialBalanceCents: 0, sortOrder: order++, createdAt: Date.now(), deletedAt: null
    });
  }

  order = 0;
  for (const c of EXPENSE_CATS) {
    await repo.putCategory({
      id: uid(), name: c.name, icon: c.icon, kind: 'expense',
      color: PALETTE[order % PALETTE.length], sortOrder: order++, isSystem: 1, createdAt: Date.now(), deletedAt: null
    });
  }
  order = 0;
  for (const c of INCOME_CATS) {
    await repo.putCategory({
      id: uid(), name: c.name, icon: c.icon, kind: 'income',
      color: PALETTE[(order + 2) % PALETTE.length], sortOrder: order++, isSystem: 1, createdAt: Date.now(), deletedAt: null
    });
  }

  await repo.setMeta('seeded', true);
  await repo.setMeta('settings', { currency: '¥', firstDayOfMonth: 1 });
  logger.info('seed done', 'seed');
  return true;
}

export function nextSortOrder(list){
  if (!list || !list.length) return 0;
  return Math.max(...list.map(x => x.sortOrder || 0)) + 1;
}

/* ---------------- 演示数据 ----------------
   目的：让统计/趋势/同比环比这些页面有东西可看，方便验收布局。
   每一笔都带 demo:1 标记，可以一键清掉，不会和真实账目混在一起。      */

// 固定种子的伪随机，保证每次生成的演示数据大致一致，便于对照
function rng(seed){
  let s = seed >>> 0;
  return function(){
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const DEMO_PLAN = [
  { cat: '餐饮', n: [18, 24], min: 1200, max: 8800 },
  { cat: '交通', n: [8, 12], min: 300, max: 3500 },
  { cat: '购物', n: [4, 7], min: 3900, max: 39900 },
  { cat: '居住', n: [1, 1], min: 280000, max: 280000 },
  { cat: '娱乐', n: [2, 4], min: 3000, max: 19800 },
  { cat: '日用', n: [2, 4], min: 1500, max: 9900 },
  { cat: '通讯', n: [1, 1], min: 9900, max: 9900 },
  { cat: '医疗', n: [0, 1], min: 2000, max: 26000 },
  { cat: '人情', n: [0, 2], min: 20000, max: 60000 }
];

const DEMO_NOTES = {
  '餐饮': ['午饭', '早饭', '外卖', '咖啡', '晚饭', '便利店'],
  '交通': ['地铁', '打车', '公交', '加油'],
  '购物': ['日用品', '衣服', '数码配件', '超市'],
  '居住': ['房租'],
  '娱乐': ['电影', '游戏', '演出'],
  '日用': ['纸巾洗衣液', '家居小物'],
  '通讯': ['话费'],
  '医疗': ['感冒药', '门诊'],
  '人情': ['随礼', '生日礼物']
};

export async function seedDemoData(){
  const r = rng(20260910);
  const cats = await repo.categories();
  const accounts = await repo.accounts();
  if (!cats.length || !accounts.length) return 0;

  const cash = accounts.find(a => a.type === 'cash');
  const debit = accounts.find(a => a.type === 'debit') || accounts[0];
  const ali = accounts.find(a => a.name.indexOf('支付宝') >= 0);
  const wx = accounts.find(a => a.name.indexOf('微信') >= 0);
  const credit = accounts.find(a => a.type === 'credit');
  const payAcc = ali || wx || debit;

  // 让账户页有得看
  const init = { [debit.id]: 2000000 };
  if (ali) init[ali.id] = 150000;
  if (wx) init[wx.id] = 80000;
  if (cash) init[cash.id] = 30000;
  for (const a of accounts) {
    if (init[a.id] != null) {
      a.initialBalanceCents = init[a.id];
      await repo.putAccount(a);
    }
  }

  const now = new Date();
  let made = 0;
  const BUDGET_PER_MONTH = 500000; // 5000 元

  for (let mi = 3; mi >= 0; mi--) {
    const base = new Date(now.getFullYear(), now.getMonth() - mi, 1);
    const y = base.getFullYear();
    const m = base.getMonth();
    const daysInMonth = new Date(y, m + 1, 0).getDate();
    const maxDay = mi === 0 ? now.getDate() : daysInMonth;

    const push = async (t) => {
      await repo.putTransaction(Object.assign({
        id: uid(), note: '', toAccountId: null, categoryId: null,
        createdAt: Date.now(), updatedAt: Date.now(), deletedAt: null,
        schemaVersion: 1, demo: 1
      }, t));
      made++;
    };

    // 工资
    const salaryCat = cats.find(c => c.kind === 'income' && c.name === '工资');
    const payDay = Math.min(10, maxDay);
    await push({
      type: 'income', amountCents: 1280000 + Math.floor(r() * 4) * 10000,
      accountId: debit.id, categoryId: salaryCat ? salaryCat.id : null,
      note: '工资', occurredAt: new Date(y, m, payDay, 10, 30, 0, 0).getTime()
    });

    // 支出
    for (const p of DEMO_PLAN) {
      const c = cats.find(x => x.kind === 'expense' && x.name === p.cat);
      if (!c) continue;
      const n = p.n[0] + Math.floor(r() * (p.n[1] - p.n[0] + 1));
      for (let i = 0; i < n; i++) {
        const day = 1 + Math.floor(r() * maxDay);
        const cents = p.min + Math.floor(r() * (p.max - p.min + 1));
        const notes = DEMO_NOTES[p.cat] || [''];
        const acc = (p.cat === '居住') ? debit.id : (r() < 0.62 ? payAcc.id : (credit ? credit.id : payAcc.id));
        const ts = new Date(y, m, day, 7 + Math.floor(r() * 14), Math.floor(r() * 60), 0, 0).getTime();
        if (ts > Date.now()) continue;
        await push({
          type: 'expense', amountCents: cents, accountId: acc, categoryId: c.id,
          note: notes[Math.floor(r() * notes.length)], occurredAt: ts
        });
      }
    }

    // 转账：银行卡 → 支付宝/微信
    if (ali || wx) {
      const day = Math.min(5, maxDay);
      await push({
        type: 'transfer', amountCents: 200000, accountId: debit.id,
        toAccountId: (ali || wx).id, note: '转到零钱',
        occurredAt: new Date(y, m, day, 9, 0, 0, 0).getTime()
      });
    }

    // 演示预算（只给当月和过去三月，方便看超支/未超支两种状态）
    const key = y + '-' + String(m + 1).padStart(2, '0');
    await repo.putBudget({
      id: 'demo-budget-' + key, key: key + '|__total__', month: key,
      categoryId: null, limitCents: BUDGET_PER_MONTH, demo: 1
    });
  }

  logger.info('demo data seeded: ' + made + ' tx', 'seed');
  return made;
}

export async function clearDemoData(){
  const all = await repo.transactionsRaw();
  let n = 0;
  for (const t of all) {
    if (!t.demo) continue;
    t.deletedAt = Date.now();
    await repo.putTransaction(t);
    n++;
  }
  const budgets = await repo.budgets();
  for (const b of budgets) {
    if (b.demo) { await repo.delBudget(b.id); }
  }
  logger.info('demo data cleared: ' + n + ' tx', 'seed');
  return n;
}

export async function demoCount(){
  const all = await repo.transactionsRaw();
  return all.filter(t => t.demo && !t.deletedAt).length;
}
