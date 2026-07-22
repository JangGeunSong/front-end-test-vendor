import json
import unittest
from pathlib import Path

from write_interaction_approvals import build_artifact


FIXTURE_PATH = Path(__file__).resolve().parent / "fixtures" / "interaction_approval_reconciliation.fixture.json"


class InteractionApprovalWriterTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        fixture = json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))
        cls.report = fixture["analysisReviewReport"]
        cls.candidate_key = cls.report["safeInteractionCandidates"][0]["candidateKey"]

    def test_copies_exact_current_snapshot_and_validates(self):
        artifact = build_artifact(
            self.report,
            [self.candidate_key],
            "fixture-reviewer",
            reviewed_at="2026-07-22T00:00:00Z",
        )
        self.assertEqual([self.candidate_key], [item["candidateKey"] for item in artifact["approvals"]])
        self.assertEqual(
            self.report["safeInteractionCandidates"][0]["tabRestore"],
            artifact["approvals"][0]["evidenceSnapshot"]["tabRestore"],
        )

    def test_rejects_candidate_missing_from_current_report(self):
        with self.assertRaisesRegex(ValueError, "missing from current report"):
            build_artifact(
                self.report,
                ["interaction:selector:aaaaaaaaaaaaaaaaaaaaaaaa"],
                "fixture-reviewer",
            )


if __name__ == "__main__":
    unittest.main()
