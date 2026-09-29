// Gera os PNGs do PWA a partir dos SVGs em icons/, usando Chrome/Edge headless.
// Uso: node scripts/gerar-icones.mjs
// Outro navegador: CHROME="C:\caminho\chrome.exe" node scripts/gerar-icones.mjs

import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = resolve(import.meta.dirname, '..');
const icons = join(root, 'icons');

const TARGETS = [
  { svg: 'icon.svg', out: 'icon-192.png', size: 192 },
  { svg: 'icon.svg', out: 'icon-512.png', size: 512 },
  { svg: 'icon-maskable.svg', out: 'icon-maskable-512.png', size: 512 },
  // iOS preenche transparência com preto: usa a versão de fundo inteiro.
  { svg: 'icon-maskable.svg', out: 'apple-touch-icon.png', size: 180 },
];

const CANDIDATES = [
  process.env.CHROME,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter(Boolean);

const browser = CANDIDATES.find((path) => existsSync(path));
if (!browser) {
  console.error('Chrome/Edge não encontrado. Defina a variável CHROME com o caminho do executável.');
  process.exit(1);
}

function pngSize(file) {
  const buffer = readFileSync(file);
  return [buffer.readUInt32BE(16), buffer.readUInt32BE(20)];
}

const work = mkdtempSync(join(tmpdir(), 'gisela-icones-'));
try {
  for (const { svg, out, size } of TARGETS) {
    const page = join(work, `${out}.html`);
    const svgUrl = pathToFileURL(join(icons, svg)).href;
    writeFileSync(
      page,
      `<!doctype html><html><head><style>html,body{margin:0;background:transparent}img{display:block;width:${size}px;height:${size}px}</style></head><body><img src="${svgUrl}"></body></html>`,
    );
    const target = join(icons, out);
    execFileSync(browser, [
      '--headless=new',
      '--disable-gpu',
      '--hide-scrollbars',
      '--default-background-color=00000000',
      `--user-data-dir=${join(work, 'profile')}`,
      `--window-size=${size},${size}`,
      `--screenshot=${target}`,
      pathToFileURL(page).href,
    ], { stdio: 'ignore' });

    const [w, h] = pngSize(target);
    if (w !== size || h !== size) throw new Error(`${out} saiu com ${w}x${h}, esperado ${size}x${size}`);
    console.log(`${out}: ${w}x${h}`);
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}
