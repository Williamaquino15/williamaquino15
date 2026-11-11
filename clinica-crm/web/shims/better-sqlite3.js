// API síncrona do better-sqlite3 sobre o sql.js (SQLite em WebAssembly).
const norm = (v) => (v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v);
function bindArgs(args) {
  if (args.length === 1 && args[0] && typeof args[0] === 'object' && !Array.isArray(args[0]) && !(args[0] instanceof Uint8Array)) {
    const o = {};
    for (const [k, v] of Object.entries(args[0])) o['@' + k] = norm(v);
    return o;
  }
  return args.map(norm);
}
class Statement {
  constructor(owner, sql) { this.owner = owner; this.sql = sql; }
  _prep(args) { const st = this.owner.raw.prepare(this.sql); st.bind(bindArgs(args)); return st; }
  run(...args) {
    const st = this._prep(args);
    try { st.step(); } finally { st.free(); }
    const changes = this.owner.raw.getRowsModified();
    const r = this.owner.raw.exec('SELECT last_insert_rowid()');
    this.owner.dirty();
    return { changes, lastInsertRowid: r[0] ? r[0].values[0][0] : 0 };
  }
  get(...args) {
    const st = this._prep(args);
    try { return st.step() ? st.getAsObject() : undefined; } finally { st.free(); }
  }
  all(...args) {
    const st = this._prep(args);
    const out = [];
    try { while (st.step()) out.push(st.getAsObject()); } finally { st.free(); }
    return out;
  }
}
class Database {
  constructor() {
    const g = globalThis.__SQL__;
    this.raw = g.data ? new g.SQL.Database(g.data) : new g.SQL.Database();
    g.db = this;
  }
  dirty() { if (globalThis.__SQL__.onWrite) globalThis.__SQL__.onWrite(); }
  prepare(sql) { return new Statement(this, sql); }
  exec(sql) { this.raw.exec(sql); this.dirty(); return this; }
  pragma() { return []; }
  transaction(fn) {
    return (...a) => {
      this.raw.exec('BEGIN');
      try { const r = fn(...a); this.raw.exec('COMMIT'); this.dirty(); return r; } catch (e) { this.raw.exec('ROLLBACK'); throw e; }
    };
  }
}
module.exports = Database;
