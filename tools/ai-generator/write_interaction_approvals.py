import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

from validate_interaction_approvals import validate_approval_artifact


ROOT_DIR = Path(__file__).resolve().parents[2]
SNAPSHOT_FIELDS = (
    "classification",
    "confidence",
    "pageContext",
    "observedUrl",
    "selector",
    "text",
    "role",
    "type",
    "tagName",
    "ariaAttributes",
    "interactionKind",
    "actionKind",
    "riskLevel",
    "tabRestore",
)


def parse_args():
    parser = argparse.ArgumentParser(
        description="Write a schema 3.0 interaction approval from an exact Analysis Review Report snapshot."
    )
    parser.add_argument("--report", required=True)
    parser.add_argument("--candidate-key", action="append", dest="candidate_keys", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--reviewer", default="local-ui-user")
    parser.add_argument("--note")
    return parser.parse_args()


def resolve_path(value):
    path = Path(value)
    return path if path.is_absolute() else ROOT_DIR / path


def load_report(path):
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict) or value.get("version") != "2.1":
        raise ValueError("Analysis Review Report version 2.1 is required")
    return value


def current_candidates(report):
    candidates = []
    for field in ("safeInteractionCandidates", "unsafeActionCandidates", "unresolvedCandidates"):
        value = report.get(field, [])
        if isinstance(value, list):
            candidates.extend(item for item in value if isinstance(item, dict))
    return {
        item.get("candidateKey"): item
        for item in candidates
        if isinstance(item.get("candidateKey"), str)
    }


def evidence_snapshot(candidate):
    return {
        field: candidate[field]
        for field in SNAPSHOT_FIELDS
        if field in candidate
    }


def build_artifact(report, candidate_keys, reviewer, note=None, reviewed_at=None):
    if not isinstance(reviewer, str) or not reviewer.strip():
        raise ValueError("reviewer must be a non-empty string")
    if not candidate_keys:
        raise ValueError("at least one candidateKey is required")
    if len(candidate_keys) != len(set(candidate_keys)):
        raise ValueError("candidateKey values must be unique")

    by_key = current_candidates(report)
    missing = sorted(key for key in candidate_keys if key not in by_key)
    if missing:
        raise ValueError(f"approved candidate missing from current report: {', '.join(missing)}")

    timestamp = reviewed_at or datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    approvals = []
    for key in sorted(candidate_keys):
        candidate = by_key[key]
        if candidate.get("classification") != "safe":
            raise ValueError(f"approved candidate is not currently safe: {key}")
        review = {"reviewer": reviewer.strip(), "reviewedAt": timestamp}
        if isinstance(note, str) and note.strip():
            review["note"] = note.strip()
        approvals.append(
            {
                "candidateKey": key,
                "decision": "approved",
                "evidenceSnapshot": evidence_snapshot(candidate),
                "review": review,
            }
        )

    artifact = {
        "schemaVersion": "3.0",
        "target": {"url": report.get("summary", {}).get("targetUrl", "")},
        "approvals": approvals,
    }
    errors = validate_approval_artifact(artifact)
    if errors:
        details = "; ".join(f"[{code}] {path}: {message}" for code, path, message in errors)
        raise ValueError(f"generated approval failed validation: {details}")
    return artifact


def write_artifact(path, artifact):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f"{path.name}.tmp")
    temporary.write_text(json.dumps(artifact, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temporary.replace(path)


def main():
    args = parse_args()
    report_path = resolve_path(args.report)
    output_path = resolve_path(args.output)
    try:
        report = load_report(report_path)
        artifact = build_artifact(
            report,
            args.candidate_keys,
            reviewer=args.reviewer,
            note=args.note,
        )
        write_artifact(output_path, artifact)
    except (OSError, json.JSONDecodeError, ValueError) as error:
        print(f"Interaction approval write failed: {error}", file=sys.stderr)
        return 1

    print("Interaction Approval Artifact")
    print(f"- approvals: {len(artifact['approvals'])}")
    print(f"- output: {output_path}")
    print("approval validation passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
