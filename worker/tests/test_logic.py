"""Offline tests for matching logic (no models or network). Run: python -m unittest discover worker/tests"""

import sys
import unittest
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from recognizer.faces import Gallery, Voter  # noqa: E402


def unit(v):
    v = np.asarray(v, np.float32)
    return v / np.linalg.norm(v)


class GalleryTest(unittest.TestCase):
    def setUp(self):
        rng = np.random.default_rng(1)
        self.a, self.b = unit(rng.normal(size=512)), unit(rng.normal(size=512))
        self.g = Gallery()
        self.g.load([("A", self.a.tolist()), ("A", unit(self.a + 0.1 * rng.normal(size=512)).tolist()), ("B", self.b.tolist())])

    def test_best_match_and_runner_up_is_other_person(self):
        emp, best, second = self.g.match(self.a)
        self.assertEqual(emp, "A")
        self.assertGreater(best, 0.99)
        self.assertLess(second, 0.3)  # runner-up must be B, not A's second sample

    def test_department_filter(self):
        emp, _, _ = self.g.match(self.a, allowed={"B"})
        self.assertEqual(emp, "B")

    def test_empty(self):
        self.assertEqual(Gallery().match(self.a), (None, 0.0, 0.0))


class VoterTest(unittest.TestCase):
    def test_needs_votes_within_window(self):
        v = Voter(votes=2, window=10)
        self.assertFalse(v.add("A", 0))
        self.assertFalse(v.add("A", 20))   # first vote expired
        self.assertTrue(v.add("A", 25))
        self.assertFalse(v.add("A", 26))   # reset after firing


if __name__ == "__main__":
    unittest.main()
