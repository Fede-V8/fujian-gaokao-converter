/* tools/build-standalone.mjs — 把 index.html + css + 4 个脚本压成一个可直接分发的 HTML
 *
 * 用法：node tools/build-standalone.mjs
 * 产物：docs/standalone.html（生成物，别手改；改源码后重跑）
 */
import fs from 'node:fs';

const dir = new URL('../docs/', import.meta.url);
let html = fs.readFileSync(new URL('index.html', dir), 'utf8');
const css = fs.readFileSync(new URL('styles.css', dir), 'utf8');

const files = ['core.js', 'admissions.js', 'chart.js', 'export.js', 'ui.js'];
const sources = files.map((f) => fs.readFileSync(new URL(`js/${f}`, dir), 'utf8'));

html = html.replace(
  /<link rel="stylesheet" href="\.\/styles\.css" \/>/,
  () => `<style>\n${css}\n</style>`
);

const tagRe = /\s*<script src="\.\/js\/(core|admissions|chart|export|ui)\.js(\?v=[^"]*)?" defer><\/script>/g;
let i = 0;
html = html.replace(tagRe, () => `\n<script>\n${sources[i++]}\n</script>`);

if (i !== files.length) throw new Error(`只替换了 ${i} 个脚本，检查 index.html 的 script 标签`);
if (html.includes('styles.css') || html.includes('./js/')) {
  throw new Error('还有外链没内联干净');
}

const out = new URL('standalone.html', dir);
fs.writeFileSync(out, html);
console.log('wrote docs/standalone.html', (html.length / 1024).toFixed(1), 'KB');
