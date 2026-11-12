// Gera dist/clinica-crm.html: página única com o sistema inteiro rodando no navegador.
const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');

const root = path.join(__dirname, '..');
const shim = (n) => path.join(__dirname, 'shims', n + '.js');
const wasm = fs.readFileSync(require.resolve('sql.js/dist/sql-wasm.wasm')).toString('base64');

const plugin = {
  name: 'demo',
  setup(b) {
    b.onResolve({ filter: /^(express|better-sqlite3|crypto|path|fs)$/ }, (a) => ({ path: shim(a.path) }));
    b.onResolve({ filter: /^wasm-b64$/ }, () => ({ path: 'wasm-b64', namespace: 'v' }));
    b.onLoad({ filter: /.*/, namespace: 'v' }, () => ({ contents: `module.exports=${JSON.stringify(wasm)}`, loader: 'js' }));
  },
};

(async () => {
  const out = await esbuild.build({
    entryPoints: [path.join(__dirname, 'entry.js')], bundle: true, write: false, format: 'iife', platform: 'browser', target: 'es2020',
    minify: true, plugins: [plugin], define: { __dirname: '"/"' }, banner: { js: 'globalThis.process=globalThis.process||{env:{}};' }, logLevel: 'warning',
  });
  const js = out.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
  const css = fs.readFileSync(path.join(root, 'public/css/app.css'), 'utf8');
  const html = `<title>Exclusive Odontologia</title>
<meta name="description" content="CRM da Exclusive Odontologia (demonstração)">
<style>${css}</style>
<div id="app"><div class="loading">Carregando o sistema…</div></div>
<div id="toasts"></div>
<script>${js}</script>
`;
  fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
  const file = path.join(root, 'dist', 'clinica-crm.html');
  fs.writeFileSync(file, html);
  console.log(`${file} (${(html.length / 1024 / 1024).toFixed(2)} MB)`);
})().catch((e) => { console.error(e); process.exit(1); });
