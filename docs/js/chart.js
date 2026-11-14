(function (root) {
  'use strict';

/* chart.js — 纯函数，输入数据，吐出 SVG 字符串（不碰 DOM，方便测试）
 *
 * 画布按手机宽度设计（380×300），放在页面上最多放大到 480px，
 * 导出长图时再整体放大，所以字号不会糊。
 */

const W = 320;
const H = 260;
const PAD = { l: 38, r: 10, t: 12, b: 38 };

const f = (n, d = 1) => Number(n).toFixed(d);
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');

const LIGHT = {
  bg: '#ffffff',
  grid: '#eceef4',
  gridSoft: '#f4f5f9',
  axisText: '#8b90a0',
  axisTitle: '#9aa0b0',
  curve: '#3b6ef5',
  line: '#e5484d',
  ok: '#0f9d58',
  warn: '#d98400',
  ink: '#1c2030',
  sub: '#9aa0b0',
};

/** 分数刻度：保证 10 的倍数，且落在 4~6 条之间 */
function scoreStep(span) {
  for (const st of [10, 20, 25, 50, 100, 200]) {
    if (span / st <= 5) return st;
  }
  return 200;
}

function chartSVG({ model, result, theme, inner = false }) {
  const t = { ...LIGHT, ...(theme || {}) };
  const { params, scoreAtProvince } = model;
  const { gk } = params;

  const xMax = Math.min(120000, Math.max(70000, Math.ceil((result.rankWorst * 1.25) / 10000) * 10000));
  const pw = W - PAD.l - PAD.r;
  const ph = H - PAD.t - PAD.b;

  const focus = [result.scoreBest, result.scoreWorst, gk.lineScore, model.cityScore];
  let yMin = Math.floor((Math.min(...focus) - 24) / 10) * 10;
  let yMax = Math.ceil((Math.max(...focus) + 24) / 10) * 10;
  if (yMax - yMin < 80) {
    const mid = (yMax + yMin) / 2;
    yMin = Math.floor((mid - 40) / 10) * 10;
    yMax = Math.ceil((mid + 40) / 10) * 10;
  }

  const px = (r) => PAD.l + (Math.min(Math.max(r, 0), xMax) / xMax) * pw;
  const py = (s) => PAD.t + (1 - (s - yMin) / (yMax - yMin)) * ph;

  const out = [];
  if (!inner) {
    out.push(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="模考位次到高考等效分的换算曲线">`,
      `<rect x="0" y="0" width="${W}" height="${H}" fill="${t.bg}"/>`
    );
  }

  // 分数刻度
  out.push(`<text x="${PAD.l - 8}" y="${PAD.t - 4}" text-anchor="end" font-size="9.5" fill="${t.axisTitle}">分</text>`);
  const yStep = scoreStep(yMax - yMin);
  for (let v = Math.ceil(yMin / yStep) * yStep; v <= yMax; v += yStep) {
    const y = py(v);
    out.push(`<line x1="${PAD.l}" y1="${f(y)}" x2="${PAD.l + pw}" y2="${f(y)}" stroke="${t.grid}"/>`);
    out.push(`<text x="${PAD.l - 6}" y="${f(y + 3.5)}" text-anchor="end" font-size="10.5" fill="${t.axisText}">${v}</text>`);
  }

  // 位次刻度
  for (let v = 0; v <= xMax; v += 20000) {
    const x = px(v);
    out.push(`<line x1="${f(x)}" y1="${PAD.t}" x2="${f(x)}" y2="${PAD.t + ph}" stroke="${t.gridSoft}"/>`);
    out.push(
      `<text x="${f(x)}" y="${PAD.t + ph + 13}" text-anchor="middle" font-size="10.5" fill="${t.axisText}">${v === 0 ? '0' : (v / 10000).toFixed(0) + '万'}</text>`
    );
  }
  out.push(
    `<text x="${PAD.l + pw / 2}" y="${H - 5}" text-anchor="middle" font-size="10.5" fill="${t.axisTitle}">全省等效位次</text>`
  );

  // 曲线
  const pts = [];
  for (let i = 0; i <= 200; i++) {
    const r = (xMax * i) / 200;
    const s = scoreAtProvince(r);
    if (s >= yMin - 20 && s <= yMax + 20) pts.push(`${f(px(r))},${f(py(s))}`);
  }
  if (pts.length > 1) {
    out.push(`<polyline points="${pts.join(' ')}" fill="none" stroke="${t.curve}" stroke-width="2.4" stroke-linejoin="round"/>`);
  }

  // 省特控线
  const xl = px(gk.lineRank);
  const yl = py(gk.lineScore);
  out.push(
    `<line x1="${f(xl)}" y1="${PAD.t}" x2="${f(xl)}" y2="${PAD.t + ph}" stroke="${t.line}" stroke-width="1.4" stroke-dasharray="4 3"/>`,
    `<circle cx="${f(xl)}" cy="${f(yl)}" r="3.6" fill="${t.line}"/>`,
    `<text x="${f(xl - 4)}" y="${PAD.t + 9}" text-anchor="end" font-size="10" fill="${t.line}">特控线 ${gk.lineScore}</text>`
  );

  // 考生
  const c = result.online ? t.ok : t.warn;
  const cx = px(result.rankProv);
  const cy = py(result.scoreProv);
  const left = result.rankProv < gk.lineRank;
  const tx = left ? cx - 10 : cx + 10;
  const anchor = left ? 'end' : 'start';
  out.push(
    `<rect x="${f(px(result.rankBest))}" y="${PAD.t}" width="${f(Math.max(px(result.rankWorst) - px(result.rankBest), 2))}" height="${ph}" fill="${c}" opacity="0.12"/>`,
    `<circle cx="${f(cx)}" cy="${f(cy)}" r="9" fill="${c}" opacity="0.16"/>`,
    `<circle cx="${f(cx)}" cy="${f(cy)}" r="4.6" fill="${c}"/>`,
    `<text x="${f(tx)}" y="${f(cy - 6)}" text-anchor="${anchor}" font-size="10.5" font-weight="600" fill="${c}">${esc(result.input.name || '你')}</text>`,
    `<text x="${f(tx)}" y="${f(cy + 7)}" text-anchor="${anchor}" font-size="10" fill="${c}">${Math.round(result.scoreProv)} 分</text>`
  );

  if (!inner) out.push('</svg>');
  return out.join('');
}

  root.SC = Object.assign(root.SC || {}, {
    chartSVG,
  });
})(typeof globalThis !== 'undefined' ? globalThis : window);
