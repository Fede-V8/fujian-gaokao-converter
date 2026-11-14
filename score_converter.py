#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""模考成绩 → 高考等效位次 / 等效分 换算 demo（v3：市上线率按百分点下调）

方法（按“宁德市特控线上线率比全省低 5%~7%”的口径）
------------------------------------------------
1. 省特控线上线率 r_gk = 57500 / 198000 = 29.04%
2. 宁德市上线率      r_city = r_gk − δ（δ 是百分点，不是百分比）
                     δ∈[5,7] 个百分点 → 22.04% ~ 24.04%
3. 把市上线率“代入这次模考的排名”：
   模考里真正等于省特控线的名次 = r_city × 15000 ≈ 3306 ~ 3606 名
   （官方划的 4600 名是按 30.67% 划的，比宁德实际口径宽 1,000~1,300 名）
4. 位次倍率 k = 57500 / 市线名次 ≈ 15.94 ~ 17.39，省位次 = 模考位次 × k
5. 等效分用同一条线平移（等价于“调整线差法”）：
   等效分 = 模考分 + (528 − 模考市线分)，模考市线分 ≈ 490 ~ 496
   → 本次模考在宁德要考到 490~496 才算真正踩到省特控线 528，而不是 466。

为什么要这样：模考的 466 是按“全省口径”或经验比例划的，而宁德学生达到省线的
比例本来就比全省低 5%~7%，所以 466 这条线在宁德偏松，必须先把线“收紧”再比对。

无第三方依赖，Python 3.8+。
"""

from __future__ import annotations

import argparse
import csv
import math
import os
import sys
import unicodedata
from dataclasses import dataclass, field
from statistics import NormalDist
from typing import Iterable, Sequence

SQRT2PI = math.sqrt(2.0 * math.pi)
_ND = NormalDist()


# ---------------------------------------------------------------- 基础数据


@dataclass(frozen=True)
class Scale:
    """一次考试的盘子：总人数 + 特控线分数 + 特控线位次。"""

    label: str
    total: int
    line_score: float
    line_rank: int

    def __post_init__(self) -> None:
        if self.total <= 0:
            raise ValueError("total 必须为正")
        if not 0 < self.line_rank <= self.total:
            raise ValueError("line_rank 必须在 (0, total] 内")

    @property
    def line_top_fraction(self) -> float:
        return self.line_rank / self.total

    def describe(self) -> str:
        return (
            f"{self.label}：{self.total:,} 人，特控线 {self.line_score:g} 分 / "
            f"第 {self.line_rank:,} 名（前 {self.line_top_fraction:.2%}）"
        )


DEFAULT_MOCK = Scale("模考（宁德·物理类）", 15_000, 466, 4_600)
DEFAULT_GK = Scale("2026 福建高考（物理类）", 195_315, 528, 58_019)

# 模考已知锚点（分数, 位次），用于构造本地的“分数-位次”曲线
DEFAULT_ANCHORS: tuple[tuple[float, float], ...] = (
    (500.0, 3_100),
    (493.0, 3_500),
    (466.0, 4_600),
    (460.0, 4_800),
)


def _display_width(text: str) -> int:
    return sum(2 if unicodedata.east_asian_width(ch) in "WF" else 1 for ch in text)


def _center(text: str, width: int) -> str:
    pad = max(width - _display_width(text), 0)
    return " " * (pad // 2) + text + " " * (pad - pad // 2)


def _ljust(text: str, width: int) -> str:
    return text + " " * max(width - _display_width(text), 0)


def _rjust(text: str, width: int) -> str:
    return " " * max(width - _display_width(text), 0) + text


def _fmt(n: float) -> str:
    return f"{round(n):,}"


# ---------------------------------------------------------------- 市上线率折扣


@dataclass(frozen=True)
class CityAdjust:
    """宁德市上线率相对全省的**百分点**下调。

    drop_pp=0.06 读作：宁德达到省特控线的比例比全省低 6 个百分点
    （29.04% → 23.04%，而不是 29.04%×0.94=27.30%）。
    它作用在“线”上：模考里真正等于省线的名次 = 23.04% × 15000 ≈ 3456，
    而不是官方划的 4600。
    """

    drop_pp: float = 0.06

    def __post_init__(self) -> None:
        if not 0.0 <= self.drop_pp < 0.2:
            raise ValueError("drop_pp 必须在 [0, 0.2) 内（单位是百分点/100）")

    def city_rate(self, gk: Scale) -> float:
        rate = gk.line_top_fraction - self.drop_pp
        if rate <= 0:
            raise ValueError("下调后市上线率必须为正")
        return rate

    def city_line_rank(self, mock: Scale, gk: Scale) -> float:
        return self.city_rate(gk) * mock.total

    def multiplier(self, mock: Scale, gk: Scale) -> float:
        """模考位次 → 省位次的倍率。"""
        return gk.line_rank / self.city_line_rank(mock, gk)

    def describe(self, gk: Scale) -> str:
        return f"市上线率 = 省 {gk.line_top_fraction:.2%} − {self.drop_pp * 100:.0f}pp = {self.city_rate(gk):.2%}"


# ---------------------------------------------------------------- 位次换算


def provincial_rank(
    rank: float,
    mock: Scale = DEFAULT_MOCK,
    gk: Scale = DEFAULT_GK,
    adjust: CityAdjust = CityAdjust(),
) -> float:
    """模考位次 → 全省等效位次：rank × (省线位次 / 模考市线位次)。"""
    if not 0 < rank <= mock.total:
        raise ValueError(f"位次需在 (0, {mock.total}] 内，收到 {rank}")
    return min(max(rank * adjust.multiplier(mock, gk), 1.0), float(gk.total))


def top_fraction(rank: float, total: int) -> float:
    return min(max(rank / total, 0.0), 1.0)


# ---------------------------------------------------------------- 分数曲线


class AnchoredCurve:
    """单调分段线性曲线，锚点 (位次, 分数) 按位次升序、分数降序。"""

    def __init__(self, points: Sequence[tuple[float, float]]) -> None:
        pts = sorted((float(r), float(s)) for r, s in points)
        if len(pts) < 2:
            raise ValueError("至少需要 2 个锚点")
        for (r1, s1), (r2, s2) in zip(pts, pts[1:]):
            if not s1 > s2:
                raise ValueError(f"分数必须随位次严格递减，问题锚点：{(r1, s1)} → {(r2, s2)}")
        self.points = pts

    @classmethod
    def from_csv(cls, path: str) -> "AnchoredCurve":
        """读取一分一段表。列名含“分数”+“累计人数/位次”。"""
        rows: list[dict[str, str]] = []
        with open(path, newline="", encoding="utf-8-sig") as fh:
            for row in csv.DictReader(fh):
                rows.append({(k or "").strip(): (v or "").strip() for k, v in row.items()})
        if not rows:
            raise ValueError("CSV 为空")
        keys = list(rows[0].keys())
        score_key = next((k for k in keys if "分" in k), None)
        rank_key = (
            next((k for k in keys if "累计" in k or "位次" in k or "排名" in k), None)
            or next((k for k in keys if "人数" in k and "分" not in k), None)
        )
        if score_key is None or rank_key is None:
            raise ValueError(f"CSV 需要包含分数列与累计人数列，实际列：{keys}")
        pts: list[tuple[float, float]] = []
        for row in rows:
            try:
                pts.append((float(row[rank_key]), float(row[score_key])))
            except (TypeError, ValueError):
                continue
        return cls(pts)

    def score_at(self, rank: float, extrapolate: bool = False) -> float:
        pts = self.points
        if rank <= pts[0][0]:
            if not extrapolate:
                return pts[0][1]
            (r1, s1), (r2, s2) = pts[0], pts[1]
            return s1 + (rank - r1) * (s2 - s1) / (r2 - r1)
        if rank >= pts[-1][0]:
            if not extrapolate:
                return pts[-1][1]
            (r1, s1), (r2, s2) = pts[-2], pts[-1]
            return s2 + (rank - r2) * (s2 - s1) / (r2 - r1)
        for (r1, s1), (r2, s2) in zip(pts, pts[1:]):
            if r1 <= rank <= r2:
                t = (rank - r1) / (r2 - r1)
                return s1 + t * (s2 - s1)
        return pts[-1][1]  # pragma: no cover

    def rank_at(self, score: float) -> float:
        pts = self.points
        if score >= pts[0][1]:
            return pts[0][0]
        if score <= pts[-1][1]:
            return pts[-1][0]
        for (r1, s1), (r2, s2) in zip(pts, pts[1:]):
            if s2 <= score <= s1:
                t = (score - s1) / (s2 - s1) if s2 != s1 else 0.0
                return r1 + t * (r2 - r1)
        return pts[-1][0]  # pragma: no cover

    def describe(self) -> str:
        return (
            f"分段线性（{len(self.points)} 个锚点，"
            f"{self.points[-1][1]:g}~{self.points[0][1]:g} 分 / "
            f"{self.points[0][0]:,}~{self.points[-1][0]:,} 名）"
        )


class NormalCurve:
    """正态近似，仅用于交叉校验（全局形状假设，与模考密度不一致时会偏高）。"""

    def __init__(self, gk: Scale = DEFAULT_GK, sigma: float = 130.0) -> None:
        if sigma <= 0:
            raise ValueError("sigma 必须为正")
        self.gk = gk
        self.sigma = float(sigma)
        self.z_line = _z_of_top_fraction(gk.line_top_fraction)

    def score_at(self, rank: float) -> float:
        z = _z_of_top_fraction(top_fraction(rank, self.gk.total))
        return self.gk.line_score + self.sigma * (z - self.z_line)

    def rank_at(self, score: float) -> float:
        z = (score - self.gk.line_score) / self.sigma + self.z_line
        return (1.0 - _ND.cdf(z)) * self.gk.total

    def students_per_point(self, rank: float) -> float:
        return self.gk.total * _norm_pdf(_z_of_top_fraction(top_fraction(rank, self.gk.total))) / self.sigma

    def describe(self) -> str:
        return f"正态近似 σ={self.sigma:g}"


def _z_of_top_fraction(p_top: float) -> float:
    p = min(max(p_top, 1e-9), 1.0 - 1e-9)
    return _ND.inv_cdf(1.0 - p)


def _norm_pdf(z: float) -> float:
    return math.exp(-0.5 * z * z) / SQRT2PI


# ---------------------------------------------------------------- 换算核心


def transfer_offset(
    mock_curve: AnchoredCurve,
    mock: Scale = DEFAULT_MOCK,
    gk: Scale = DEFAULT_GK,
    adjust: CityAdjust = CityAdjust(),
) -> float:
    """模考分 → 高考分 的平移量：528 − 模考市线分。"""
    city_rank = adjust.city_line_rank(mock, gk)
    return gk.line_score - mock_curve.score_at(city_rank)


def city_mock_score(
    mock_curve: AnchoredCurve,
    mock: Scale = DEFAULT_MOCK,
    gk: Scale = DEFAULT_GK,
    adjust: CityAdjust = CityAdjust(),
) -> float:
    """本次模考中，真正等于省特控线的分数（“市线”）。"""
    return mock_curve.score_at(adjust.city_line_rank(mock, gk))


@dataclass(frozen=True)
class Point:
    drop_pp: float
    rank_prov: float
    score_transfer: float
    score_normal: float | None = None


@dataclass
class Student:
    name: str
    mock_score: float
    mock_rank: float
    points: list[Point] = field(default_factory=list)

    def add(self, p: Point) -> None:
        self.points.append(p)

    @property
    def rank_range(self) -> tuple[float, float]:
        rs = [p.rank_prov for p in self.points]
        return min(rs), max(rs)

    @property
    def score_range(self) -> tuple[float, float]:
        ss = [p.score_transfer for p in self.points]
        return min(ss), max(ss)

    @property
    def normal_range(self) -> tuple[float, float] | None:
        ss = [p.score_normal for p in self.points if p.score_normal is not None]
        return (min(ss), max(ss)) if ss else None

    @property
    def median_rank(self) -> float:
        return _median([p.rank_prov for p in self.points])

    @property
    def median_score(self) -> float:
        return _median([p.score_transfer for p in self.points])


def _median(values: Sequence[float]) -> float:
    v = sorted(values)
    n = len(v)
    return v[n // 2] if n % 2 else (v[n // 2 - 1] + v[n // 2]) / 2


def convert(
    name: str,
    mock_score: float | None,
    mock_rank: float,
    discounts: Iterable[float],
    mock: Scale = DEFAULT_MOCK,
    gk: Scale = DEFAULT_GK,
    mock_curve: AnchoredCurve | None = None,
    sigmas: Sequence[float] = (),
) -> Student:
    if not 0 < mock_rank <= mock.total:
        raise ValueError(f"模考位次需在 (0, {mock.total}] 内，收到 {mock_rank}")
    curve = mock_curve or build_mock_curve([], mock)
    score = mock_score if mock_score is not None else curve.score_at(mock_rank)
    st = Student(name=name, mock_score=float(score), mock_rank=float(mock_rank))
    for d in discounts:
        adj = CityAdjust(d)
        rp = provincial_rank(mock_rank, mock, gk, adj)
        st.add(
            Point(
                drop_pp=d,
                rank_prov=rp,
                score_transfer=score + transfer_offset(curve, mock, gk, adj),
                score_normal=NormalCurve(gk, sigmas[0]).score_at(rp) if sigmas else None,
            )
        )
    return st


# ---------------------------------------------------------------- 诊断


@dataclass(frozen=True)
class DensityAnchor:
    score_low: float
    score_high: float
    ranks_per_score: float

    def describe(self) -> str:
        return f"{self.score_low:g}→{self.score_high:g} 分：{self.ranks_per_score:.1f} 人/分"


def density_anchors(points: Sequence[tuple[float, float]]) -> list[DensityAnchor]:
    pts = sorted((float(s), float(r)) for s, r in points)
    out: list[DensityAnchor] = []
    for (s1, r1), (s2, r2) in zip(pts, pts[1:]):
        if s2 != s1:
            out.append(DensityAnchor(s1, s2, abs(r2 - r1) / abs(s2 - s1)))
    return out


def estimate_sigmas(
    anchors: Sequence[DensityAnchor],
    mock: Scale = DEFAULT_MOCK,
    gk: Scale = DEFAULT_GK,
    adjust: CityAdjust = CityAdjust(),
) -> list[float]:
    """由模考每分人数反推正态 sigma（仅校验用）。"""
    k = adjust.multiplier(mock, gk)
    z_line = _z_of_top_fraction(gk.line_top_fraction)
    out: list[float] = []
    for a in anchors:
        d = a.ranks_per_score * k
        if d > 0:
            out.append(gk.total * _norm_pdf(z_line) / d)
    return out


def build_mock_curve(
    anchors: Sequence[tuple[float, float]],
    mock: Scale = DEFAULT_MOCK,
) -> AnchoredCurve:
    pts = dict(DEFAULT_ANCHORS)
    for s, r in anchors:
        pts[float(s)] = float(r)
    pts[float(mock.line_score)] = float(mock.line_rank)  # 官方划线一定参与
    return AnchoredCurve([(r, s) for s, r in pts.items()])


# ---------------------------------------------------------------- 报告


def format_report(
    students: Sequence[Student],
    mock: Scale,
    gk: Scale,
    curve: AnchoredCurve,
    discounts: Sequence[float],
    diagnostics: Sequence[str] = (),
) -> str:
    W = 68
    out: list[str] = []
    add = out.append
    d_lo, d_hi = min(discounts), max(discounts)
    adj_mid = CityAdjust(_median(list(discounts)))
    line_rank_mid = adj_mid.city_line_rank(mock, gk)

    add("=" * W)
    add(_center("模考 → 高考 等效位次 / 等效分（市上线率口径）", W))
    add("=" * W)
    add(mock.describe())
    add(gk.describe())
    add(f"市上线率：省 {gk.line_top_fraction:.2%} 下调 {d_lo * 100:.0f}–{d_hi * 100:.0f} 个百分点"
        f" → {adj_mid.city_rate(gk):.2%}")
    add(f"模考市线：第 {line_rank_mid:,.0f} 名，对应模考 {city_mock_score(curve, mock, gk, adj_mid):.1f} 分"
        f"（官方划线为第 {mock.line_rank:,} 名 / {mock.line_score:g} 分）")
    add(f"位次倍率：×{adj_mid.multiplier(mock, gk):.3f}    分数平移："
        f"+{transfer_offset(curve, mock, gk, adj_mid):.1f} 分")
    add("")

    if diagnostics:
        add("─" * W)
        add("自检 / 数据诊断")
        add("─" * W)
        for d in diagnostics:
            add(d)
        add("")

    for st in students:
        lo_r, hi_r = st.rank_range
        lo_s, hi_s = st.score_range
        add("─" * W)
        add(f"{st.name} | 模考 {st.mock_score:g} 分 / 第 {_fmt(st.mock_rank)} 名")
        add("─" * W)
        pct = top_fraction(st.mock_rank, mock.total)
        rate = adj_mid.city_rate(gk)
        mark = "上线" if pct <= rate else "未上线"
        add(f"  模考百分位   : 前 {pct:.1%}（市上线率 {rate:.1%} → {mark}）")
        gap_rank = line_rank_mid - st.mock_rank
        add(f"  距市线名次   : {'领先' if gap_rank > 0 else '落后'} {abs(gap_rank):,.0f} 名"
            f"（市线第 {line_rank_mid:,.0f} 名，官方划线第 {mock.line_rank:,} 名）")
        add(f"  全省等效位次 : {_fmt(lo_r)} – {_fmt(hi_r)}（前 "
            f"{top_fraction(lo_r, gk.total):.1%} – {top_fraction(hi_r, gk.total):.1%}，"
            f"中位 {_fmt(st.median_rank)}）")
        add(f"  高考等效分   : {lo_s:.0f} – {hi_s:.0f} 分（中位 {st.median_score:.1f} 分）")
        nr = st.normal_range
        if nr:
            add(f"  正态口径校验 : {nr[0]:.0f} – {nr[1]:.0f} 分（遍历形状假设，一般偏高）")
        delta = st.median_score - gk.line_score
        if delta > 0:
            add(f"  判读         : 高于特控线 {delta:.0f} 分左右（{gk.line_score:g} → {st.median_score:.0f}）")
        else:
            add(f"  判读         : 低于特控线 {abs(delta):.0f} 分左右（{gk.line_score:g} → {st.median_score:.0f}）")
        add("")

    # 汇总表
    add("═" * W)
    add("汇总")
    add("─" * W)
    add(f"  {_ljust('姓名', 8)}{_rjust('模考', 13)}{_rjust('省位次', 11)}{_rjust('等效分', 9)}{_rjust('与线', 7)}")
    for st in students:
        add(
            f"  {_ljust(st.name, 8)}"
            f"{_rjust(f'{st.mock_score:g}/{_fmt(st.mock_rank)}', 13)}"
            f"{_rjust(_fmt(st.median_rank), 11)}"
            f"{_rjust(f'{st.median_score:.0f}', 9)}"
            f"{_rjust(f'{st.median_score - gk.line_score:+.0f}', 7)}"
        )
    add("═" * W)
    add("位次只依赖两条线的比例，稳；分数只依赖你自己给的模考曲线，比全局分布假设更稳。")
    return "\n".join(out)


# ---------------------------------------------------------------- SVG


def render_svg(
    path: str,
    students: Sequence[Student],
    mock: Scale,
    gk: Scale,
    curve: AnchoredCurve,
    discount: float,
    rank_max: int = 100_000,
    score_min: float = 400.0,
    score_max: float = 680.0,
) -> None:
    W, H = 900, 560
    ml, mr, mt, mb = 78, 215, 52, 58
    pw, ph = W - ml - mr, H - mt - mb
    adj = CityAdjust(discount)
    k = adj.multiplier(mock, gk)
    off = transfer_offset(curve, mock, gk, adj)

    def px(r: float) -> float:
        return ml + (min(max(r, 0), rank_max) / rank_max) * pw

    def py(s: float) -> float:
        s = min(max(s, score_min), score_max)
        return mt + (1 - (s - score_min) / (score_max - score_min)) * ph

    def score_fn(r_prov: float) -> float:
        return curve.score_at(r_prov / k, extrapolate=True) + off

    parts = [
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}" '
        'font-family="-apple-system, \'PingFang SC\', \'Microsoft YaHei\', sans-serif">',
        f'<rect width="{W}" height="{H}" fill="#fbfbfd"/>',
        f'<text x="{ml}" y="30" font-size="17" font-weight="600" fill="#111">'
        f"模考位次 → 高考等效分（市上线率下调 {discount * 100:.0f}pp）</text>",
    ]
    for i in range(6):
        v = score_min + (score_max - score_min) * i / 5
        y = py(v)
        parts.append(f'<line x1="{ml}" y1="{y:.1f}" x2="{ml + pw}" y2="{y:.1f}" stroke="#e6e6ee"/>')
        parts.append(f'<text x="{ml - 8}" y="{y + 4:.1f}" font-size="11" fill="#8a8a99" text-anchor="end">{v:.0f}</text>')
    for i in range(6):
        v = rank_max * i / 5
        x = px(v)
        parts.append(f'<line x1="{x:.1f}" y1="{mt}" x2="{x:.1f}" y2="{mt + ph}" stroke="#f0f0f6"/>')
        parts.append(
            f'<text x="{x:.1f}" y="{mt + ph + 18}" font-size="11" fill="#8a8a99" text-anchor="middle">'
            f"{v / 10000:.1f}万</text>"
        )
    parts.append(
        f'<text x="{ml + pw / 2:.0f}" y="{H - 12}" font-size="12" fill="#666" text-anchor="middle">全省等效位次</text>'
    )

    pts = []
    for i in range(481):
        r = rank_max * i / 480
        s = score_fn(r)
        if score_min <= s <= score_max:
            pts.append(f"{px(r):.1f},{py(s):.1f}")
    if pts:
        parts.append(f'<polyline points="{" ".join(pts)}" fill="none" stroke="#3b6ef5" stroke-width="2.4"/>')

    # 特控线
    x, y = px(gk.line_rank), py(gk.line_score)
    parts.append(f'<line x1="{x:.1f}" y1="{mt}" x2="{x:.1f}" y2="{mt + ph}" stroke="#e5484d" '
                 'stroke-width="1.6" stroke-dasharray="5 4"/>')
    parts.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="4" fill="#e5484d"/>')
    parts.append(f'<text x="{x - 6:.1f}" y="{mt + 14}" font-size="11" fill="#e5484d" text-anchor="end">'
                 f"省特控线 {gk.line_score:g} 分 · 第 {gk.line_rank / 10000:.2f} 万</text>")

    colors = ["#0f9d58", "#7c4dff", "#f4a300"]
    for idx, st in enumerate(students):
        c = colors[idx % len(colors)]
        lo_r, hi_r = st.rank_range
        y = py(st.median_score)
        parts.append(f'<rect x="{px(lo_r):.1f}" y="{mt}" width="{max(px(hi_r) - px(lo_r), 3):.1f}" '
                     f'height="{ph}" fill="{c}" opacity="0.10"/>')
        cx = px(st.median_rank)
        parts.append(f'<circle cx="{cx:.1f}" cy="{y:.1f}" r="5.5" fill="{c}"/>')
        label = st.name.replace("&", "&amp;")
        dy = (-34, 30, -14)[idx % 3]
        left = idx % 3 == 1  # 中间那个往左放，避开右侧的特控线
        ly = y + dy
        tx = cx - 10 if left else cx + 10
        anchor = "end" if left else "start"
        parts.append(f'<line x1="{cx:.1f}" y1="{y:.1f}" x2="{tx + (6 if left else -6):.1f}" '
                     f'y2="{ly - 4:.1f}" stroke="{c}" stroke-width="1" opacity="0.55"/>')
        parts.append(f'<text x="{tx:.1f}" y="{ly:.1f}" font-size="12" font-weight="600" '
                     f'text-anchor="{anchor}" fill="{c}">{label} {st.median_score:.0f} 分</text>')

    lx = W - mr + 16
    parts.append(f'<text x="{lx}" y="{mt + 6}" font-size="12" font-weight="600" fill="#333">换算参数</text>')
    city_rank = adj.city_line_rank(mock, gk)
    lines = [
        f"模考 {mock.total / 10000:.1f} 万人",
        f"全省 {gk.total / 10000:.1f} 万人",
        f"市上线率 {adj.city_rate(gk):.2%}",
        f"市线第 {city_rank:,.0f} 名",
        f"倍率 ×{k:.2f}",
        f"平移 +{off:.1f} 分",
    ]
    for i, t in enumerate(lines):
        parts.append(f'<text x="{lx}" y="{mt + 30 + i * 19}" font-size="11" fill="#666">{t}</text>')

    parts.append("</svg>")
    with open(path, "w", encoding="utf-8") as fh:
        fh.write("\n".join(parts))


# ---------------------------------------------------------------- CLI


STUDENTS = (
    ("你", 500.0, 3_100),
    ("同学A", 493.0, 3_500),
    ("朋友", 460.0, 4_800),
)


def main(argv: Sequence[str] | None = None) -> int:
    ap = argparse.ArgumentParser(
        description="模考成绩 → 高考等效位次/等效分（市上线率比省低 5~7 个百分点）",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    ap.add_argument("--score", type=float, help="你的模考分")
    ap.add_argument("--rank", type=float, help="你的模考位次")
    ap.add_argument("--name", default="考生")
    ap.add_argument("--demo", action="store_true", help="跑三个示例样本")
    ap.add_argument("--mock-total", type=int, default=DEFAULT_MOCK.total)
    ap.add_argument("--mock-line-score", type=float, default=DEFAULT_MOCK.line_score)
    ap.add_argument("--mock-line-rank", type=int, default=DEFAULT_MOCK.line_rank)
    ap.add_argument("--gk-total", type=int, default=DEFAULT_GK.total)
    ap.add_argument("--gk-line-score", type=float, default=DEFAULT_GK.line_score)
    ap.add_argument("--gk-line-rank", type=int, default=DEFAULT_GK.line_rank)
    ap.add_argument("--drop-pp", "--discount", dest="drops", type=float, action="append",
                    metavar="PP", help="市上线率下调的百分点/100（0.06 = 6 个百分点），可重复")
    ap.add_argument("--anchor", type=float, nargs=2, action="append", metavar=("SCORE", "RANK"),
                    help="追加模考锚点（分数 位次），可重复")
    ap.add_argument("--csv", help="高考一分一段表（分数,累计人数）：设为优先口径")
    ap.add_argument("--verify", action="store_true", help="同时打印正态口径校验")
    ap.add_argument("--svg", nargs="?", const="conversion.svg")
    args = ap.parse_args(argv)

    mock = Scale("模考（宁德·物理类）", args.mock_total, args.mock_line_score, args.mock_line_rank)
    gk = Scale("2026 福建高考（物理类）", args.gk_total, args.gk_line_score, args.gk_line_rank)
    discounts = sorted(args.drops) if args.drops else [0.05, 0.06, 0.07]
    curve = build_mock_curve(args.anchor or [], mock)

    # 诊断
    diags: list[str] = []
    dens = density_anchors([(sc, rk) for rk, sc in curve.points])
    if dens:
        diags.append("  模考每分人数：" + "；".join(d.describe() for d in dens))
    adj_mid = CityAdjust(_median(discounts))
    city_rank = adj_mid.city_line_rank(mock, gk)
    city_score = city_mock_score(curve, mock, gk, adj_mid)
    gap = city_rank - mock.line_rank
    diags.append(
        f"  官方划线 {mock.line_score:g} 分（第 {mock.line_rank:,} 名，前 {mock.line_top_fraction:.2%}）"
        f" vs 宁德市线 {city_score:.1f} 分（第 {city_rank:,.0f} 名，前 {adj_mid.city_rate(gk):.2%}）"
    )
    # gap>0 表示市线名次更靠后（更宽松）；这里 市线 4095 < 官方 4600，故官方更宽松
    diags.append(
        f"  → 官方划线比宁德实际口径{'松' if gap < 0 else '严'} {abs(gap):,.0f} 名"
        f"（{abs(gap) / mock.line_rank:.1%}），折合分数"
        f"{'偏低' if city_score > mock.line_score else '偏高'} {abs(city_score - mock.line_score):.1f} 分"
    )
    sig = estimate_sigmas(dens, mock, gk, adj_mid) if dens else []
    if sig:
        diags.append(f"  正态校验的 σ 标定：{min(sig):.0f}~{max(sig):.0f}，取 {_median(sig):.0f}")

    use_normal = args.verify or bool(args.csv)
    sigmas = [_median(sig)] if sig and use_normal else []

    if args.rank is not None:
        students = [convert(args.name, args.score, args.rank, discounts, mock, gk, curve, sigmas)]
    else:
        students = [convert(n, s, r, discounts, mock, gk, curve, sigmas) for n, s, r in STUDENTS]

    # CSV 口径：直接查真表，覆盖分数
    if args.csv:
        table = AnchoredCurve.from_csv(args.csv)
        for st in students:
            st.points = [
                Point(p.drop_pp, p.rank_prov, table.score_at(p.rank_prov), None) for p in st.points
            ]
        diags.append(f"  分数口径：一分一段表插值（{table.describe()}）")

    print(format_report(students, mock, gk, curve, discounts, diags))

    if args.svg:
        render_svg(args.svg, students, mock, gk, curve, _median(discounts))
        print(f"\n图已写出：{os.path.abspath(args.svg)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
