(function (root) {
  'use strict';

  const BUILD = '2026-11-15 01:05';

/* core.js — 纯算法层，不碰 DOM。
 *
 * 想把 demo 换成你自己的数据，只需要改 DEFAULT_PARAMS 和 SAMPLES 两处。
 * 算法与 score_converter.py 一致，数值由 tests/verify.mjs 对拍。
 */

const DEFAULT_PARAMS = {
  // 模考盘子
  mock: { total: 15000, lineScore: 466, lineRank: 4600 },
  // 高考盘子
  gk: { total: 195315, lineScore: 528, lineRank: 58019 },  // 2026 官方一分一段：528→58,019；≥215 分共 195,315 人
  // 已知模考锚点：[分数, 位次]，用来构造本地的“分数—位次”曲线
  anchors: [
    [500, 3100],
    [493, 3500],
    [466, 4600],
    [460, 4800],
  ],
  // 市上线率比全省低多少（百分点的小数：0.06 = 6 个百分点）
  dropPp: 0.06,
  // 结果区间的半宽（±1 个百分点）
  bandPp: 0.01,
};

const SAMPLES = [
  { name: '你', score: 500, rank: 3100 },
  { name: '同学A', score: 493, rank: 3500 },
  { name: '朋友', score: 460, rank: 4800 },
];

const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);

/** 浅合并参数（mock / gk 两层） */
function mergeParams(base, over = {}) {
  return {
    ...base,
    ...over,
    mock: { ...base.mock, ...(over.mock || {}) },
    gk: { ...base.gk, ...(over.gk || {}) },
  };
}

/* ---------- 1. 市上线率 ---------- */

function cityRate(gk, dropPp) {
  const r = gk.lineRank / gk.total - dropPp;
  if (!(r > 0)) throw new Error('下调后市上线率必须为正');
  return r;
}

function cityLineRank(mock, gk, dropPp) {
  return cityRate(gk, dropPp) * mock.total;
}

function multiplier(mock, gk, dropPp) {
  return gk.lineRank / cityLineRank(mock, gk, dropPp);
}

function provincialRank(rank, mock, gk, dropPp) {
  return clamp(rank * multiplier(mock, gk, dropPp), 1, gk.total);
}

/* ---------- 2. 模考曲线（分段线性） ---------- */

function buildCurve(anchors) {
  const pts = anchors
    .map(([score, rank]) => ({ score: Number(score), rank: Number(rank) }))
    .sort((a, b) => a.rank - b.rank);

  if (pts.length < 2) throw new Error('至少需要 2 个模考锚点');
  for (let i = 1; i < pts.length; i++) {
    if (!(pts[i - 1].score > pts[i].score)) {
      throw new Error(
        `锚点分数必须随位次递减：第 ${pts[i - 1].rank} 名 ${pts[i - 1].score} 分 → 第 ${pts[i].rank} 名 ${pts[i].score} 分`
      );
    }
  }

  function scoreAt(rank, extrapolate = false) {
    const first = pts[0];
    const last = pts[pts.length - 1];

    if (rank <= first.rank) {
      if (!extrapolate) return first.score;
      const a = pts[0];
      const b = pts[1];
      return a.score + ((rank - a.rank) * (b.score - a.score)) / (b.rank - a.rank);
    }
    if (rank >= last.rank) {
      if (!extrapolate) return last.score;
      const a = pts[pts.length - 2];
      const b = last;
      return b.score + ((rank - b.rank) * (b.score - a.score)) / (b.rank - a.rank);
    }
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      if (rank <= b.rank) {
        const t = (rank - a.rank) / (b.rank - a.rank);
        return a.score + t * (b.score - a.score);
      }
    }
    return last.score;
  }

  /** 分数 → 模考位次（分段线性反解） */
  /** 分数 → 模考位次。extrapolate=true 时按端点斜率线性外推 */
  function rankAt(score, extrapolate = false) {
    const first = pts[0];
    const last = pts[pts.length - 1];

    if (score >= first.score) {
      if (!extrapolate) return first.rank;
      const a = pts[0];
      const b = pts[1];
      return a.rank + ((score - a.score) * (b.rank - a.rank)) / (b.score - a.score);
    }
    if (score <= last.score) {
      if (!extrapolate) return last.rank;
      const a = pts[pts.length - 2];
      const b = last;
      return b.rank + ((score - b.score) * (b.rank - a.rank)) / (b.score - a.score);
    }
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i]; // a.rank < b.rank, a.score > b.score
      if (score <= a.score && score >= b.score) {
        const t = (score - a.score) / (b.score - a.score);
        return a.rank + t * (b.rank - a.rank);
      }
    }
    return last.rank;
  }

  /** 锚点覆盖的分数区间，用来判断是否外推 */
  const scoreRange = { low: pts[pts.length - 1].score, high: pts[0].score };

  return { pts, scoreAt, rankAt, scoreRange };
}

/* ---------- 3. 模型：公共量一次算好 ---------- */

function makeModel(params = DEFAULT_PARAMS) {
  const p = mergeParams(DEFAULT_PARAMS, params);
  const { mock, gk, dropPp } = p;

  if (!(mock.total > 0) || !(gk.total > 0)) throw new Error('人数必须为正');
  if (!(mock.lineRank > 0 && mock.lineRank <= mock.total)) throw new Error('模考线位次超出人数范围');
  if (!(gk.lineRank > 0 && gk.lineRank <= gk.total)) throw new Error('高考线位次超出人数范围');
  if (!(dropPp >= 0 && dropPp < 0.2)) throw new Error('下调幅度需在 0 – 20 个百分点之间');

  const curve = buildCurve(p.anchors);
  const rate = cityRate(gk, dropPp);
  const lineRankMock = cityLineRank(mock, gk, dropPp);
  const cityScore = curve.scoreAt(lineRankMock);
  const offset = gk.lineScore - cityScore;
  const k = multiplier(mock, gk, dropPp);

  return {
    params: p,
    curve,
    rate,
    lineRankMock,
    cityScore,
    offset,
    k,
    // 全省位次 → 等效分（画图用）
    scoreAtProvince: (rProv) => curve.scoreAt(rProv / k, true) + offset,
  };
}

/** 按模考分数区间生成一张换算表（分数 → 位次 → 省位次 → 等效分） */
function lookupTable(model, { from, to, step = 5 } = {}) {
  const { curve, params, offset } = model;
  // 只覆盖有锚点的区间，超出范围不外推，避免给出没依据的分数
  const lo = from ?? curve.pts[curve.pts.length - 1].score;
  const hi = to ?? curve.pts[0].score;
  const rows = [];
  for (let s = hi; s >= lo; s -= step) {
    const rank = curve.rankAt(s);
    if (!Number.isFinite(rank) || rank < 1 || rank > params.mock.total) continue;
    rows.push({
      score: s,
      rank,
      rankProv: provincialRank(rank, params.mock, params.gk, params.dropPp),
      scoreProv: s + offset,
      delta: s + offset - params.gk.lineScore,
      online: rank / params.mock.total <= model.rate,
    });
  }
  return rows;
}

/* ---------- 4. 单人换算 ---------- */

function convert(input, params = DEFAULT_PARAMS, model = null) {
  const m = model || makeModel(params);
  const { mock, gk, dropPp, bandPp } = m.params;

  const rawScore = input.score;
  const rawRank = input.rank;
  const hasScore = rawScore !== '' && rawScore != null && rawScore !== undefined && Number.isFinite(Number(rawScore));
  const rankNum = Number(rawRank);
  const hasRank = rawRank !== '' && rawRank != null && rawRank !== undefined && Number.isFinite(rankNum) && rankNum > 0;

  if (!hasScore && !hasRank) throw new Error('分数和位次至少填一个');
  if (hasRank && rankNum > mock.total) {
    throw new Error(`模考位次需在 1 – ${mock.total.toLocaleString('zh-CN')} 之间`);
  }

  let score;
  let rank;
  let rankInferred = false;
  let scoreInferred = false;

  if (hasRank) {
    rank = rankNum;
    if (hasScore) {
      score = Number(rawScore);
    } else {
      score = m.curve.scoreAt(rank);
      scoreInferred = true;
    }
  } else {
    score = Number(rawScore);
    rank = clamp(m.curve.rankAt(score, true), 1, mock.total);
    rankInferred = true;
  }

  const range = m.curve.scoreRange;
  const extrapolated = score < range.low || score > range.high;

  const offsetAt = (d) => gk.lineScore - m.curve.scoreAt(cityLineRank(mock, gk, d));
  const lo = clamp(dropPp + bandPp, 0, 0.19); // 下调更多 → 位次更差、分数更低
  const hi = clamp(dropPp - bandPp, 0, 0.19);

  const rankProv = provincialRank(rank, mock, gk, dropPp);

  return {
    input: { score: hasScore ? score : null, rank: hasRank ? rank : null },
    scoreInferred,
    rankInferred,
    score,
    rank,
    extrapolated,
    range,
    dropPp,
    rate: m.rate,
    lineRankMock: m.lineRankMock,
    cityScore: m.cityScore,
    offset: m.offset,
    k: m.k,
    rankProv,
    rankBest: provincialRank(rank, mock, gk, hi),
    rankWorst: provincialRank(rank, mock, gk, lo),
    scoreProv: score + m.offset,
    scoreBest: score + offsetAt(hi),
    scoreWorst: score + offsetAt(lo),
    topPct: rank / mock.total,
    topPctProv: rankProv / gk.total,
    online: rank / mock.total <= m.rate,
    gapRank: m.lineRankMock - rank,
    delta: score + m.offset - gk.lineScore,
  };
}

/** 把多年的投档线表合并成记录：同一 学校+专业组 归到一条，年份挂在 years 下 */
function buildRecords(admissions) {
  const tables = (admissions && admissions.tables) || {};
  const map = new Map();
  const years = Object.keys(tables).map(Number).sort((a, b) => a - b);
  // 校名变更：2024 年还叫「闽江学院」
  const ALIAS = { 闽江学院: '闽江大学' };
  for (const y of years) {
    for (const r of tables[y].rows) {
      const key = (ALIAS[r[0]] || r[0]) + '|' + r[1];
      let rec = map.get(key);
      if (!rec) {
        rec = { school: r[0], group: r[1], nature: r[4] || '', years: {} };
        map.set(key, rec);
      }
      if (r[4] && !rec.nature) rec.nature = r[4];
      rec.school = r[0]; // 年份升序遍历，最后写入的即最新校名
      rec.years[y] = { score: r[2], rank: r[3] };
    }
  }
  const out = [];
  for (const rec of map.values()) {
    const ys = Object.keys(rec.years).map(Number).sort((a, b) => b - a);
    rec.latestYear = ys[0];
    rec.score = rec.years[ys[0]].score;
    rec.rank = rec.years[ys[0]].rank;
    rec.yearList = ys;
    out.push(rec);
  }
  return out;
}

/** 按省位次给出「冲 / 稳」各 n 个专业组（用每个专业组最近一年的位次排序）
 *  冲：最近一年投档位次比你更靠前（更难），取最接近的
 *  稳：位次比你靠后（更松），取最接近的
 */
function recommendGroups(rankProv, admissions, n = 5, year = null) {
  const all = buildRecords(admissions);
  if (!all.length || !Number.isFinite(rankProv)) {
    return { reach: [], safe: [], total: 0, year: null };
  }
  const newestYear = Math.max(...Object.keys(admissions.tables).map(Number));

  let records;
  let useYear = newestYear;
  if (year) {
    // 指定年份：只保留该年有数据的组，按该年位次排序
    useYear = Number(year);
    records = all
      .filter((r) => r.years[useYear])
      .map((r) => ({ ...r, score: r.years[useYear].score, rank: r.years[useYear].rank }));
  } else {
    // 最新口径：每组用自己最近一年的数据，且只保留最近两年有数据的组
    records = all.filter((r) => r.latestYear >= newestYear - 1);
  }

  const reach = records.filter((g) => g.rank < rankProv).sort((a, b) => (year ? b.rank - a.rank : b.rank - a.rank)).slice(0, n);
  const safe = records.filter((g) => g.rank >= rankProv).sort((a, b) => a.rank - b.rank).slice(0, n);
  return { reach, safe, total: records.length, year: year ? useYear : null, newestYear };
}

/** 按省位次给出「冲 / 稳」各 n 个专业（默认 2025 年分专业数据） */
function recommendMajors(rankProv, majors, n = 5, year = 2025) {
  const table = majors && majors[year];
  if (!table || !table.rows || !table.rows.length || !Number.isFinite(rankProv)) {
    return { reach: [], safe: [], total: 0, year, schools: [] };
  }
  const list = table.rows.map((r) => ({ school: r[0], group: r[1], major: r[2], score: r[3], rank: r[4] }));
  const reach = list.filter((m) => m.rank < rankProv).sort((a, b) => b.rank - a.rank).slice(0, n);
  const safe = list.filter((m) => m.rank >= rankProv).sort((a, b) => a.rank - b.rank).slice(0, n);
  return { reach, safe, total: list.length, year, schools: table.schools || [] };
}

  root.SC = Object.assign(root.SC || {}, {
    DEFAULT_PARAMS,
    BUILD,
    SAMPLES,
    mergeParams,
    cityRate,
    cityLineRank,
    multiplier,
    provincialRank,
    buildCurve,
    makeModel,
    lookupTable,
    convert,
    recommendGroups,
    recommendMajors,
    buildRecords,
  });
})(typeof globalThis !== 'undefined' ? globalThis : window);
