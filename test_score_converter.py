#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""score_converter 的单元测试：python3 -m unittest -v"""

from __future__ import annotations

import io
import os
import tempfile
import unittest
from contextlib import redirect_stdout

import score_converter as sc


class TestScales(unittest.TestCase):
    def test_line_fraction(self):
        self.assertAlmostEqual(sc.DEFAULT_MOCK.line_top_fraction, 4600 / 15000)
        self.assertAlmostEqual(sc.DEFAULT_GK.line_top_fraction, 58019 / 195315)

    def test_invalid_scale(self):
        with self.assertRaises(ValueError):
            sc.Scale("x", 0, 500, 100)
        with self.assertRaises(ValueError):
            sc.Scale("x", 100, 500, 200)


class TestCityAdjust(unittest.TestCase):
    def test_city_rate_is_percentage_points(self):
        # 29.04% − 6pp = 23.04%，不是 29.04%×0.94
        adj = sc.CityAdjust(0.06)
        self.assertAlmostEqual(adj.city_rate(sc.DEFAULT_GK), 58019 / 195315 - 0.06)
        self.assertAlmostEqual(sc.CityAdjust(0.05).city_rate(sc.DEFAULT_GK), 58019 / 195315 - 0.05, places=6)
        self.assertAlmostEqual(sc.CityAdjust(0.07).city_rate(sc.DEFAULT_GK), 58019 / 195315 - 0.07, places=6)

    def test_city_line_rank(self):
        adj = sc.CityAdjust(0.06)
        self.assertAlmostEqual(adj.city_line_rank(sc.DEFAULT_MOCK, sc.DEFAULT_GK), 3555.8, delta=1.0)

    def test_multiplier_anchors_line(self):
        # 市线名次 × 倍率 == 省线位次（定义上恒成立）
        for d in (0.0, 0.05, 0.06, 0.07):
            adj = sc.CityAdjust(d)
            line = adj.city_line_rank(sc.DEFAULT_MOCK, sc.DEFAULT_GK)
            self.assertAlmostEqual(line * adj.multiplier(sc.DEFAULT_MOCK, sc.DEFAULT_GK), 58019, places=6)

    def test_bigger_discount_worse_rank(self):
        ranks = [sc.provincial_rank(3100, adjust=sc.CityAdjust(d)) for d in (0.05, 0.06, 0.07)]
        self.assertEqual(ranks, sorted(ranks))

    def test_bounds(self):
        with self.assertRaises(ValueError):
            sc.CityAdjust(-0.01)
        with self.assertRaises(ValueError):
            sc.CityAdjust(0.5)


class TestRankMapping(unittest.TestCase):
    def test_known_value(self):
        self.assertAlmostEqual(sc.provincial_rank(3100, adjust=sc.CityAdjust(0.06)), 50582, delta=3)

    def test_monotone_and_bounds(self):
        prev = 0.0
        for rank in (1, 100, 3100, 4600, 4800, 15000):
            r = sc.provincial_rank(rank, adjust=sc.CityAdjust(0.06))
            self.assertGreater(r, prev)
            self.assertLessEqual(r, sc.DEFAULT_GK.total)
            prev = r

    def test_rejects_bad_input(self):
        with self.assertRaises(ValueError):
            sc.provincial_rank(0)
        with self.assertRaises(ValueError):
            sc.provincial_rank(15001)


class TestMockCurve(unittest.TestCase):
    def test_interpolation(self):
        c = sc.build_mock_curve([], sc.DEFAULT_MOCK)
        self.assertAlmostEqual(c.score_at(3100), 500)
        self.assertAlmostEqual(c.score_at(3500), 493)
        self.assertAlmostEqual(c.score_at(4600), 466)
        # 4050 落在 4600→3500 段：466 + (4600-4050)*27/1100
        self.assertAlmostEqual(c.score_at(4050), 466 + 550 * 27 / 1100, places=6)

    def test_extrapolate(self):
        c = sc.build_mock_curve([], sc.DEFAULT_MOCK)
        self.assertEqual(c.score_at(100), 500)                    # 默认钳制
        self.assertGreater(c.score_at(100, extrapolate=True), 500)  # 外推

    def test_inverse(self):
        c = sc.build_mock_curve([], sc.DEFAULT_MOCK)
        for s in (470, 480, 490):
            self.assertAlmostEqual(c.score_at(c.rank_at(s)), s, delta=0.5)

    def test_rejects_non_monotone(self):
        with self.assertRaises(ValueError):
            sc.AnchoredCurve([(1, 500), (2, 600)])
        with self.assertRaises(ValueError):
            sc.AnchoredCurve([(1, 500)])

    def test_from_csv(self):
        with tempfile.NamedTemporaryFile("w", suffix=".csv", delete=False, encoding="utf-8") as fh:
            fh.write("分数,本段人数,累计人数\n500,10,3100\n466,20,4600\n460,20,4800\n")
            path = fh.name
        try:
            c = sc.AnchoredCurve.from_csv(path)
            self.assertAlmostEqual(c.score_at(4000), 500 - 0.6 * 34, places=9)
        finally:
            os.unlink(path)

    def test_build_mock_curve_includes_line(self):
        c = sc.build_mock_curve([], sc.DEFAULT_MOCK)
        self.assertIn((4600.0, 466.0), c.points)


class TestTransfer(unittest.TestCase):
    def setUp(self):
        self.curve = sc.build_mock_curve([], sc.DEFAULT_MOCK)
        self.adj = sc.CityAdjust(0.06)

    def test_city_mock_score(self):
        self.assertAlmostEqual(sc.city_mock_score(self.curve), 491.63, delta=0.2)

    def test_offset(self):
        # 528 − 493.8 ≈ +34.2
        self.assertAlmostEqual(sc.transfer_offset(self.curve), 36.37, delta=0.2)

    def test_offset_moves_opposite_to_discount(self):
        a = sc.transfer_offset(self.curve, adjust=sc.CityAdjust(0.05))
        b = sc.transfer_offset(self.curve, adjust=sc.CityAdjust(0.07))
        self.assertGreater(a, b)

    def test_line_maps_to_line(self):
        # 模考市线分 + offset == 省特控线
        adj = sc.CityAdjust(0.06)
        s = sc.city_mock_score(self.curve) + sc.transfer_offset(self.curve, adjust=adj)
        self.assertAlmostEqual(s, sc.DEFAULT_GK.line_score, places=6)


class TestNormalCurve(unittest.TestCase):
    def test_anchors_at_line(self):
        for sigma in (85, 119, 160):
            c = sc.NormalCurve(sc.DEFAULT_GK, sigma)
            self.assertAlmostEqual(c.score_at(sc.DEFAULT_GK.line_rank), sc.DEFAULT_GK.line_score, places=9)

    def test_monotone(self):
        c = sc.NormalCurve(sc.DEFAULT_GK, 119)
        scores = [c.score_at(r) for r in range(100, 100001, 500)]
        self.assertEqual(scores, sorted(scores, reverse=True))

    def test_inverse_roundtrip(self):
        c = sc.NormalCurve(sc.DEFAULT_GK, 119)
        for rank in (500, 3100, 3500, 4600, 4800, 40000, 80000):
            self.assertAlmostEqual(c.rank_at(c.score_at(rank)), rank, delta=1.0)


class TestDiagnostics(unittest.TestCase):
    def test_density(self):
        dens = sc.density_anchors([(460, 4800), (466, 4600), (493, 3500), (500, 3100)])
        vals = [d.ranks_per_score for d in dens]
        self.assertEqual(len(vals), 3)
        self.assertAlmostEqual(vals[0], 200 / 6, places=6)
        self.assertAlmostEqual(vals[1], 1100 / 27, places=6)
        self.assertAlmostEqual(vals[2], 400 / 7, places=6)

    def test_sigma_range(self):
        dens = sc.density_anchors([(460, 4800), (466, 4600), (493, 3500), (500, 3100)])
        sig = sc.estimate_sigmas(dens)
        self.assertTrue(all(60 < s < 200 for s in sig), sig)


class TestConvert(unittest.TestCase):
    def setUp(self):
        self.curve = sc.build_mock_curve([], sc.DEFAULT_MOCK)

    def test_three_discounts(self):
        st = sc.convert("你", 500, 3100, [0.05, 0.06, 0.07], mock_curve=self.curve)
        self.assertEqual(len(st.points), 3)
        self.assertEqual([p.drop_pp for p in st.points], [0.05, 0.06, 0.07])

    def test_known_values(self):
        st = sc.convert("你", 500, 3100, [0.05, 0.06, 0.07], mock_curve=self.curve)
        self.assertAlmostEqual(st.median_rank, 50582, delta=10)
        self.assertAlmostEqual(st.median_score, 536.4, delta=0.5)
        self.assertAlmostEqual(st.score_range[0], 533.35, delta=0.3)   # δ=7pp
        self.assertAlmostEqual(st.score_range[1], 540.05, delta=0.3)   # δ=5pp

    def test_ordering(self):
        me = sc.convert("你", 500, 3100, [0.06], mock_curve=self.curve)
        a = sc.convert("A", 493, 3500, [0.06], mock_curve=self.curve)
        fr = sc.convert("朋友", 460, 4800, [0.06], mock_curve=self.curve)
        self.assertLess(me.median_rank, a.median_rank)
        self.assertLess(a.median_rank, fr.median_rank)
        self.assertGreater(me.median_score, a.median_score)
        self.assertGreater(a.median_score, fr.median_score)

    def test_crosses_line(self):
        fr = sc.convert("朋友", 460, 4800, [0.06], mock_curve=self.curve)
        self.assertGreater(fr.median_rank, sc.DEFAULT_GK.line_rank)
        self.assertLess(fr.median_score, sc.DEFAULT_GK.line_score)

    def test_score_from_rank_if_missing(self):
        st = sc.convert("x", None, 3100, [0.06], mock_curve=self.curve)
        self.assertAlmostEqual(st.mock_score, 500.0)

    def test_rejects_bad_rank(self):
        with self.assertRaises(ValueError):
            sc.convert("x", 500, 0, [0.06])


class TestReportAndCli(unittest.TestCase):
    def _students(self):
        curve = sc.build_mock_curve([], sc.DEFAULT_MOCK)
        return [
            sc.convert("你", 500, 3100, [0.05, 0.06, 0.07], mock_curve=curve),
            sc.convert("朋友", 460, 4800, [0.05, 0.06, 0.07], mock_curve=curve),
        ]

    def test_report(self):
        curve = sc.build_mock_curve([], sc.DEFAULT_MOCK)
        text = sc.format_report(self._students(), sc.DEFAULT_MOCK, sc.DEFAULT_GK, curve,
                                [0.05, 0.06, 0.07], ["diag-line"])
        for key in ("全省等效位次", "高考等效分", "判读", "汇总", "diag-line", "市上线率"):
            self.assertIn(key, text)

    def test_cli_demo(self):
        buf = io.StringIO()
        with redirect_stdout(buf):
            rc = sc.main(["--demo"])
        self.assertEqual(rc, 0)
        out = buf.getvalue()
        self.assertIn("同学A", out)
        self.assertIn("3,556", out)

    def test_cli_single(self):
        buf = io.StringIO()
        with redirect_stdout(buf):
            rc = sc.main(["--score", "520", "--rank", "2500", "--name", "测试"])
        self.assertEqual(rc, 0)
        self.assertIn("测试", buf.getvalue())

    def test_cli_svg(self):
        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, "c.svg")
            with redirect_stdout(io.StringIO()):
                rc = sc.main(["--demo", "--svg", path])
            self.assertEqual(rc, 0)
            with open(path, encoding="utf-8") as fh:
                body = fh.read()
            self.assertIn("<svg", body)
            self.assertIn("特控线", body)

    def test_cli_csv(self):
        with tempfile.NamedTemporaryFile("w", suffix=".csv", delete=False, encoding="utf-8") as fh:
            fh.write("分数,累计人数\n700,100\n600,9000\n528,57500\n460,120000\n")
            path = fh.name
        try:
            buf = io.StringIO()
            with redirect_stdout(buf):
                rc = sc.main(["--demo", "--csv", path])
            self.assertEqual(rc, 0)
            self.assertIn("一分一段表", buf.getvalue())
        finally:
            os.unlink(path)


if __name__ == "__main__":
    unittest.main(verbosity=2)
