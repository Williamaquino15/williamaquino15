// Utilitários compartilhados pelo servidor.
const pad = (n) => String(n).padStart(2, '0');

function now() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
const today = () => now().slice(0, 10);

const digits = (s) => String(s || '').replace(/\D/g, '');

function toArr(v) {
  if (v === undefined || v === null || v === '') return [];
  if (Array.isArray(v)) return v.filter((x) => x !== '');
  return String(v).split(',').filter((x) => x !== '');
}
const toIntArr = (v) => toArr(v).map(Number).filter((n) => !Number.isNaN(n));

function parseJSON(s, def) {
  try { return s ? JSON.parse(s) : def; } catch { return def; }
}

// Mantém apenas as chaves permitidas de um objeto.
function pick(obj, keys) {
  const out = {};
  for (const k of keys) if (obj && Object.prototype.hasOwnProperty.call(obj, k)) out[k] = obj[k];
  return out;
}

const daysBetween = (a, b) => Math.round((new Date(b.slice(0, 10)) - new Date(a.slice(0, 10))) / 86400000);

module.exports = { now, today, digits, toArr, toIntArr, parseJSON, pick, daysBetween, pad };
