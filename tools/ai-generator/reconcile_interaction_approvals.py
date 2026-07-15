import argparse
import json
import sys
from pathlib import Path

from validate_interaction_approvals import (
    CANDIDATE_KEY_PATTERN,
    CLASSIFICATIONS,
    CONFIDENCE_LEVELS,
    ROOT_DIR,
    display_path,
    is_absolute_http_url,
    is_non_empty_string,
    load_json,
    validate_approval_artifact,
)


GENERATED_DIR = ROOT_DIR / "tools" / "ai-generator" / "generated"
DEFAULT_REPORT_PATH = GENERATED_DIR / "analysis_review_report.json"
DEFAULT_APPROVAL_PATH = (
    ROOT_DIR / "tools" / "ai-generator" / "review" / "interaction_approvals.json"
)
DEFAULT_OUTPUT_PATH = GENERATED_DIR / "interaction_approval_reconciliation.json"
RESULT_SCHEMA_VERSION = "1.0"

REVIEW_CRITICAL_FIELDS = (
    "classification",
    "confidence",
    "pageContext",
    "selector",
    "text",
    "role",
    "type",
    "tagName",
    "ariaAttributes",
    "interactionKind",
    "actionKind",
    "riskLevel",
)
CURRENT_REQUIRED_STRING_FIELDS = (
    "pageContext",
    "selector",
    "text",
    "role",
    "type",
    "tagName",
)
INELIGIBILITY_REASON_ORDER = (
    "missingCandidate",
    "evidenceChanged",
    "currentClassificationNotSafe",
    "decisionNotApproved",
)


def parse_args():
    parser = argparse.ArgumentParser(
        description="Validate and reconcile current interaction candidates with human approvals."
    )
    parser.add_argument(
        "--report",
        default=str(DEFAULT_REPORT_PATH),
        help="Path to analysis_review_report.json.",
    )
    parser.add_argument(
        "--approvals",
        default=str(DEFAULT_APPROVAL_PATH),
        help="Path to interaction_approvals.json.",
    )
    parser.add_argument(
        "--output",
        default=str(DEFAULT_OUTPUT_PATH),
        help="Path to write interaction approval reconciliation JSON.",
    )
    parser.add_argument(
        "--fixture",
        help="Optional reconciliation fixture with report, approvals, and expectations.",
    )
    return parser.parse_args()


def resolve_path(value):
    path = Path(value)
    return path if path.is_absolute() else ROOT_DIR / path


def add_input_error(errors, code, path, message):
    errors.append((code, path, message))


def current_candidate_snapshot(candidate, path, errors):
    candidate_key = candidate.get("candidateKey")
    if not isinstance(candidate_key, str) or CANDIDATE_KEY_PATTERN.fullmatch(candidate_key) is None:
        add_input_error(
            errors,
            "C103",
            f"{path}.candidateKey",
            "candidateKey must match the interaction candidate key contract",
        )

    classification = candidate.get("classification")
    if classification not in CLASSIFICATIONS:
        add_input_error(
            errors,
            "C104",
            f"{path}.classification",
            f"classification must be one of {sorted(CLASSIFICATIONS)}",
        )

    confidence = candidate.get("confidence")
    if confidence not in CONFIDENCE_LEVELS:
        add_input_error(
            errors,
            "C105",
            f"{path}.confidence",
            f"confidence must be one of {sorted(CONFIDENCE_LEVELS)}",
        )

    for field in CURRENT_REQUIRED_STRING_FIELDS:
        if not isinstance(candidate.get(field), str):
            add_input_error(
                errors,
                "C106",
                f"{path}.{field}",
                "review-critical field is required and must be a string",
            )

    tag_name = candidate.get("tagName")
    if isinstance(tag_name, str) and tag_name != tag_name.lower():
        add_input_error(
            errors,
            "C111",
            f"{path}.tagName",
            "tagName must be normalized lowercase",
        )

    aria = candidate.get("ariaAttributes")
    if not isinstance(aria, dict) or any(not isinstance(key, str) or not isinstance(value, str) for key, value in (aria.items() if isinstance(aria, dict) else [])):
        add_input_error(
            errors,
            "C107",
            f"{path}.ariaAttributes",
            "ariaAttributes must be an object with string keys and values",
        )

    conditional_fields = {
        "safe": ("interactionKind",),
        "unsafe": ("actionKind", "riskLevel"),
        "unknown": (),
    }.get(classification, ())
    for field in conditional_fields:
        if not is_non_empty_string(candidate.get(field)):
            add_input_error(
                errors,
                "C108",
                f"{path}.{field}",
                f"{field} is required for current {classification!r} candidate",
            )
    unexpected_conditional = {
        "safe": ("actionKind", "riskLevel"),
        "unsafe": ("interactionKind",),
        "unknown": ("interactionKind", "actionKind", "riskLevel"),
    }.get(classification, ())
    for field in unexpected_conditional:
        if field in candidate:
            add_input_error(
                errors,
                "C112",
                f"{path}.{field}",
                f"{field} is not allowed for current {classification!r} candidate",
            )

    snapshot = {}
    for field in REVIEW_CRITICAL_FIELDS:
        if field in candidate:
            snapshot[field] = candidate[field]
    return snapshot


def extract_current_candidates(report):
    errors = []
    if not isinstance(report, dict):
        add_input_error(errors, "C001", "$", "analysis report top-level value must be an object")
        return "", [], errors

    summary = report.get("summary")
    target_url = summary.get("targetUrl") if isinstance(summary, dict) else None
    if not is_absolute_http_url(target_url):
        add_input_error(
            errors,
            "C002",
            "$.summary.targetUrl",
            "analysis report targetUrl must be a non-empty absolute HTTP(S) URL",
        )

    section_contract = (
        ("safeInteractionCandidates", "safe", False),
        ("unsafeActionCandidates", "unsafe", False),
        ("unresolvedCandidates", "unknown", True),
    )
    current = []
    seen_keys = set()
    for section, expected_classification, interaction_only in section_contract:
        items = report.get(section)
        if not isinstance(items, list):
            add_input_error(errors, "C101", f"$.{section}", "section is required and must be an array")
            continue
        for index, candidate in enumerate(items):
            path = f"$.{section}[{index}]"
            if not isinstance(candidate, dict):
                add_input_error(errors, "C102", path, "candidate must be an object")
                continue
            if interaction_only and candidate.get("candidateSubtype") != "interaction":
                continue
            if candidate.get("classification") != expected_classification:
                add_input_error(
                    errors,
                    "C109",
                    f"{path}.classification",
                    f"section requires classification {expected_classification!r}",
                )
            snapshot = current_candidate_snapshot(candidate, path, errors)
            candidate_key = candidate.get("candidateKey")
            if isinstance(candidate_key, str):
                if candidate_key in seen_keys:
                    add_input_error(errors, "C110", f"{path}.candidateKey", f"duplicate current candidateKey: {candidate_key}")
                else:
                    seen_keys.add(candidate_key)
            current.append({"candidate": candidate, "snapshot": snapshot})

    current.sort(key=lambda item: item["candidate"].get("candidateKey", ""))
    return target_url if isinstance(target_url, str) else "", current, errors


def changed_fields(snapshot, current_snapshot):
    changed = []
    for field in REVIEW_CRITICAL_FIELDS:
        if field in snapshot or field in current_snapshot:
            if snapshot.get(field) != current_snapshot.get(field):
                changed.append(field)
    return changed


def ordered_ineligibility_reasons(reference_status, current_classification, decision):
    applicable = set()
    if reference_status == "missingCandidate":
        applicable.add("missingCandidate")
    elif reference_status == "evidenceChanged":
        applicable.add("evidenceChanged")
    if current_classification is not None and current_classification != "safe":
        applicable.add("currentClassificationNotSafe")
    if decision != "approved":
        applicable.add("decisionNotApproved")
    return [reason for reason in INELIGIBILITY_REASON_ORDER if reason in applicable]


def eligible_candidate_payload(candidate):
    return {
        "candidateKey": candidate["candidateKey"],
        "currentClassification": candidate["classification"],
        "interactionKind": candidate["interactionKind"],
        "confidence": candidate["confidence"],
        "pageContext": candidate["pageContext"],
        "selector": candidate["selector"],
        "text": candidate["text"],
    }


def unreviewed_candidate_payload(candidate):
    return {
        "candidateKey": candidate["candidateKey"],
        "currentClassification": candidate["classification"],
        "text": candidate["text"],
        "pageContext": candidate["pageContext"],
    }


def reconcile_approvals(target_url, current_items, approval_artifact):
    current_by_key = {
        item["candidate"]["candidateKey"]: item
        for item in current_items
    }
    approval_entries = sorted(
        approval_artifact["approvals"], key=lambda entry: entry["candidateKey"]
    )
    approved_keys = {entry["candidateKey"] for entry in approval_entries}

    results = []
    eligible_candidates = []
    for entry in approval_entries:
        candidate_key = entry["candidateKey"]
        current_item = current_by_key.get(candidate_key)
        current_classification = None
        changed = []
        if current_item is None:
            reference_status = "missingCandidate"
        else:
            current_classification = current_item["candidate"]["classification"]
            changed = changed_fields(entry["evidenceSnapshot"], current_item["snapshot"])
            reference_status = "evidenceChanged" if changed else "valid"

        reasons = ordered_ineligibility_reasons(
            reference_status, current_classification, entry["decision"]
        )
        eligible = (
            reference_status == "valid"
            and current_classification == "safe"
            and entry["decision"] == "approved"
        )
        result_entry = {
            "candidateKey": candidate_key,
            "decision": entry["decision"],
            "referenceStatus": reference_status,
            "currentClassification": current_classification,
            "eligible": eligible,
            "ineligibilityReasons": reasons,
        }
        if changed:
            result_entry["changedFields"] = changed
        results.append(result_entry)
        if eligible:
            eligible_candidates.append(
                eligible_candidate_payload(current_item["candidate"])
            )

    unreviewed_candidates = [
        unreviewed_candidate_payload(item["candidate"])
        for item in current_items
        if item["candidate"]["candidateKey"] not in approved_keys
    ]

    status_counts = {"valid": 0, "missingCandidate": 0, "evidenceChanged": 0}
    for entry in results:
        status_counts[entry["referenceStatus"]] += 1

    return {
        "schemaVersion": RESULT_SCHEMA_VERSION,
        "target": {"url": target_url},
        "summary": {
            "currentCandidateCount": len(current_items),
            "approvalEntryCount": len(approval_entries),
            "validReferenceCount": status_counts["valid"],
            "missingCandidateCount": status_counts["missingCandidate"],
            "evidenceChangedCount": status_counts["evidenceChanged"],
            "eligibleCandidateCount": len(eligible_candidates),
            "unreviewedCandidateCount": len(unreviewed_candidates),
        },
        "results": results,
        "eligibleCandidates": eligible_candidates,
        "unreviewedCandidates": unreviewed_candidates,
    }


def render_result(result):
    return json.dumps(result, ensure_ascii=False, indent=2) + "\n"


def write_result(path, result):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(render_result(result), encoding="utf-8")


def print_approval_errors(errors):
    print("Approval artifact validation failed:")
    for code, path, message in errors:
        print(f"[{code}] {path}: {message}")


def print_current_errors(errors):
    print("Current candidate input validation failed:")
    for code, path, message in errors:
        print(f"[{code}] {path}: {message}")


def validate_fixture(fixture):
    if not isinstance(fixture, dict):
        raise ValueError("reconciliation fixture top-level value must be an object")
    report = fixture.get("analysisReviewReport")
    approvals = fixture.get("approvalArtifact")
    expected = fixture.get("expected")
    if not isinstance(expected, dict):
        raise ValueError("reconciliation fixture requires expected object")

    approval_errors = validate_approval_artifact(approvals)
    target_url, current_items, current_errors = extract_current_candidates(report)
    if approval_errors or current_errors:
        messages = [f"{code} {path}: {message}" for code, path, message in approval_errors + current_errors]
        raise ValueError("fixture input validation failed: " + "; ".join(messages))
    if approvals["target"]["url"] != target_url:
        raise ValueError("fixture target scope does not match")

    first = reconcile_approvals(target_url, current_items, approvals)
    second = reconcile_approvals(target_url, current_items, approvals)
    failures = []
    if render_result(first) != render_result(second):
        failures.append("repeated reconciliation output is not byte-stable")
    try:
        reparsed = json.loads(render_result(first))
    except json.JSONDecodeError as error:
        failures.append(f"rendered reconciliation result is not valid JSON: {error}")
    else:
        if reparsed != first:
            failures.append("rendered reconciliation result changed after JSON parse")

    for field, expected_value in expected.get("summary", {}).items():
        actual_value = first["summary"].get(field)
        if actual_value != expected_value:
            failures.append(
                f"summary.{field}: expected {expected_value!r}, got {actual_value!r}"
            )

    result_by_key = {entry["candidateKey"]: entry for entry in first["results"]}
    for expected_entry in expected.get("results", []):
        key = expected_entry.get("candidateKey")
        actual = result_by_key.get(key)
        if actual is None:
            failures.append(f"missing expected result entry: {key!r}")
            continue
        for field in (
            "decision",
            "referenceStatus",
            "currentClassification",
            "eligible",
            "ineligibilityReasons",
            "changedFields",
        ):
            if field in expected_entry and actual.get(field) != expected_entry[field]:
                failures.append(
                    f"{key}.{field}: expected {expected_entry[field]!r}, got {actual.get(field)!r}"
                )

    eligible_keys = [item["candidateKey"] for item in first["eligibleCandidates"]]
    if eligible_keys != expected.get("eligibleCandidateKeys", []):
        failures.append(
            f"eligibleCandidateKeys: expected {expected.get('eligibleCandidateKeys', [])!r}, got {eligible_keys!r}"
        )
    unreviewed_keys = [item["candidateKey"] for item in first["unreviewedCandidates"]]
    if unreviewed_keys != expected.get("unreviewedCandidateKeys", []):
        failures.append(
            f"unreviewedCandidateKeys: expected {expected.get('unreviewedCandidateKeys', [])!r}, got {unreviewed_keys!r}"
        )
    return failures, first


def main():
    args = parse_args()
    if args.fixture:
        fixture_path = resolve_path(args.fixture)
        try:
            fixture = load_json(fixture_path, "approval reconciliation fixture")
            failures, result = validate_fixture(fixture)
        except (FileNotFoundError, OSError, ValueError) as error:
            print(f"Interaction approval reconciliation fixture failed: {error}", file=sys.stderr)
            return 1
        if failures:
            for failure in failures:
                print(f"[R900] {failure}", file=sys.stderr)
            return 1
        print("Interaction Approval Reconciliation Fixture")
        print(f"- fixture: {display_path(fixture_path)}")
        print(f"- approvals: {result['summary']['approvalEntryCount']}")
        print(f"- current candidates: {result['summary']['currentCandidateCount']}")
        print(f"- eligible: {result['summary']['eligibleCandidateCount']}")
        print(f"- unreviewed: {result['summary']['unreviewedCandidateCount']}")
        print("fixture reconciliation passed")
        return 0

    report_path = resolve_path(args.report)
    approval_path = resolve_path(args.approvals)
    output_path = resolve_path(args.output)
    try:
        report = load_json(report_path, "analysis review report")
        approvals = load_json(approval_path, "interaction approval")
    except (FileNotFoundError, OSError, ValueError) as error:
        print(f"Interaction approval reconciliation failed: {error}", file=sys.stderr)
        return 1

    approval_errors = validate_approval_artifact(approvals)
    if approval_errors:
        print_approval_errors(approval_errors)
        return 1

    target_url, current_items, current_errors = extract_current_candidates(report)
    if current_errors:
        print_current_errors(current_errors)
        return 1
    if approvals["target"]["url"] != target_url:
        print("Interaction approval reconciliation failed:", file=sys.stderr)
        print(
            f"[R001] target scope mismatch: approval={approvals['target']['url']!r}, current={target_url!r}",
            file=sys.stderr,
        )
        return 1

    result = reconcile_approvals(target_url, current_items, approvals)
    try:
        write_result(output_path, result)
    except OSError as error:
        print(f"Interaction approval reconciliation failed: {error}", file=sys.stderr)
        return 1

    print("Interaction Approval Reconciliation")
    print(f"- report: {display_path(report_path)}")
    print(f"- approvals: {display_path(approval_path)}")
    print(f"- output: {display_path(output_path)}")
    print(f"- current candidates: {result['summary']['currentCandidateCount']}")
    print(f"- approval entries: {result['summary']['approvalEntryCount']}")
    print(f"- eligible: {result['summary']['eligibleCandidateCount']}")
    print(f"- unreviewed: {result['summary']['unreviewedCandidateCount']}")
    print("reconciliation completed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
