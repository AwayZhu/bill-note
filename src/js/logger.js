import { uid, fmtDateTime } from './util.js';

const MAX = 500;
const buf = [];

function push(level, mod, msg){
  buf.push({
    seq: buf.length ? buf[buf.length - 1].seq + 1 : 1,
    at: Date.now(),
    level, mod: mod || 'app', msg: String(msg)
  });
  if (buf.length > MAX) buf.splice(0, buf.length - MAX);
  if (level === 'ERROR') {
    try {
      console.error('[' + mod + ']', msg);
    } catch (e) { /* ignore */ }
  }
  window.dispatchEvent(new CustomEvent('app-log'));
}

export const logger = {
  info(msg, mod){ push('INFO', mod, msg); },
  warn(msg, mod){ push('WARN', mod, msg); },
  error(msg, mod){ push('ERROR', mod, msg); },
  action(msg){ push('ACTION', 'ui', msg); },
  all(){ return buf.slice(); },
  errors(){ return buf.filter(x => x.level === 'ERROR'); },
  clear(){ buf.length = 0; window.dispatchEvent(new CustomEvent('app-log')); },
  count(){ return buf.length; }
};

let recStart = null;
const steps = [];

export const replay = {
  start(){
    recStart = Date.now();
    steps.length = 0;
    steps.push({ t: 0, text: '开始记录' });
    logger.info('replay start');
  },
  stop(){
    if (!recStart) return null;
    steps.push({ t: Date.now() - recStart, text: '结束记录' });
    const out = steps.slice();
    recStart = null;
    steps.length = 0;
    logger.info('replay stop, ' + out.length + ' steps');
    return out;
  },
  recording(){ return recStart !== null; },
  step(text){
    if (!recStart) return;
    steps.push({ t: Date.now() - recStart, text });
  },
  current(){
    if (!recStart) return null;
    const base = Date.now() - recStart;
    const all = steps.concat([{ t: base, text: '(进行中)' }]);
    return { elapsed: base, steps: all };
  }
};

export function logRoute(name){
  logger.info('route -> ' + name, 'router');
  replay.step('进入页面 ' + name);
}

const crashes = [];

export function recordCrash(where, err){
  const item = {
    at: Date.now(),
    where,
    message: (err && err.message) ? err.message : String(err),
    stack: (err && err.stack) ? String(err.stack).split('\n').slice(0, 6).join('\n') : ''
  };
  crashes.push(item);
  if (crashes.length > 5) crashes.shift();
  logger.error('CRASH @' + where + ': ' + item.message, 'crash');
}

export function lastCrash(){ return crashes.length ? crashes[crashes.length - 1] : null; }

window.addEventListener('error', e => {
  recordCrash(e.filename + ':' + e.lineno, e.error || new Error(e.message));
});

window.addEventListener('unhandledrejection', e => {
  recordCrash('promise', e.reason || new Error('unhandled rejection'));
});

export function fmtLogLine(x){
  return fmtDateTime(x.at) + ' [' + x.level + '] ' + x.mod + ' ' + x.msg;
}

export const APP_BUILD = uid().slice(0, 6).toUpperCase();
