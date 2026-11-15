/* tests/dom-smoke.mjs — 用极简 DOM 桩跑真实的 ES module，验证接线与交互
 *
 * 运行：node tests/dom-smoke.mjs
 * 不需要浏览器：伪造 document / localStorage / matchMedia，再 import ui.js。
 */

import fs from 'node:fs';

// STANDALONE=1 时对 docs/standalone.html 跑同一套断言
const STANDALONE = process.env.STANDALONE === '1';
const html = fs.readFileSync(
  new URL(STANDALONE ? '../docs/standalone.html' : '../docs/index.html', import.meta.url),
  'utf8'
);

/* ---------- 1. 从 HTML 里抠出所有带 id 的元素 ---------- */
const elements = new Map();
const tagRe = /<([a-zA-Z][\w-]*)((?:[^>"]|"[^"]*")*?)>/g;
let m;
while ((m = tagRe.exec(html))) {
  const attrs = m[2];
  const idMatch = attrs.match(/\bid="([^"]+)"/);
  if (!idMatch) continue;
  const id = idMatch[1];
  const valMatch = attrs.match(/\bvalue="([^"]*)"/);
  const el = {
    id,
    tagName: m[1].toUpperCase(),
    value: valMatch ? valMatch[1] : '',
    textContent: '',
    innerHTML: '',
    hidden: false,
    dataset: {},
    style: { setProperty() {}, getPropertyValue: () => '' },
    _on: {},
    _child: new Map(),
    classList: {
      _s: new Set(),
      add(c) { this._s.add(c); },
      remove(c) { this._s.delete(c); },
      toggle(c, on) { if (on === undefined ? !this._s.has(c) : on) this._s.add(c); else this._s.delete(c); },
      contains(c) { return this._s.has(c); },
    },
    addEventListener(type, fn) { (this._on[type] ||= []).push(fn); },
    fire(type, ev = {}) { (this._on[type] || []).forEach((fn) => fn(ev)); },
    querySelector(sel) {
      if (!this._child.has(sel)) this._child.set(sel, {
        tagName: sel.toUpperCase(), innerHTML: '', textContent: '', _on: {},
        addEventListener(t, fn) { (this._on[t] ||= []).push(fn); },
        fire(t, ev = {}) { (this._on[t] || []).forEach((fn) => fn(ev)); },
      });
      return this._child.get(sel);
    },
  };
  elements.set(id, el);
}

/* ---------- 2. 全局桩 ---------- */
const store = new Map();
globalThis.document = {
  documentElement: { dataset: {}, style: { setProperty() {} } },
  getElementById: (id) => elements.get(id) || null,
  createElement: () => ({ value: '', select() {}, remove() {}, appendChild() {}, click() {} }),
  body: { appendChild() {}, removeChild() {} },
};
globalThis.window = globalThis;
globalThis.location = { search: '', protocol: 'http:' };
globalThis.history = { replaceState() {} };
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, v),
};
globalThis.matchMedia = () => ({ matches: false });
globalThis.getComputedStyle = () => ({ getPropertyValue: () => '' });
globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0);
globalThis.cancelAnimationFrame = (h) => clearTimeout(h);
Object.defineProperty(globalThis, 'navigator', {
  value: { clipboard: { writeText: async () => {} } },
  configurable: true,
});

/* ---------- 3. 真跑脚本（顺序与 index.html 一致） ---------- */
import vm from 'node:vm';
const run = (name) =>
  vm.runInThisContext(fs.readFileSync(new URL(`../docs/js/${name}`, import.meta.url), 'utf8'), { filename: name });
if (STANDALONE) {
  // 单文件版：按顺序执行内联脚本
  const inline = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  if (inline.length !== 8) throw new Error(`内联脚本数量不对：${inline.length}`);
  inline.forEach((code, i) => vm.runInThisContext(code, { filename: `inline-${i}.js` }));
} else {
  ['core.js', 'admissions.js', 'majors.js', 'chart.js', 'export.js', 'ui.js'].forEach(run);
}

let failed = 0;
let passed = 0;
const eq = (label, a, b) => {
  if (String(a) === String(b)) passed++;
  else { failed++; console.log(`  ✗ ${label}: 实际 ${JSON.stringify(a)}，期望 ${JSON.stringify(b)}`); }
};
const has = (label, haystack, needle) => eq(label, String(haystack).includes(needle), true);

const $ = (id) => elements.get(id);

console.log('启动');
eq('脚本就绪', globalThis.__SC_READY, true);

console.log('首屏');
eq('等效分', $('res-score').textContent, '536');
eq('徽章', $('badge').textContent, '上线');
eq('差值文案', $('res-delta').textContent, '高于特控线 8 分');
has('省位次进指标', $('stats').innerHTML, '50,582');
has('曲线已画', $('chart').innerHTML, '<svg');
has('多人对比表', $('compare-table')._child.get('tbody').innerHTML, '57,108');
has('对比表高亮当前人', $('compare-table')._child.get('tbody').innerHTML, 'class="me ');
eq('换算表行数', ($('lookup-table')._child.get('tbody').innerHTML.match(/<tr/g) || []).length, 9);
eq('步骤数', ($('steps').innerHTML.match(/<li>/g) || []).length, 5);
eq('冲的数量', ($('rec-reach').innerHTML.match(/<li>/g) || []).length, 5);
eq('稳的数量', ($('rec-safe').innerHTML.match(/<li>/g) || []).length, 5);
has('冲里有福建农林大学', $('rec-reach').innerHTML, '福建农林大学');
has('稳里有福建医科大学', $('rec-safe').innerHTML, '福建医科大学');
eq('专业冲的数量', ($('major-reach').innerHTML.match(/<li>/g) || []).length, 5);
has('专业里有集美大学', $('major-reach').innerHTML, '集美大学');
has('专业副标题含三校', $('major-sub').textContent, '集美大学');

console.log('分数/位次联动');
{
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  $('in-score').value = '480';
  $('in-score').fire('input');
  await sleep(30);
  eq('位次自动算出', $('in-rank').value, '4030');
  has('省排跟着变', $('stats').innerHTML, '65,756');
  has('推荐跟着变', $('rec-reach').innerHTML, '<li>');

  $('in-rank').value = '4000';
  $('in-rank').fire('input');
  await sleep(30);
  eq('分数自动算出', $('in-score').value, '481');
  has('省排再变', $('stats').innerHTML, '65,267');

  // 复位
  $('in-score').value = '460';
  $('in-rank').value = '4800';
  globalThis.__demo.render();
}

console.log('改输入');
$('in-score').value = '460';
$('in-rank').value = '4800';
$('in-name').value = '朋友';
globalThis.__demo.render();
eq('等效分', $('res-score').textContent, '496');
eq('徽章', $('badge').textContent, '未上线');

console.log('只填分数');
$('in-score').value = '507';
$('in-rank').value = '';
globalThis.__demo.render();
eq('分数反推等效分', $('res-score').textContent, '543');
has('链路标注反推', $('chain').innerHTML, '反推');
eq('外推提示可见', $('chain-note').hidden, false);
has('位次格显示反推', $('stats').innerHTML, '由分数反推');

console.log('加入对比');
$('in-score').value = '485';
$('in-rank').value = '3900';
$('in-name').value = '新人';
globalThis.__demo.render();
const before = globalThis.__demo.getCompare().length;
$('btn-add').fire('click');
eq('人数 +1', globalThis.__demo.getCompare().length, before + 1);
$('btn-add').fire('click');
eq('重复加入被忽略', globalThis.__demo.getCompare().length, before + 1);

console.log('删除一行');
$('compare-table')._child.get('tbody').fire('click', {
  target: { closest: (sel) => (sel === '[data-del]' ? { dataset: { del: '0' } } : null) },
});
eq('人数 -1', globalThis.__demo.getCompare().length, before);

console.log('批量导入');
$('import-text').value = '小明 490 3600\n小红 475 4300\n480 4000\n小刚 465';
$('btn-import').fire('click');
eq('导入 4 人（含只有分数的）', globalThis.__demo.getCompare().length, before + 4);
has('只有分数的也进表', $('compare-table')._child.get('tbody').innerHTML, '小刚');

console.log('点表格读回');
const first = globalThis.__demo.getCompare()[0];
$('compare-table')._child.get('tbody').fire('click', {
  target: { closest: (sel) => (sel === 'tr[data-i]' ? { dataset: { i: '0' } } : null) },
});
eq('读回分数', $('in-score').value, String(first.score));
eq('读回位次', $('in-rank').value, String(first.rank));

console.log('非法输入');
$('in-rank').value = '99999';
globalThis.__demo.render();
eq('报错可见', $('error').hidden, false);
has('错误文案', $('error').textContent, '位次');

console.log(`\n通过 ${passed}，失败 ${failed}${STANDALONE ? '（单文件版）' : ''}`);
process.exit(failed ? 1 : 0);
