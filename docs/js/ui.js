(function (root) {
  'use strict';

  const { DEFAULT_PARAMS, SAMPLES, makeModel, convert, lookupTable } = root.SC;
  const { chartSVG } = root.SC;
  const { buildCardSVG, downloadCard } = root.SC;
  const { recommendGroups, ADMISSIONS, BUILD } = root.SC;

/* ui.js — DOM 绑定与渲染；算法在 core.js，长图在 export.js */




const $ = (id) => document.getElementById(id);

const el = {
  name: $('in-name'),
  score: $('in-score'),
  rank: $('in-rank'),
  drop: $('in-drop'),
  outDrop: $('out-drop'),
  outRate: $('out-rate'),
  outProv: $('out-prov'),
  err: $('error'),
  badge: $('badge'),
  resScore: $('res-score'),
  resDelta: $('res-delta'),
  resRange: $('res-range'),
  stats: $('stats'),
  recSub: $('rec-sub'),
  recReach: $('rec-reach'),
  recSafe: $('rec-safe'),
  recNote: $('rec-note'),
  chain: $('chain'),
  chainNote: $('chain-note'),
  chart: $('chart'),
  chartSub: $('chart-sub'),
  steps: $('steps'),
  compareBody: $('compare-table').querySelector('tbody'),
  lookupBody: $('lookup-table').querySelector('tbody'),
  importText: $('import-text'),
  btn: {
    add: $('btn-add'),
    copy: $('btn-copy'),
    export: $('btn-export'),
    reset: $('btn-reset'),
    theme: $('btn-theme'),
    clear: $('btn-clear'),
    import: $('btn-import'),
  },
};

const PARAM_IDS = [
  'p-mock-total', 'p-mock-line-score', 'p-mock-line-rank',
  'p-gk-total', 'p-gk-line-score', 'p-gk-line-rank',
];

const STORE = { compare: 'sc.compare.v1', theme: 'sc.theme.v1' };

const fmtInt = (n) => Math.round(n).toLocaleString('zh-CN');
const fmt1 = (n) => (Math.round(n * 10) / 10).toFixed(1);
const pct = (x, d = 1) => (x * 100).toFixed(d) + '%';
const signed = (n) => (n >= 0 ? '+' : '') + Math.round(n);

let compare = []; // [{name, score, rank}]

/* ---------- 存取 ---------- */

function loadStore(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}
function saveStore(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* 隐私模式或 file:// 下忽略 */
  }
}

/* ---------- 主题 ---------- */

function initialTheme() {
  try {
    const t = localStorage.getItem(STORE.theme);
    if (t === 'dark' || t === 'light') return t;
  } catch {
    /* ignore */
  }
  return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  el.btn.theme.textContent = theme === 'dark' ? '☀' : '◐';
  try {
    localStorage.setItem(STORE.theme, theme);
  } catch {
    /* ignore */
  }
}

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function chartTheme() {
  return {
    bg: cssVar('--card'),
    grid: cssVar('--line'),
    gridSoft: cssVar('--line-soft'),
    axisText: cssVar('--dim'),
    axisTitle: cssVar('--dim'),
    curve: cssVar('--accent'),
    line: cssVar('--red'),
    ok: cssVar('--green'),
    warn: cssVar('--amber'),
    ink: cssVar('--ink'),
    sub: cssVar('--muted'),
  };
}

/* ---------- 输入 ---------- */

function readParams() {
  const n = (id) => Number($(id).value);
  return {
    mock: { total: n('p-mock-total'), lineScore: n('p-mock-line-score'), lineRank: n('p-mock-line-rank') },
    gk: { total: n('p-gk-total'), lineScore: n('p-gk-line-score'), lineRank: n('p-gk-line-rank') },
    dropPp: Number(el.drop.value) / 100,
    bandPp: DEFAULT_PARAMS.bandPp,
  };
}

function currentInput() {
  return {
    name: (el.name.value || '你').trim(),
    score: el.score.value,
    rank: el.rank.value,
  };
}

/* ---------- 渲染 ---------- */

function render() {
  let params, model, result;
  try {
    params = readParams();
    model = makeModel(params);
    result = convert(currentInput(), params, model);
    result.input.name = currentInput().name || '你';
    hideError();
  } catch (e) {
    showError(e.message);
    return;
  }

  const gk = params.gk;
  const fill = (Number(el.drop.value) / 10) * 100;
  el.drop.style.setProperty('--fill', `${fill}%`);
  el.outDrop.textContent = fmt1(Number(el.drop.value));
  el.outRate.textContent = `市 ${pct(model.rate)}`;
  el.outProv.textContent = pct(gk.lineRank / gk.total);

  el.resScore.textContent = Math.round(result.scoreProv);
  el.resDelta.textContent =
    (result.delta >= 0 ? '高于特控线 ' : '低于特控线 ') + Math.abs(Math.round(result.delta)) + ' 分';
  el.resRange.textContent = `区间 ${Math.round(result.scoreWorst)} – ${Math.round(result.scoreBest)} 分`;
  el.badge.textContent = result.online ? '上线' : '未上线';
  el.badge.classList.toggle('off', !result.online);

  const cells = [
    ['模考位次', `${fmtInt(result.rank)}<small>${result.rankInferred ? '由分数反推' : '名'}</small>`],
    ['全省等效位次', `${fmtInt(result.rankProv)}<small>名</small>`],
    ['与特控线', `<span class="${result.delta >= 0 ? 'pos' : 'neg'}">${signed(result.delta)}</span><small>分</small>`],
    ['市内百分位', `${pct(result.topPct)}<small>市线 ${pct(model.rate)}</small>`],
    ['距市线', `${result.gapRank >= 0 ? '领先 ' : '落后 '}${fmtInt(Math.abs(result.gapRank))}<small>名</small>`],
    ['模考市线', `${Math.round(model.cityScore)}<small>分 · 第 ${fmtInt(model.lineRankMock)} 名</small>`],
  ];
  el.stats.innerHTML = cells.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('');

  const chainBits = [
    `模考 <b>${result.score}</b> 分${result.scoreInferred ? '<span class="inferred">反推</span>' : ''}`,
    `第 <b>${fmtInt(result.rank)}</b> 名${result.rankInferred ? '<span class="inferred">反推</span>' : ''}`,
    `全省 <b>${fmtInt(result.rankProv)}</b> 名`,
    `<b>${Math.round(result.scoreProv)}</b> 分`,
  ];
  el.chain.innerHTML = chainBits.map((t, i) => (i ? `<i>→</i><span>${t}</span>` : `<span>${t}</span>`)).join('');

  if (result.extrapolated) {
    el.chainNote.hidden = false;
    el.chainNote.textContent = `分数不在已知锚点 ${result.range.low}–${result.range.high} 分内，位次按端点斜率外推，误差较大`;
  } else {
    el.chainNote.hidden = true;
  }

  el.chart.innerHTML = chartSVG({ model, result, theme: chartTheme() });
  el.chartSub.textContent = `倍率 ×${model.k.toFixed(2)}，平移 +${model.offset.toFixed(1)} 分，市线第 ${fmtInt(model.lineRankMock)} 名`;

  renderRec(result);
  renderCompare(model);
  renderLookup(model, result);
  renderSteps(params, model, result);
  syncURL(params, result);
}


function renderRec(result) {
  const data = ADMISSIONS;
  if (!data || !data.tables) {
    el.recSub.textContent = '尚未导入院校数据';
    el.recNote.textContent = '';
    el.recReach.innerHTML = '<li class="rec-empty">无数据</li>';
    el.recSafe.innerHTML = '<li class="rec-empty">无数据</li>';
    return;
  }
  const rec = recommendGroups(result.rankProv, data);
  el.recSub.textContent = `你换算后的省位次是第 ${fmtInt(result.rankProv)} 名，按各专业组最近一年的投档位次对照`;
  const perYear = Object.keys(data.tables)
    .sort()
    .reverse()
    .map((y) => `${y} 年 ${data.tables[y].rows.length} 组`)
    .join(' · ');
  el.recNote.textContent =
    `已收录：${perYear}；参与排序 ${rec.total} 个专业组（只用最近两年有数据的组），按各组最新一年位次排。` +
    '投档线是专业组最低分，组内热门专业实际要更高；数据仅供定位，填报前务必核对官方计划本。';
  fillRecList(el.recReach, rec.reach, result, 'reach');
  fillRecList(el.recSafe, rec.safe, result, 'safe');
}

function fillRecList(ul, items, result, kind) {
  if (!items.length) {
    ul.innerHTML = '<li class="rec-empty">这一段还没有收录数据</li>';
    return;
  }
  ul.innerHTML = items
    .map((g) => {
      const dRank = g.rank - result.rankProv;
      const dScore = Math.round(result.scoreProv - g.score);
      const other = [2026, 2025, 2024]
        .filter((y) => y !== g.latestYear)
        .map((y) => `${y} ${g.years[y] ? g.years[y].score : '—'}`)
        .join(' · ');
      return `<li>
        <div class="n">${escapeHtml(g.school)} <span class="grp">组${g.group}</span></div>
        <div class="m">${g.latestYear} 投档 ${g.score} 分 · 第 ${fmtInt(g.rank)} 名</div>
        <div class="d ${kind === 'reach' ? 'neg' : 'pos'}">位次差 ${dRank > 0 ? '+' : ''}${fmtInt(dRank)} · 分数差 ${dScore > 0 ? '+' : ''}${dScore}</div>
        <div class="h">往年 ${other}</div>
      </li>`;
    })
    .join('');
}

function renderCompare(model) {
  if (!compare.length) {
    el.compareBody.innerHTML = '<tr><td colspan="6" class="empty">还没有人，点上面的「＋ 加入对比」</td></tr>';
    return;
  }
  const rows = compare
    .map((p, idx) => ({ p, idx, r: convert({ score: p.score, rank: p.rank ?? '' }, model.params, model) }))
    .sort((a, b) => a.r.rankProv - b.r.rankProv);

  el.compareBody.innerHTML = rows
    .map(({ p, idx, r }) => {
      const me =
        String(p.score) === String(el.score.value) &&
        String(p.rank ?? '') === String(el.rank.value);
      return `<tr class="${me ? 'me ' : ''}tap" data-i="${idx}">
        <td>${escapeHtml(p.name)}</td>
        <td>${r.score} / ${fmtInt(r.rank)}${r.rankInferred ? '<span class="inferred">反推</span>' : ''}</td>
        <td>${fmtInt(r.rankProv)}</td>
        <td><b>${Math.round(r.scoreProv)}</b></td>
        <td class="${r.delta >= 0 ? 'pos' : 'neg'}">${signed(r.delta)}</td>
        <td><button class="del" data-del="${idx}" aria-label="删除">✕</button></td>
      </tr>`;
    })
    .join('');
}

function renderLookup(model, result) {
  const rows = lookupTable(model);
  el.lookupBody.innerHTML = rows
    .map((r) => {
      const me = Math.abs(r.score - result.score) < 0.5;
      return `<tr class="${me ? 'me ' : ''}tap" data-score="${r.score}" data-rank="${Math.round(r.rank)}">
        <td>${r.score}</td>
        <td>${fmtInt(r.rank)}</td>
        <td>${fmtInt(r.rankProv)}</td>
        <td><b>${Math.round(r.scoreProv)}</b></td>
        <td class="${r.delta >= 0 ? 'pos' : 'neg'}">${signed(r.delta)}</td>
      </tr>`;
    })
    .join('');
}

function renderSteps(params, model, result) {
  const { mock, gk, dropPp } = params;
  const items = [
    `市上线率 = 省 <code>${pct(gk.lineRank / gk.total, 2)}</code> − <code>${fmt1(dropPp * 100)}pp</code> = <b>${pct(model.rate, 2)}</b>`,
    `模考市线 = <code>${pct(model.rate, 2)} × ${fmtInt(mock.total)}</code> = <b>第 ${fmtInt(model.lineRankMock)} 名</b> → 模考 <b>${model.cityScore.toFixed(1)} 分</b>（官方划的是 ${mock.lineScore} 分 / 第 ${fmtInt(mock.lineRank)} 名）`,
    `倍率 = <code>${fmtInt(gk.lineRank)} ÷ ${fmtInt(model.lineRankMock)}</code> = <b>×${model.k.toFixed(2)}</b> → ${fmtInt(result.rank)} 名 ≈ 全省 <b>${fmtInt(result.rankProv)} 名</b>（前 ${pct(result.topPctProv)}）`,
    `平移 = <code>${gk.lineScore} − ${model.cityScore.toFixed(1)}</code> = <b>+${model.offset.toFixed(1)} 分</b> → ${result.score} + ${model.offset.toFixed(1)} = <b>${result.scoreProv.toFixed(1)} 分</b>`,
    `区间：下调 ${fmt1(dropPp * 100 - params.bandPp * 100)}–${fmt1(dropPp * 100 + params.bandPp * 100)} 个百分点 → <b>${Math.round(result.scoreWorst)}–${Math.round(result.scoreBest)} 分</b>`,
  ];
  el.steps.innerHTML = items.map((t) => `<li>${t}</li>`).join('');
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

/* ---------- 交互 ---------- */

function showError(msg) {
  el.err.textContent = msg;
  el.err.hidden = false;
}
function hideError() {
  el.err.hidden = true;
}

function loadPerson(p) {
  el.name.value = p.name;
  el.score.value = String(p.score);
  el.rank.value = String(p.rank);
  render();
}

function addCurrent() {
  let params, model, result;
  try {
    params = readParams();
    model = makeModel(params);
    result = convert(currentInput(), params, model);
  } catch (e) {
    showError(e.message);
    return;
  }
  const p = {
    name: currentInput().name || '你',
    score: result.score,
    rank: result.input.rank ? Math.round(result.input.rank) : null,
  };
  const dup = compare.some((c) => Number(c.rank ?? 0) === Number(p.rank ?? 0) && Number(c.score) === p.score);
  if (dup) {
    flash(el.btn.add, '已经在列表里');
    return;
  }
  compare.push(p);
  saveStore(STORE.compare, compare);
  render();
  flash(el.btn.add, '已加入');
}

const flashTimers = new WeakMap();

function flash(btn, text) {
  if (!btn.dataset.label) btn.dataset.label = btn.textContent;
  btn.textContent = text;
  btn.classList.add('done');
  clearTimeout(flashTimers.get(btn));
  flashTimers.set(
    btn,
    setTimeout(() => {
      btn.textContent = btn.dataset.label;
      btn.classList.remove('done');
    }, 1200)
  );
}

function parseImport(text) {
  const out = [];
  for (const line of text.split(/\n+/)) {
    const t = line.trim();
    if (!t) continue;
    const parts = t.split(/[\s,，、]+/).filter(Boolean);
    if (!parts.length) continue;

    const nums = parts.filter((x) => /^\d+(\.\d+)?$/.test(x)).map(Number);
    let name = null;
    let score = null;
    let rank = null;

    if (nums.length === parts.length) {
      // 全是数字：至少一个
      score = nums[0];
      if (nums.length >= 2) rank = nums[1];
    } else {
      // 第一段当名字，后面取数字
      name = parts[0];
      const rest = parts.slice(1).filter((x) => /^\d+(\.\d+)?$/.test(x)).map(Number);
      if (!rest.length) continue;
      score = rest[0];
      if (rest.length >= 2) rank = rest[1];
    }
    if (!Number.isFinite(score)) continue;
    out.push({ name: name || `同学${out.length + 1}`, score, rank });
  }
  return out;
}

function doImport() {
  const list = parseImport(el.importText.value);
  if (!list.length) {
    showError('没解析到数据，格式：姓名 分数 位次（姓名可省）');
    return;
  }
  hideError();
  let added = 0;
  for (const p of list) {
    if (compare.some((c) => Number(c.rank ?? 0) === Number(p.rank ?? 0) && Number(c.score) === p.score)) continue;
    compare.push(p);
    added++;
  }
  saveStore(STORE.compare, compare);
  el.importText.value = '';
  render();
  flash(el.btn.import, `导入 ${added} 人`);
}

function buildText(params, model, result) {
  const gk = params.gk;
  return [
    `${result.input.name || '你'}：模考 ${result.score} 分 / 第 ${fmtInt(result.rank)} 名${result.rankInferred ? '（位次由分数反推）' : ''}`,
    `市上线率 ${pct(model.rate)}（省 ${pct(gk.lineRank / gk.total)} − ${fmt1(params.dropPp * 100)}pp）`,
    `→ 全省等效位次约 ${fmtInt(result.rankProv)} 名`,
    `→ 高考等效分约 ${Math.round(result.scoreProv)}（区间 ${Math.round(result.scoreWorst)}–${Math.round(result.scoreBest)}）`,
    `→ 与特控线 ${gk.lineScore} 相比：${signed(result.delta)} 分`,
  ].join('\n');
}

async function copyResult() {
  let params, model, result;
  try {
    params = readParams();
    model = makeModel(params);
    result = convert(currentInput(), params, model);
    result.input.name = currentInput().name || '你';
  } catch (e) {
    showError(e.message);
    return;
  }
  const text = buildText(params, model, result);
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
  flash(el.btn.copy, '已复制');
}

async function exportImage() {
  let params, model, result;
  try {
    params = readParams();
    model = makeModel(params);
    result = convert(currentInput(), params, model);
    result.input.name = currentInput().name || '你';
  } catch (e) {
    showError(e.message);
    return;
  }
  const svg = buildCardSVG({
    model,
    result,
    dateStr: new Date().toLocaleDateString('zh-CN') + ' 生成',
  });
  flash(el.btn.export, '生成中…');
  const kind = await downloadCard(svg, `${result.input.name || '换算'}-${Math.round(result.scoreProv)}分`);
  flash(el.btn.export, kind === 'png' ? '已保存' : '已存 SVG');
}

function resetAll() {
  const d = DEFAULT_PARAMS;
  el.name.value = '你';
  el.score.value = '500';
  el.rank.value = '3100';
  el.drop.value = String(d.dropPp * 100);
  $('p-mock-total').value = d.mock.total;
  $('p-mock-line-score').value = d.mock.lineScore;
  $('p-mock-line-rank').value = d.mock.lineRank;
  $('p-gk-total').value = d.gk.total;
  $('p-gk-line-score').value = d.gk.lineScore;
  $('p-gk-line-rank').value = d.gk.lineRank;
  hideError();
  render();
}

/* ---------- URL ---------- */

function syncURL(params, result) {
  const q = new URLSearchParams();
  q.set('score', String(result.score));
  if (!result.rankInferred) q.set('rank', String(result.rank));
  q.set('drop', String(params.dropPp * 100));
  if (result.input.name && result.input.name !== '你') q.set('name', result.input.name);
  try {
    history.replaceState(null, '', `?${q.toString()}`);
  } catch {
    /* file:// 下忽略 */
  }
}

function loadFromURL() {
  const q = new URLSearchParams(location.search);
  if (q.has('name')) el.name.value = q.get('name');
  if (q.has('score')) el.score.value = q.get('score');
  if (q.has('rank')) el.rank.value = q.get('rank');
  if (q.has('drop')) el.drop.value = q.get('drop');
}


/* ---------- 分数 / 位次 联动 ---------- */
/* 模考分和位次是同一条曲线上的两个坐标，改一个就把另一个算出来，
   否则改分数时下面的省位次、推荐都不会动（因为省位次只认位次）。 */

function syncRankFromScore() {
  if (el.rank.value === '') return; // 只填分数模式，别硬塞
  const score = Number(el.score.value);
  if (!Number.isFinite(score)) return;
  try {
    const model = makeModel(readParams());
    const r = model.curve.rankAt(score, true);
    if (Number.isFinite(r)) {
      el.rank.value = String(Math.round(Math.min(Math.max(r, 1), model.params.mock.total)));
    }
  } catch {
    /* 参数还没填好时忽略 */
  }
}

function syncScoreFromRank() {
  if (el.score.value === '') return; // 只填位次模式
  const rank = Number(el.rank.value);
  if (!Number.isFinite(rank) || rank <= 0) return;
  try {
    const model = makeModel(readParams());
    const sc = model.curve.scoreAt(rank);
    if (Number.isFinite(sc)) el.score.value = String(Math.round(sc));
  } catch {
    /* ignore */
  }
}

/* ---------- 启动 ---------- */

let raf = 0;
function schedule() {
  cancelAnimationFrame(raf);
  raf = requestAnimationFrame(render);
}

applyTheme(initialTheme());
compare = loadStore(STORE.compare, SAMPLES.map((s) => ({ ...s })));

[el.name, el.drop, ...PARAM_IDS.map($)].forEach((node) => {
  node.addEventListener('input', schedule);
});
el.score.addEventListener('input', () => {
  syncRankFromScore();
  schedule();
});
el.rank.addEventListener('input', () => {
  syncScoreFromRank();
  schedule();
});

el.btn.theme.addEventListener('click', () => {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  render();
});
el.btn.add.addEventListener('click', addCurrent);
el.btn.copy.addEventListener('click', copyResult);
el.btn.export.addEventListener('click', exportImage);
el.btn.reset.addEventListener('click', resetAll);
el.btn.clear.addEventListener('click', () => {
  compare = [];
  saveStore(STORE.compare, compare);
  render();
});
el.btn.import.addEventListener('click', doImport);

el.compareBody.addEventListener('click', (e) => {
  const del = e.target.closest('[data-del]');
  if (del) {
    compare.splice(Number(del.dataset.del), 1);
    saveStore(STORE.compare, compare);
    render();
    return;
  }
  const tr = e.target.closest('tr[data-i]');
  if (tr) loadPerson(compare[Number(tr.dataset.i)]);
});

el.lookupBody.addEventListener('click', (e) => {
  const tr = e.target.closest('tr[data-rank]');
  if (!tr) return;
  el.score.value = tr.dataset.score;
  el.rank.value = tr.dataset.rank;
  render();
});

const buildEl = document.getElementById('build-info');
if (buildEl) {
  const cnt = Object.keys(ADMISSIONS.tables)
    .sort()
    .reverse()
    .map((y) => `${y}×${ADMISSIONS.tables[y].rows.length}`)
    .join(' / ');
  buildEl.textContent = `数据 ${cnt} · 构建 ${BUILD}`;
}

loadFromURL();
render();

// 调试出口
window.__demo = { render, getCompare: () => compare };

  root.__SC_READY = true;
})(typeof globalThis !== 'undefined' ? globalThis : window);
