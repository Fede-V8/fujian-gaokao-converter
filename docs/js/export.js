(function (root) {
  'use strict';

  const { chartSVG } = root.SC;

/* export.js — 生成一张可分享的长图（SVG → canvas → PNG），无第三方依赖 */


const W = 720;
const H = 1060;

const CARD_THEME = {
  bg: '#ffffff',
  ink: '#12151c',
  ink2: '#3c4353',
  muted: '#6b7280',
  dim: '#9aa0b0',
  line: '#e7e9f1',
  grid: '#eceef4',
  gridSoft: '#f4f5f9',
  accent: '#3b6ef5',
  axisText: '#8b90a0',
  axisTitle: '#9aa0b0',
  curve: '#3b6ef5',
  lineColor: '#e5484d',
  ok: '#0f9d58',
  warn: '#d98400',
  sub: '#9aa0b0',
};

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function text(x, y, str, { size = 14, fill = CARD_THEME.ink, weight = 400, anchor = 'start' } = {}) {
  return `<text x="${x}" y="${y}" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}">${esc(str)}</text>`;
}

/** 拼出分享长图（浅色固定配色，便于发出去看） */
function buildCardSVG({ model, result, dateStr }) {
  const { params } = model;
  const gk = params.gk;
  const name = result.input.name || '考生';
  const ok = result.online;
  const accent = ok ? CARD_THEME.ok : CARD_THEME.warn;

  // 图：内嵌一份（坐标系 880×420）
  const inner = chartSVG({
    model,
    result,
    inner: true,
    theme: {
      bg: '#ffffff',
      grid: CARD_THEME.grid,
      gridSoft: CARD_THEME.gridSoft,
      axisText: CARD_THEME.axisText,
      axisTitle: CARD_THEME.axisTitle,
      curve: CARD_THEME.curve,
      line: CARD_THEME.lineColor,
      ok: CARD_THEME.ok,
      warn: CARD_THEME.warn,
      ink: CARD_THEME.ink,
      sub: CARD_THEME.sub,
    },
  });

  const stats = [
    ['全省等效位次', `${Math.round(result.rankProv).toLocaleString('zh-CN')} 名`],
    ['与特控线相比', `${result.delta >= 0 ? '+' : ''}${Math.round(result.delta)} 分`],
    ['市内百分位', `前 ${(result.topPct * 100).toFixed(1)}%`],
    ['模考市线', `${Math.round(model.cityScore)} 分 · 第 ${Math.round(model.lineRankMock).toLocaleString('zh-CN')} 名`],
  ];

  const out = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="-apple-system, 'PingFang SC', 'Microsoft YaHei', sans-serif">`);
  out.push(`<rect width="${W}" height="${H}" fill="${CARD_THEME.bg}"/>`);
  out.push(`<rect x="0" y="0" width="${W}" height="8" fill="${CARD_THEME.accent}"/>`);

  out.push(text(44, 62, '模考 → 高考 换算结果', { size: 26, weight: 700 }));
  out.push(
    text(44, 90, `宁德物理类 · 市上线率下调 ${(params.dropPp * 100).toFixed(1)} 个百分点`, {
      size: 14,
      fill: CARD_THEME.muted,
    })
  );

  // 大字
  out.push(text(44, 196, `${Math.round(result.scoreProv)}`, { size: 104, weight: 700, fill: CARD_THEME.ink }));
  out.push(text(208, 196, '分', { size: 24, fill: CARD_THEME.muted }));
  if (result.scoreInferred) {
    out.push(text(240, 196, '（由位次反推）', { size: 13, fill: CARD_THEME.dim }));
  }

  out.push(
    text(
      44,
      238,
      `${name}：模考 ${result.score} 分 / 第 ${Math.round(result.rank).toLocaleString('zh-CN')} 名${result.rankInferred ? '（位次反推）' : ''}`,
      { size: 16, fill: CARD_THEME.ink2 }
    )
  );
  out.push(
    text(44, 266, `${result.delta >= 0 ? '高于' : '低于'}特控线 ${Math.abs(Math.round(result.delta))} 分（${gk.lineScore}）`, {
      size: 17,
      weight: 650,
      fill: accent,
    })
  );

  // 四个指标
  const cols = [44, 380];
  stats.forEach(([k, v], i) => {
    const x = cols[i % 2];
    const y = 316 + Math.floor(i / 2) * 62;
    out.push(text(x, y, k, { size: 12, fill: CARD_THEME.dim }));
    out.push(text(x, y + 26, v, { size: 21, weight: 650 }));
  });

  // 分隔线 + 图
  out.push(`<line x1="44" y1="432" x2="${W - 44}" y2="432" stroke="${CARD_THEME.line}"/>`);
  out.push(`<svg x="80" y="440" width="560" height="455" viewBox="0 0 320 260">${inner}</svg>`);

  // 底部说明
  out.push(text(44, 930, '位次口径换算（市上线率比全省低 5~7 个百分点），仅供定位参考，不替代志愿填报决策。', {
    size: 11.5,
    fill: CARD_THEME.dim,
  }));
  out.push(
    text(44, 962, `模考市线 ${model.cityScore.toFixed(1)} 分 · 倍率 ×${model.k.toFixed(2)} · 平移 +${model.offset.toFixed(1)} 分`, {
      size: 12.5,
      fill: CARD_THEME.muted,
    })
  );
  out.push(text(44, 986, `区间 ${Math.round(result.scoreWorst)}–${Math.round(result.scoreBest)} 分`, { size: 12.5, fill: CARD_THEME.muted }));
  out.push(text(44, 1030, dateStr || '', { size: 11.5, fill: CARD_THEME.dim }));

  out.push('</svg>');
  return out.join('');
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('SVG 载入失败'));
    img.src = url;
  });
}

function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/** SVG → PNG 下载；失败则退化成下载 SVG */
async function downloadCard(svg, filenameBase = '换算结果', scale = 2) {
  const svgBlob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(svgBlob);
  try {
    const img = await loadImage(url);
    const canvas = document.createElement('canvas');
    canvas.width = W * scale;
    canvas.height = H * scale;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const png = await new Promise((res) => canvas.toBlob(res, 'image/png'));
    if (!png) throw new Error('toBlob 失败');
    saveBlob(png, `${filenameBase}.png`);
    return 'png';
  } catch (e) {
    saveBlob(svgBlob, `${filenameBase}.svg`);
    return 'svg';
  } finally {
    URL.revokeObjectURL(url);
  }
}

  root.SC = Object.assign(root.SC || {}, {
    buildCardSVG,
    downloadCard,
  });
})(typeof globalThis !== 'undefined' ? globalThis : window);
