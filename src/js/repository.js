import { logger } from './logger.js';

const DB_NAME = 'money';
const DB_VERSION = 1;
export const SCHEMA_VERSION = 1;
const STORES = ['accounts', 'categories', 'transactions', 'budgets', 'meta', 'logs'];

let dbPromise = null;
let engine = 'unknown';

function openDB(){
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('no-indexeddb'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      STORES.forEach(name => {
        if (!db.objectStoreNames.contains(name)) {
          db.createObjectStore(name, { keyPath: 'id' });
        }
      });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('open failed'));
    req.onblocked = () => reject(new Error('db blocked'));
  });
}

function ensure(where){
  try {
    const m = String(where).match(/at '([^']+)'/);
    if (m) return m[1];
  } catch (e) { /* ignore */ }
  return String(where);
}

function done(request){
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error(ensure(request.error)));
  });
}

async function store(name, mode){
  const db = await getDB();
  return db.transaction(name, mode).objectStore(name);
}

export function getDB(){
  if (!dbPromise) dbPromise = openDB();
  return dbPromise;
}

async function all(name){
  const s = await store(name, 'readonly');
  return done(s.getAll());
}
async function put(name, obj){
  const s = await store(name, 'readwrite');
  return done(s.put(obj));
}
async function get(name, id){
  const s = await store(name, 'readonly');
  return done(s.get(id));
}
async function del(name, id){
  const s = await store(name, 'readwrite');
  return done(s.delete(id));
}

function live(list){
  return (list || []).filter(x => !x.deletedAt);
}

export const repo = {
  async ping(){
    await getDB();
    return true;
  },

  async accounts(){
    return live(await all('accounts')).sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
  },
  putAccount(a){ return put('accounts', a); },

  async categories(){
    return live(await all('categories')).sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
  },
  putCategory(c){ return put('categories', c); },

  async transactions(){
    return (await all('transactions')).filter(x => !x.deletedAt).sort((a, b) => b.occurredAt - a.occurredAt);
  },
  async transactionsRaw(){
    return all('transactions');
  },
  putTransaction(t){ return put('transactions', t); },

  async budgets(){
    return all('budgets');
  },
  putBudget(b){ return put('budgets', b); },
  delBudget(id){ return del('budgets', id); },

  async meta(key, def){
    const row = await get('meta', key);
    return row ? row.value : def;
  },
  async setMeta(key, value){
    return put('meta', { id: key, value });
  },
  async allMeta(){
    return all('meta');
  },

  async counts(){
    const names = ['accounts', 'categories', 'transactions', 'budgets'];
    const out = {};
    for (const n of names) {
      const rows = await all(n);
      out[n] = rows.length;
      out[n + 'Live'] = live(rows).length;
    }
    return out;
  },

  async exportAll(){
    const data = {
      format: 'money-backup',
      schemaVersion: SCHEMA_VERSION,
      exportedAt: Date.now(),
      accounts: await all('accounts'),
      categories: await all('categories'),
      transactions: await all('transactions'),
      budgets: await all('budgets'),
      meta: await all('meta')
    };
    return data;
  },

  async importAll(data){
    if (!data || !Array.isArray(data.transactions)) throw new Error('不是有效的备份文件');
    const putAll = async (name, rows) => {
      for (const r of rows || []) {
        if (r && r.id) await put(name, r);
      }
    };
    await putAll('accounts', data.accounts);
    await putAll('categories', data.categories);
    await putAll('transactions', data.transactions);
    await putAll('budgets', data.budgets);
    await putAll('meta', data.meta);
    logger.info('import ok: ' + (data.transactions || []).length + ' tx', 'backup');
    return true;
  },

  async wipe(){
    for (const n of STORES) {
      try {
        const s = await store(n, 'readwrite');
        await done(s.clear());
      } catch (e) {
        logger.warn('wipe ' + n + ' failed: ' + e.message, 'repo');
      }
    }
  },

  async selfTest(){
    const probeId = '__probe__' + Date.now();
    const steps = { write: false, read: false, remove: false, error: '' };
    try {
      await put('meta', { id: probeId, value: 1 });
      steps.write = true;
      const row = await get('meta', probeId);
      steps.read = !!(row && row.value === 1);
      await del('meta', probeId);
      const gone = await get('meta', probeId);
      steps.remove = !gone;
    } catch (e) {
      steps.error = e.message;
      logger.warn('selfTest failed: ' + e.message, 'repo');
    }
    return steps;
  }
};

export async function detectEngine(){
  try {
    await getDB();
    engine = 'IndexedDB';
  } catch (e) {
    engine = 'IndexedDB-不可用:' + e.message;
  }
  return engine;
}

export function currentEngine(){ return engine; }
