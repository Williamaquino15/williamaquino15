// Roteador mínimo compatível com o uso de Express no servidor, executado no navegador.
function compile(path) {
  const parts = path.split('/');
  return (url) => {
    if (path === '*') return {};
    const xs = url.split('/');
    if (xs.length !== parts.length) return null;
    const params = {};
    for (let i = 0; i < parts.length; i++) {
      if (parts[i].startsWith(':')) params[parts[i].slice(1)] = decodeURIComponent(xs[i]);
      else if (parts[i] !== xs[i]) return null;
    }
    return params;
  };
}
function express() {
  const stack = [];
  const add = (method) => (path, ...handlers) => { stack.push({ method, match: compile(path), handlers }); return app; };
  const app = {
    get: add('GET'), post: add('POST'), put: add('PUT'), delete: add('DELETE'), set() { return app; }, listen() { return { close() {}, address: () => ({ port: 0 }) }; },
    use(a, ...rest) {
      if (typeof a === 'function') stack.push({ method: null, match: () => ({}), handlers: [a, ...rest] });
      else stack.push({ method: null, match: (url) => (url === a || url.startsWith(a + '/') ? {} : null), handlers: rest });
      return app;
    },
    // Executa a requisição e devolve {status, body, headers}.
    handle({ method, url, body, cookie }) {
      const [path, qs] = url.split('?');
      const query = Object.fromEntries(new URLSearchParams(qs || ''));
      return new Promise((resolve) => {
        const res = {
          statusCode: 200, headers: {}, headersSent: false,
          status(c) { this.statusCode = c; return this; },
          setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
          json(o) { this.headersSent = true; resolve({ status: this.statusCode, body: o, headers: this.headers }); },
          sendFile() { this.status(404).json({ error: 'Não encontrado' }); },
        };
        const req = { method, url, path, query, body: body || {}, headers: { cookie: cookie || '' }, params: {} };
        let i = 0;
        const layers = stack.filter((l) => !l.method || l.method === method);
        const run = (err) => {
          if (res.headersSent) return;
          while (i < layers.length) {
            const l = layers[i++];
            const params = l.match(path);
            if (!params) continue;
            req.params = params;
            let j = 0;
            const nextHandler = () => {
              if (res.headersSent) return;
              const fn = l.handlers[j++];
              if (!fn) return run();
              try { fn(req, res, nextHandler); } catch (e) { res.status(500).json({ error: e.message }); }
            };
            return nextHandler();
          }
          res.status(404).json({ error: 'Rota não encontrada' });
        };
        run();
      });
    },
  };
  return app;
}
express.json = () => (req, res, next) => next();
express.static = () => (req, res, next) => next();
module.exports = express;
