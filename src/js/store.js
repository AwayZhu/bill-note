import { repo } from './repository.js';
import { uid, monthRange as rangeOf, shiftMonth, monthKey } from './util.js';
import { logger } from './logger.js';

export const store = {
  accounts: [],
  categories: [],
  transactions: [],
  budgets: [],
  settings: { currency: '¥' },
  lastBackupAt: null,

  async reload(){
    const [accounts, categories, transactions, budgets, settings, lastBackupAt] = await Promise.all([
      repo.accounts(),
      repo.categories(),
      repo.transactions(),
      repo.budgets(),
      repo.meta('settings', { currency: '¥' }),
      repo.meta('lastBackupAt', null)
    ]);
    this.accounts = accounts;
    this.categories = categories;
    this.transactions = transactions;
    this.budgets = budgets;
    this.settings = settings;
    this.lastBackupAt = lastBackupAt;
    return this;
  },

  cat(id){ return this.categories.find(c => c.id === id) || null; },
  acc(id){ return this.accounts.find(a => a.id === id) || null; },
  cats(kind){ return this.categories.filter(c => c.kind === kind); },

  async touchBackupStamp(v){
    this.lastBackupAt = v || Date.now();
    await repo.setMeta('lastBackupAt', this.lastBackupAt);
  },

  async addTransaction(input){
    const now = Date.now();
    const t = {
      id: uid(),
      type: input.type,
      amountCents: input.amountCents,
      accountId: input.accountId,
      toAccountId: input.toAccountId || null,
      categoryId: input.categoryId || null,
      note: input.note || '',
      occurredAt: input.occurredAt,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      schemaVersion: 1
    };
    await repo.putTransaction(t);
    this.transactions.unshift(t);
    this.transactions.sort((a, b) => b.occurredAt - a.occurredAt);
    logger.info('tx added: ' + t.type + ' ' + t.amountCents, 'tx');
    await repo.setMeta('lastTxAt', now);
    return t;
  },

  async updateTransaction(id, patch){
    const t = this.transactions.find(x => x.id === id);
    if (!t) throw new Error('记录不存在');
    Object.assign(t, patch, { updatedAt: Date.now() });
    await repo.putTransaction(t);
    logger.info('tx updated: ' + id, 'tx');
    return t;
  },

  async deleteTransaction(id){
    const t = this.transactions.find(x => x.id === id);
    if (!t) return;
    t.deletedAt = Date.now();
    await repo.putTransaction(t);
    this.transactions = this.transactions.filter(x => x.id !== id);
    logger.info('tx soft-deleted: ' + id, 'tx');
  },

  async saveAccount(a){
    if (!a.id) {
      a.id = uid();
      a.createdAt = Date.now();
      a.deletedAt = null;
      this.accounts.push(a);
    }
    a.updatedAt = Date.now();
    await repo.putAccount(a);
    logger.info('account saved: ' + a.name, 'account');
    return a;
  },

  async deleteAccount(id){
    const used = this.transactions.some(t => t.accountId === id || t.toAccountId === id);
    if (used) throw new Error('这个账户下还有记录，不能直接删除');
    const a = this.accounts.find(x => x.id === id);
    if (!a) return;
    a.deletedAt = Date.now();
    await repo.putAccount(a);
    this.accounts = this.accounts.filter(x => x.id !== id);
    logger.info('account deleted: ' + a.name, 'account');
  },

  async saveCategory(c){
    if (!c.id) {
      c.id = uid();
      c.createdAt = Date.now();
      c.deletedAt = null;
      c.isSystem = 0;
      this.categories.push(c);
    }
    await repo.putCategory(c);
    logger.info('category saved: ' + c.name, 'category');
    return c;
  },

  async deleteCategory(id){
    const cat = this.categories.find(x => x.id === id);
    if (!cat) return;
    const used = this.transactions.some(t => t.categoryId === id);
    if (used) throw new Error('「' + cat.name + '」下还有记录，不能删除，可以改成归档');
    cat.deletedAt = Date.now();
    await repo.putCategory(cat);
    this.categories = this.categories.filter(x => x.id !== id);
    logger.info('category deleted: ' + cat.name, 'category');
  },

  async archiveCategory(id){
    const cat = this.categories.find(x => x.id === id);
    if (!cat) return;
    cat.archivedAt = Date.now();
    await repo.putCategory(cat);
    logger.info('category archived: ' + cat.name, 'category');
  },

  budgetKey(month, categoryId){ return month + '|' + (categoryId || '__total__'); },

  budgetFor(month, categoryId){
    return this.budgets.find(b => b.key === this.budgetKey(month, categoryId || null)) || null;
  },

  async setBudget(month, categoryId, limitCents){
    const key = this.budgetKey(month, categoryId || null);
    let row = this.budgets.find(b => b.key === key);
    if (limitCents == null || limitCents === '') {
      if (row) {
        await repo.delBudget(row.id);
        this.budgets = this.budgets.filter(b => b.id !== row.id);
      }
      return null;
    }
    if (!row) {
      row = { id: uid(), key, month, categoryId: categoryId || null, limitCents: Number(limitCents) };
      this.budgets.push(row);
    }
    row.limitCents = Number(limitCents);
    await repo.putBudget(row);
    return row;
  }
};

export function balanceOf(accountId){
  let bal = 0;
  for (const a of store.accounts) {
    if (a.id !== accountId) continue;
    bal += a.initialBalanceCents || 0;
  }
  for (const t of store.transactions) {
    if (t.type === 'expense' && t.accountId === accountId) bal -= t.amountCents;
    else if (t.type === 'income' && t.accountId === accountId) bal += t.amountCents;
    else if (t.type === 'transfer') {
      if (t.accountId === accountId) bal -= t.amountCents;
      if (t.toAccountId === accountId) bal += t.amountCents;
    }
  }
  return bal;
}

export function netAssets(){
  let total = 0;
  for (const a of store.accounts) total += (a.initialBalanceCents || 0);
  for (const t of store.transactions) {
    if (t.type === 'expense') total -= t.amountCents;
    else if (t.type === 'income') total += t.amountCents;
  }
  return total;
}

export function txInRange(start, end){
  return store.transactions.filter(t => t.occurredAt >= start && t.occurredAt < end);
}

export function monthStats(key){
  const { start, end } = rangeOf(key);
  const list = txInRange(start, end);
  let expense = 0, income = 0;
  for (const t of list) {
    if (t.type === 'expense') expense += t.amountCents;
    else if (t.type === 'income') income += t.amountCents;
  }
  return { expense, income, net: income - expense, count: list.length };
}

export function byCategory(key, kind){
  const { start, end } = rangeOf(key);
  const list = txInRange(start, end).filter(t => t.type === kind);
  const map = new Map();
  for (const t of list) {
    const k = t.categoryId || '__none__';
    map.set(k, (map.get(k) || 0) + t.amountCents);
  }
  const rows = [];
  for (const [cid, cents] of map) {
    const c = store.cat(cid);
    rows.push({
      id: cid,
      name: c ? c.name : '未分类',
      icon: c ? c.icon : '❓',
      color: c ? c.color : '#888780',
      cents
    });
  }
  return rows.sort((a, b) => b.cents - a.cents);
}

export function monthlyTrend(months){
  const out = [];
  for (const key of months) {
    const s = monthStats(key);
    out.push({ key, label: Number(key.split('-')[1]) + '月', expense: s.expense, income: s.income });
  }
  return out;
}

export function recentMonths(n, endKey){
  const end = endKey || monthKey();
  const out = [];
  for (let i = n - 1; i >= 0; i--) out.push(shiftMonth(end, -i));
  return out;
}

export function compareMonth(key){
  const prev = shiftMonth(key, -1);
  const parts = String(key).split('-').map(Number);
  const lastYear = (parts[0] - 1) + '-' + String(parts[1]).padStart(2, '0');
  const cur = monthStats(key);
  return { cur, prev: monthStats(prev), lastYear: monthStats(lastYear), prevKey: prev, lastYearKey: lastYear };
}

export function budgetStatus(key){
  const stats = monthStats(key);
  const total = store.budgetFor(key, null);
  const rows = byCategory(key, 'expense').map(r => {
    const b = store.budgetFor(key, r.id);
    return { ...r, limitCents: b ? b.limitCents : null };
  });
  const totalRow = {
    limitCents: total ? total.limitCents : null,
    usedCents: stats.expense
  };
  return { stats, total: totalRow, categories: rows };
}
