// Builds dist/demo (and dist/site): a standalone copy of the aquarium that needs no server.
// The real Director, parser and crowd simulator from server/ run in the page;
// three.js comes from the jsDelivr CDN. Used for the shareable demo link.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'dist', 'demo');
const three = JSON.parse(fs.readFileSync(path.join(ROOT, 'node_modules', 'three', 'package.json'), 'utf8')).version;

fs.rmSync(OUT, { recursive: true, force: true });
const copy = (from, to) => {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
};

for (const file of fs.readdirSync(path.join(ROOT, 'renderer', 'js'), { recursive: true })) {
  const src = path.join(ROOT, 'renderer', 'js', file);
  if (fs.statSync(src).isFile() && file.endsWith('.js') && file !== 'admin.js') copy(src, path.join(OUT, 'js', file));
}
for (const css of ['aquarium.css', 'chat.css', 'demo.css']) copy(path.join(ROOT, 'renderer', 'css', css), path.join(OUT, 'css', css));
// 3D fish models (prepared by scripts/models/prepare.py). The artifact host does not serve .glb,
// so the demo gets them as base64 text; js/fish/models.js decodes that in demo mode.
const models = path.join(ROOT, 'renderer', 'assets', 'models');
for (const file of fs.existsSync(models) ? fs.readdirSync(models) : []) {
  if (!file.endsWith('.glb')) continue;
  fs.mkdirSync(path.join(OUT, 'assets', 'models'), { recursive: true });
  fs.writeFileSync(path.join(OUT, 'assets', 'models', `${file}.b64.txt`), fs.readFileSync(path.join(models, file)).toString('base64'));
}
for (const mod of ['catalog', 'parser', 'director', 'world', 'ambient', 'simulator']) {
  copy(path.join(ROOT, 'server', `${mod}.js`), path.join(OUT, 'server', `${mod}.js`));
}

fs.mkdirSync(path.join(OUT, 'shims'), { recursive: true });
fs.writeFileSync(path.join(OUT, 'shims', 'node-fs.js'), `// The world runs in memory in the demo: no filesystem.
const noop = () => {};
export default { existsSync: () => false, readFileSync: () => { throw new Error('no filesystem in the browser'); }, writeFileSync: noop, renameSync: noop, mkdirSync: noop, appendFile: noop };
`);
fs.writeFileSync(path.join(OUT, 'shims', 'node-path.js'), `export default {
  join: (...parts) => parts.join('/'),
  dirname: (p) => String(p).split('/').slice(0, -1).join('/') || '.',
  resolve: (...parts) => parts.join('/'),
};
`);

const importMap = {
  imports: {
    three: `https://cdn.jsdelivr.net/npm/three@${three}/build/three.module.js`,
    'three/addons/': `https://cdn.jsdelivr.net/npm/three@${three}/examples/jsm/`,
    'node:fs': './shims/node-fs.js',
    'node:path': './shims/node-path.js',
  },
};

fs.writeFileSync(path.join(OUT, 'index.html'), `<title>Live Aquarium</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Figtree:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap">
<link rel="stylesheet" href="css/aquarium.css">
<link rel="stylesheet" href="css/chat.css">
<link rel="stylesheet" href="css/demo.css">
<script>window.AQUARIUM_DEMO = true;</script>
<script type="importmap">${JSON.stringify(importMap)}</script>
<canvas id="scene" aria-label="Virtual reef aquarium"></canvas>
<div id="overlay" class="overlay"></div>
<div id="sound-hint" class="hidden"></div>
<pre id="hud" class="hidden"></pre>
<div id="chat" class="chat-dock"></div>
<script type="module" src="js/main.js"></script>
`);

const files = [];
for (const f of fs.readdirSync(OUT, { recursive: true })) if (fs.statSync(path.join(OUT, f)).isFile()) files.push(f);
console.log(`dist/demo: ${files.length} files, three@${three}`);

// dist/site: the same page for an ordinary web server (scripts/deploy-site.sh). The artifact host wraps
// dist/demo/index.html in a document itself; a plain server needs the doctype, or the page renders in quirks mode.
const SITE = path.join(ROOT, 'dist', 'site');
fs.rmSync(SITE, { recursive: true, force: true });
fs.cpSync(OUT, SITE, { recursive: true });
fs.writeFileSync(path.join(SITE, 'index.html'), `<!doctype html>
<html lang="ru">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow">
<style>html, body { margin: 0; background: #04131f; }</style>
${fs.readFileSync(path.join(OUT, 'index.html'), 'utf8')}</html>
`);
console.log('dist/site: the same, as a standalone page');
