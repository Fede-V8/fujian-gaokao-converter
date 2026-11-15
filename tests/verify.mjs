/* tests/verify.mjs — 用 Python 版算出的参考值对拍 JS 实现
 *
 * 运行：node tests/verify.mjs
 * 参考值来自 score_converter.py（36 个单测覆盖），确保网页与脚本结果一致。
 */

import fs from 'node:fs';
import vm from 'node:vm';

// core.js 现在是经典脚本，直接在当前上下文里执行
const load = (name) =>
  vm.runInThisContext(fs.readFileSync(new URL(`../docs/js/${name}`, import.meta.url), 'utf8'), { filename: name });
load('core.js');
load('admissions.js');
load('majors.js');

const { makeModel, convert, lookupTable, recommendGroups, recommendMajors, buildRecords, ADMISSIONS, MAJORS, DEFAULT_PARAMS } = globalThis.SC;

let failed = 0;
let passed = 0;

function near(label, actual, expected, tol) {
  const ok = Math.abs(actual - expected) <= tol;
  if (ok) {
    passed++;
  } else {
    failed++;
    console.log(`  ✗ ${label}: 实际 ${actual}，期望 ${expected} ±${tol}`);
  }
}

function eq(label, actual, expected) {
  const ok = actual === expected;
  if (ok) passed++;
  else {
    failed++;
    console.log(`  ✗ ${label}: 实际 ${actual}，期望 ${expected}`);
  }
}

/* ---- 1. 模型公共量（drop = 6 个百分点）---- */
console.log('模型公共量');
{
  const m = makeModel({ dropPp: 0.06 });
  near('市上线率', m.rate, 0.237053, 1e-6);
  near('市线名次', m.lineRankMock, 3555.80, 0.5);
  near('模考市线分', m.cityScore, 491.630, 0.05);
  near('平移量', m.offset, 36.370, 0.05);
  near('倍率', m.k, 16.316712, 0.002);
}

/* ---- 2. 三个样本（drop = 6pp）---- */
console.log('样本换算');
const cases = [
  ['你', 500, 3100, 50581.81, 536.370],
  ['同学A', 493, 3500, 57108.49, 529.370],
  ['朋友', 460, 4800, 78320.22, 496.370],
];
for (const [name, score, rank, expRank, expScore] of cases) {
  const r = convert({ score, rank }, { dropPp: 0.06 });
  near(`${name} 省位次`, r.rankProv, expRank, 1.0);
  near(`${name} 等效分`, r.scoreProv, expScore, 0.05);
}

/* ---- 3. 区间（5~7 个百分点）---- */
console.log('区间');
{
  const r = convert({ score: 500, rank: 3100 }, { dropPp: 0.06 });
  near('最好分 (5pp)', r.scoreBest, 540.05, 0.05);
  near('最差分 (7pp)', r.scoreWorst, 533.35, 0.05);
  near('最好位次 (5pp)', r.rankBest, 48534.4, 1.0);
  near('最差位次 (7pp)', r.rankWorst, 52809.6, 1.0);
}

/* ---- 4. 上线判定 ---- */
console.log('判定');
{
  const me = convert({ score: 500, rank: 3100 }, { dropPp: 0.06 });
  const a = convert({ score: 493, rank: 3500 }, { dropPp: 0.06 });
  const fr = convert({ score: 460, rank: 4800 }, { dropPp: 0.06 });
  eq('你 上线', me.online, true);
  eq('同学A 刚上线', a.online, true);
  eq('朋友 未上线', fr.online, false);
  near('你 与线差', me.delta, 8.370, 0.05);
  near('你 距市线名次', me.gapRank, 455.80, 0.5);
}

/* ---- 5. 两个方向的反推 ---- */
{
  const r = convert({ score: '', rank: 3100 }, { dropPp: 0.06 });
  near('位次反推模考分', r.score, 500, 0.01);
  eq('标记为反推', r.scoreInferred, true);
  eq('没有位次反推', r.rankInferred, false);
}
{
  // 只有分数：507 分 → 模考位次 → 省位次 → 等效分
  const r = convert({ score: 507, rank: '' }, { dropPp: 0.06 });
  near('分数反推模考位次', r.rank, 2700, 1);
  near('分数反推省位次', r.rankProv, 44055, 20);
  near('分数反推等效分', r.scoreProv, 543.37, 0.05);
  eq('标记位次反推', r.rankInferred, true);
  eq('标记外推', r.extrapolated, true);
}
{
  // 没有锚点的低分区：459 分外推到 4633 左右
  const r = convert({ score: 459, rank: '' }, { dropPp: 0.06 });
  near('低分反推位次', r.rank, 4833, 3);
  eq('低分外推', r.extrapolated, true);
}
{
  // 两个都不填要报错
  let err = null;
  try {
    convert({ score: '', rank: '' }, { dropPp: 0.06 });
  } catch (e) {
    err = e.message;
  }
  eq('空输入报错', Boolean(err && err.includes('至少')), true);
}

/* ---- 6. 参数变化的方向性 ---- */
{
  const lo = convert({ score: 500, rank: 3100 }, { dropPp: 0.05 });
  const hi = convert({ score: 500, rank: 3100 }, { dropPp: 0.07 });
  eq('折扣越大 位次越差', hi.rankProv > lo.rankProv, true);
  eq('折扣越大 分数越低', hi.scoreProv < lo.scoreProv, true);
}

/* ---- 7. 曲线单调 ---- */
{
  const m = makeModel({ dropPp: 0.06 });
  let prev = Infinity;
  let monotone = true;
  for (let r = 1000; r <= 99000; r += 500) {
    const s = m.scoreAtProvince(r);
    if (s > prev) monotone = false;
    prev = s;
  }
  eq('曲线单调递减', monotone, true);
  near('曲线过特控线', m.scoreAtProvince(DEFAULT_PARAMS.gk.lineRank), 528, 0.01);
}

/* ---- 8. 反查与查表 ---- */
{
  const m = makeModel({ dropPp: 0.06 });
  near('rankAt(500)', m.curve.rankAt(500), 3100, 0.01);
  near('rankAt(466)', m.curve.rankAt(466), 4600, 0.01);
  near('rankAt(483)', m.curve.rankAt(483), 3907.41, 1);

  const table = lookupTable(m);
  eq('查表行数', table.length, 9);
  near('表首行分数', table[0].score, 500, 0.01);
  near('表首行等效分', table[0].scoreProv, 536.370, 0.05);
  near('表末行分数', table[table.length - 1].score, 460, 0.01);
  const monotone = table.every((r, i) => i === 0 || r.rankProv > table[i - 1].rankProv);
  eq('查表位次单调', monotone, true);
}

/* ---- 9. 推荐（三年合并） ---- */
{
  const me = convert({ score: 500, rank: 3100 });
  const rec = recommendGroups(me.rankProv, ADMISSIONS);
  eq('冲有 5 个', rec.reach.length, 5);
  eq('稳有 5 个', rec.safe.length, 5);
  eq('冲全部更靠前', rec.reach.every((g) => g.rank < me.rankProv), true);
  eq('稳全部更靠后', rec.safe.every((g) => g.rank >= me.rankProv), true);
  near('冲最接近的一个', rec.reach[0].rank, 50401, 1);
  eq('冲按位次降序', rec.reach.every((g, i) => i === 0 || rec.reach[i - 1].rank >= g.rank), true);

  const tables = ADMISSIONS.tables;
  eq('2026 行数', tables[2026].rows.length, 217);
  eq('2025 行数', tables[2025].rows.length, 128);
  eq('2024 行数', tables[2024].rows.length, 109);

  const records = buildRecords(ADMISSIONS);
  eq('三年合并后 274 条', records.length, 274);
  const ny = records.find((r) => r.school === '福建中医药大学' && r.group === '500');
  eq('中医药 500 组有三年', ny && Object.keys(ny.years).length, 3);
  eq('最新年份是 2026', ny && ny.latestYear, 2026);

  // 每年数据自洽：分数降序、位次升序、同分同位次
  for (const y of Object.keys(tables)) {
    const rows = tables[y].rows;
    let ok = true;
    for (let i = 1; i < rows.length; i++) {
      if (rows[i - 1][2] < rows[i][2]) ok = false;
      if (rows[i - 1][2] > rows[i][2] && rows[i - 1][3] > rows[i][3]) ok = false;
      if (rows[i - 1][2] === rows[i][2] && rows[i - 1][3] !== rows[i][3]) ok = false;
    }
    eq(`${y} 年表有序`, ok, true);
  }
}

/* ---- 10. 年份切换与专业推荐 ---- */
{
  const me = convert({ score: 500, rank: 3100 });
  const y2026 = recommendGroups(me.rankProv, ADMISSIONS, 5, 2026);
  const y2025 = recommendGroups(me.rankProv, ADMISSIONS, 5, 2025);
  const y2024 = recommendGroups(me.rankProv, ADMISSIONS, 5, 2024);
  eq('2026 池子 217', y2026.total, 217);
  eq('2025 池子 128', y2025.total, 128);
  eq('2024 池子 104', y2024.total, 104);
  eq('2025 全部来自 2025 表', y2025.reach.every((g) => g.years[2025]), true);

  const mj = recommendMajors(me.rankProv, MAJORS);
  eq('专业 292 个', mj.total, 292);
  eq('专业冲 5 个', mj.reach.length, 5);
  eq('稳档有 5 个', mj.safe.length, 5);
  near('冲最接近的专业位次', mj.reach[0].rank, 46854, 1);
  eq('专业按位次降序', mj.reach.every((m, i) => i === 0 || mj.reach[i - 1].rank >= m.rank), true);
}

console.log(`\n通过 ${passed}，失败 ${failed}`);
process.exit(failed ? 1 : 0);
