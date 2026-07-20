import argparse
import json
import re
import sys
from datetime import datetime
from pathlib import Path

from interaction_url import has_url_credentials, is_absolute_http_url, is_same_origin


ROOT_DIR = Path(__file__).resolve().parents[2]
DEFAULT_APPROVAL_PATH = (
    ROOT_DIR / "tools" / "ai-generator" / "review" / "interaction_approvals.json"
)
SUPPORTED_SCHEMA_VERSION = "3.0"
CANDIDATE_KEY_PATTERN = re.compile(
    r"^interaction:(?:selector|fallback):[0-9a-f]{24}$"
)
DECISIONS = {"approved", "held", "rejected"}
CLASSIFICATIONS = {"safe", "unsafe", "unknown"}
CONFIDENCE_LEVELS = {"high", "medium", "low"}
TAB_RESTORE_UNAVAILABLE_REASONS = {
    "missingTabGroupEvidence",
    "missingPreviousSelection",
    "ambiguousPreviousSelection",
    "invalidRestoreTarget",
}

TOP_LEVEL_FIELDS = {"schemaVersion", "target", "approvals"}
TARGET_FIELDS = {"url"}
APPROVAL_FIELDS = {"candidateKey", "decision", "evidenceSnapshot", "review"}
SNAPSHOT_REQUIRED_FIELDS = {
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
}
SNAPSHOT_CONDITIONAL_FIELDS = {"interactionKind", "actionKind", "riskLevel", "tabRestore"}
SNAPSHOT_FIELDS = SNAPSHOT_REQUIRED_FIELDS | SNAPSHOT_CONDITIONAL_FIELDS
REVIEW_FIELDS = {"reviewer", "reviewedAt", "note"}
ARIA_ATTRIBUTE_FIELDS = {
    "label",
    "expanded",
    "pressed",
    "selected",
    "controls",
    "haspopup",
    "readonly",
}
TAB_RESTORE_FIELDS = {"strategy", "tabGroupSelector", "target"}
TAB_RESTORE_TARGET_FIELDS = {
    "candidateKey",
    "selector",
    "observedUrl",
    "pageContext",
    "role",
    "tagName",
    "text",
    "ariaAttributes",
}
TAB_RESTORE_ARIA_FIELDS = {"selected"}


def parse_args():
    parser = argparse.ArgumentParser(
        description="Validate a human-authored interaction approval artifact."
    )
    parser.add_argument(
        "--input",
        default=str(DEFAULT_APPROVAL_PATH),
        help="Path to interaction_approvals.json.",
    )
    parser.add_argument(
        "--fixture",
        help="Optional validator fixture containing named approval artifact cases.",
    )
    return parser.parse_args()


def resolve_path(value):
    path = Path(value)
    return path if path.is_absolute() else ROOT_DIR / path


def display_path(path):
    try:
        return path.relative_to(ROOT_DIR).as_posix()
    except ValueError:
        return str(path)


def load_json(path, label="interaction approval"):
    if not path.exists():
        raise FileNotFoundError(f"{label} file not found: {display_path(path)}")
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as error:
        raise ValueError(
            f"{label} JSON parse failed: {display_path(path)} ({error})"
        ) from error


def is_non_empty_string(value):
    return isinstance(value, str) and bool(value.strip())


def is_timezone_aware_timestamp(value):
    if not is_non_empty_string(value) or "T" not in value:
        return False
    normalized = value[:-1] + "+00:00" if value.endswith("Z") else value
    try:
        parsed = datetime.fromisoformat(normalized)
    except ValueError:
        return False
    return parsed.tzinfo is not None and parsed.utcoffset() is not None


def add_error(errors, code, path, message):
    errors.append((code, path, message))


def reject_unknown_fields(value, allowed, path, code, errors):
    if not isinstance(value, dict):
        return
    for field in sorted(set(value) - allowed):
        add_error(errors, code, f"{path}.{field}", "unknown field")


def validate_tab_restore(tab_restore, path, snapshot, target_url, errors):
    if not isinstance(tab_restore, dict):
        add_error(errors, "E126", path, "tabRestore must be an object")
        return
    reject_unknown_fields(tab_restore, TAB_RESTORE_FIELDS, path, "E127", errors)
    if tab_restore.get("strategy") != "restorePreviousSelection":
        add_error(
            errors,
            "E128",
            f"{path}.strategy",
            "strategy must be 'restorePreviousSelection'",
        )
    if not is_non_empty_string(tab_restore.get("tabGroupSelector")):
        add_error(
            errors,
            "E129",
            f"{path}.tabGroupSelector",
            "tabGroupSelector is required and must be a non-empty string",
        )

    target = tab_restore.get("target")
    target_path = f"{path}.target"
    if not isinstance(target, dict):
        add_error(errors, "E130", target_path, "restore target must be an object")
        return
    reject_unknown_fields(target, TAB_RESTORE_TARGET_FIELDS, target_path, "E131", errors)

    candidate_key = target.get("candidateKey")
    if not isinstance(candidate_key, str) or CANDIDATE_KEY_PATTERN.fullmatch(candidate_key) is None:
        add_error(errors, "E132", f"{target_path}.candidateKey", "invalid restore candidateKey")
    for field in ("selector", "observedUrl", "pageContext", "role", "tagName", "text"):
        if not isinstance(target.get(field), str):
            add_error(errors, "E133", f"{target_path}.{field}", "field is required and must be a string")
    if not is_non_empty_string(target.get("selector")):
        add_error(errors, "E134", f"{target_path}.selector", "restore selector must be non-empty")
    if target.get("selector") == snapshot.get("selector"):
        add_error(errors, "E135", f"{target_path}.selector", "restore selector must differ from interaction selector")
    if target.get("observedUrl") != snapshot.get("observedUrl"):
        add_error(errors, "E136", f"{target_path}.observedUrl", "restore observedUrl must exactly match interaction observedUrl")
    if target.get("pageContext") != snapshot.get("pageContext"):
        add_error(errors, "E137", f"{target_path}.pageContext", "restore pageContext must exactly match interaction pageContext")
    restore_url = target.get("observedUrl")
    if has_url_credentials(restore_url):
        add_error(errors, "E138", f"{target_path}.observedUrl", "restore observedUrl must not contain credentials")
    elif not is_absolute_http_url(restore_url):
        add_error(errors, "E139", f"{target_path}.observedUrl", "restore observedUrl must be absolute HTTP(S)")
    elif is_absolute_http_url(target_url) and not is_same_origin(target_url, restore_url):
        add_error(errors, "E140", f"{target_path}.observedUrl", "restore observedUrl must be same-origin with target.url")
    if target.get("role") != "tab":
        add_error(errors, "E141", f"{target_path}.role", "restore role must be 'tab'")
    tag_name = target.get("tagName")
    if not is_non_empty_string(tag_name) or tag_name != tag_name.lower():
        add_error(errors, "E142", f"{target_path}.tagName", "restore tagName must be non-empty lowercase")

    aria = target.get("ariaAttributes")
    if not isinstance(aria, dict):
        add_error(errors, "E143", f"{target_path}.ariaAttributes", "restore ariaAttributes must be an object")
    else:
        reject_unknown_fields(aria, TAB_RESTORE_ARIA_FIELDS, f"{target_path}.ariaAttributes", "E144", errors)
        if aria.get("selected") != "true":
            add_error(errors, "E145", f"{target_path}.ariaAttributes.selected", "restore selected must be 'true'")


def validate_snapshot(snapshot, path, target_url, decision, errors):
    if not isinstance(snapshot, dict):
        add_error(errors, "E106", path, "evidenceSnapshot is required and must be an object")
        return

    reject_unknown_fields(snapshot, SNAPSHOT_FIELDS, path, "E107", errors)

    classification = snapshot.get("classification")
    if classification not in CLASSIFICATIONS:
        add_error(
            errors,
            "E108",
            f"{path}.classification",
            f"classification must be one of {sorted(CLASSIFICATIONS)}",
        )

    confidence = snapshot.get("confidence")
    if confidence not in CONFIDENCE_LEVELS:
        add_error(
            errors,
            "E109",
            f"{path}.confidence",
            f"confidence must be one of {sorted(CONFIDENCE_LEVELS)}",
        )

    for field in sorted(
        SNAPSHOT_REQUIRED_FIELDS
        - {"classification", "confidence", "ariaAttributes", "observedUrl"}
    ):
        if not isinstance(snapshot.get(field), str):
            add_error(errors, "E110", f"{path}.{field}", "field is required and must be a string")

    observed_url = snapshot.get("observedUrl")
    if has_url_credentials(observed_url):
        add_error(errors, "E124", f"{path}.observedUrl", "observedUrl must not contain credentials")
    elif not is_absolute_http_url(observed_url):
        add_error(
            errors,
            "E123",
            f"{path}.observedUrl",
            "observedUrl is required and must be an absolute HTTP(S) URL",
        )
    elif is_absolute_http_url(target_url) and not is_same_origin(target_url, observed_url):
        add_error(
            errors,
            "E125",
            f"{path}.observedUrl",
            "observedUrl must be same-origin with target.url",
        )

    tag_name = snapshot.get("tagName")
    if isinstance(tag_name, str) and tag_name != tag_name.lower():
        add_error(errors, "E111", f"{path}.tagName", "tagName must be normalized lowercase")

    aria = snapshot.get("ariaAttributes")
    if not isinstance(aria, dict):
        add_error(errors, "E112", f"{path}.ariaAttributes", "ariaAttributes is required and must be an object")
    else:
        reject_unknown_fields(aria, ARIA_ATTRIBUTE_FIELDS, f"{path}.ariaAttributes", "E113", errors)
        for field in sorted(aria):
            if not isinstance(aria[field], str):
                add_error(
                    errors,
                    "E114",
                    f"{path}.ariaAttributes.{field}",
                    "ARIA attribute value must be a string",
                )

    expected_conditional = {
        "safe": {"interactionKind"},
        "unsafe": {"actionKind", "riskLevel"},
        "unknown": set(),
    }.get(classification, set())
    for field in sorted(expected_conditional):
        if not is_non_empty_string(snapshot.get(field)):
            add_error(
                errors,
                "E115",
                f"{path}.{field}",
                f"{field} is required and must be a non-empty string for {classification!r} classification",
            )
    for field in sorted(
        SNAPSHOT_CONDITIONAL_FIELDS - expected_conditional - {"tabRestore"}
    ):
        if field in snapshot:
            add_error(
                errors,
                "E116",
                f"{path}.{field}",
                f"{field} is not allowed for {classification!r} classification",
            )

    interaction_kind = snapshot.get("interactionKind")
    selected = aria.get("selected") if isinstance(aria, dict) else None
    tab_restore = snapshot.get("tabRestore")
    is_unselected_tab = classification == "safe" and interaction_kind == "tab" and selected == "false"
    if decision == "approved" and is_unselected_tab and tab_restore is None:
        add_error(
            errors,
            "E146",
            f"{path}.tabRestore",
            "approved unselected tab requires tabRestore evidence",
        )
    if tab_restore is not None:
        if not is_unselected_tab:
            add_error(
                errors,
                "E147",
                f"{path}.tabRestore",
                "tabRestore is only allowed for a safe unselected tab",
            )
        validate_tab_restore(tab_restore, f"{path}.tabRestore", snapshot, target_url, errors)


def validate_review(review, path, errors):
    if not isinstance(review, dict):
        add_error(errors, "E117", path, "review is required and must be an object")
        return

    reject_unknown_fields(review, REVIEW_FIELDS, path, "E118", errors)
    if not is_non_empty_string(review.get("reviewer")):
        add_error(errors, "E119", f"{path}.reviewer", "reviewer is required and must be a non-empty string")
    if not is_timezone_aware_timestamp(review.get("reviewedAt")):
        add_error(
            errors,
            "E120",
            f"{path}.reviewedAt",
            "reviewedAt must be an ISO 8601 timestamp with a timezone offset or Z",
        )
    if "note" in review and not is_non_empty_string(review.get("note")):
        add_error(errors, "E121", f"{path}.note", "note must be a non-empty string when present")


def validate_approval_entry(entry, index, seen_keys, target_url, errors):
    path = f"$.approvals[{index}]"
    if not isinstance(entry, dict):
        add_error(errors, "E101", path, "approval entry must be an object")
        return

    reject_unknown_fields(entry, APPROVAL_FIELDS, path, "E102", errors)

    candidate_key = entry.get("candidateKey")
    if not isinstance(candidate_key, str) or CANDIDATE_KEY_PATTERN.fullmatch(candidate_key) is None:
        add_error(
            errors,
            "E103",
            f"{path}.candidateKey",
            "candidateKey must match interaction:<selector|fallback>:<24 lowercase hex characters>",
        )
    elif candidate_key in seen_keys:
        add_error(errors, "E104", f"{path}.candidateKey", f"duplicate candidateKey: {candidate_key}")
    else:
        seen_keys.add(candidate_key)

    decision = entry.get("decision")
    if decision not in DECISIONS:
        add_error(
            errors,
            "E105",
            f"{path}.decision",
            f"decision must be one of {sorted(DECISIONS)}",
        )

    snapshot = entry.get("evidenceSnapshot")
    validate_snapshot(snapshot, f"{path}.evidenceSnapshot", target_url, decision, errors)
    if (
        decision == "approved"
        and isinstance(snapshot, dict)
        and snapshot.get("classification") != "safe"
    ):
        add_error(
            errors,
            "E122",
            f"{path}.evidenceSnapshot.classification",
            "approved decision requires snapshot classification 'safe'",
        )

    validate_review(entry.get("review"), f"{path}.review", errors)


def validate_approval_artifact(artifact):
    errors = []
    if not isinstance(artifact, dict):
        add_error(errors, "E001", "$", "top-level value must be an object")
        return errors

    reject_unknown_fields(artifact, TOP_LEVEL_FIELDS, "$", "E002", errors)

    version = artifact.get("schemaVersion")
    if version is None:
        add_error(errors, "E003", "$.schemaVersion", "schemaVersion is required")
    elif version != SUPPORTED_SCHEMA_VERSION:
        add_error(
            errors,
            "E004",
            "$.schemaVersion",
            f"unsupported schemaVersion {version!r}; expected {SUPPORTED_SCHEMA_VERSION!r}",
        )

    target = artifact.get("target")
    if not isinstance(target, dict):
        add_error(errors, "E005", "$.target", "target is required and must be an object")
    else:
        reject_unknown_fields(target, TARGET_FIELDS, "$.target", "E006", errors)
        if not is_absolute_http_url(target.get("url")):
            add_error(
                errors,
                "E007",
                "$.target.url",
                "target.url is required and must be a non-empty absolute HTTP(S) URL",
            )

    approvals = artifact.get("approvals")
    if not isinstance(approvals, list):
        add_error(errors, "E008", "$.approvals", "approvals is required and must be an array")
        return errors

    target_url = target.get("url") if isinstance(target, dict) else ""
    seen_keys = set()
    for index, entry in enumerate(approvals):
        validate_approval_entry(entry, index, seen_keys, target_url, errors)
    return errors


def print_report(path, errors):
    print("Interaction Approval Validation")
    print(f"- approval: {display_path(path)}")
    print()
    print("Errors:")
    if errors:
        for code, field_path, message in errors:
            print(f"[{code}] {field_path}: {message}")
    else:
        print("- none")
    print()
    print("Summary:")
    print(f"- errors: {len(errors)}")
    if not errors:
        print()
        print("validation passed")


def validate_fixture(fixture):
    cases = fixture.get("cases") if isinstance(fixture, dict) else None
    if not isinstance(cases, list) or not cases:
        raise ValueError("approval validator fixture requires a non-empty cases array")

    failures = []
    for index, case in enumerate(cases):
        if not isinstance(case, dict):
            failures.append(f"cases[{index}] must be an object")
            continue
        scenario = case.get("scenario")
        artifact = case.get("artifact")
        expected_codes = case.get("expectedCodes")
        if not is_non_empty_string(scenario) or not isinstance(expected_codes, list):
            failures.append(f"cases[{index}] requires scenario and expectedCodes")
            continue
        actual_codes = [code for code, _, _ in validate_approval_artifact(artifact)]
        if actual_codes != expected_codes:
            failures.append(
                f"{scenario}: expected codes {expected_codes!r}, got {actual_codes!r}"
            )

    observed_url_cases = fixture.get("observedUrlCases", [])
    if not isinstance(observed_url_cases, list):
        raise ValueError("approval validator fixture observedUrlCases must be an array")
    for index, case in enumerate(observed_url_cases):
        if not isinstance(case, dict):
            failures.append(f"observedUrlCases[{index}] must be an object")
            continue
        snapshot = {
            "classification": "safe",
            "confidence": "high",
            "pageContext": "Overview",
            "observedUrl": case.get("value"),
            "selector": "main [role='tab']",
            "text": "Overview",
            "role": "tab",
            "type": "",
            "tagName": "li",
            "ariaAttributes": {"selected": "false"},
            "interactionKind": "tab",
        }
        if case.get("omit") is True:
            snapshot.pop("observedUrl")
        artifact = {
            "schemaVersion": SUPPORTED_SCHEMA_VERSION,
            "target": {"url": "https://sample.local/"},
            "approvals": [
                {
                    "candidateKey": "interaction:selector:999999999999999999999999",
                    "decision": "held",
                    "evidenceSnapshot": snapshot,
                    "review": {
                        "reviewer": "fixture-reviewer",
                        "reviewedAt": "2026-07-16T09:30:00Z",
                    },
                }
            ],
        }
        actual_codes = [code for code, _, _ in validate_approval_artifact(artifact)]
        if actual_codes != case.get("expectedCodes"):
            failures.append(
                f"{case.get('scenario')}: expected codes {case.get('expectedCodes')!r}, "
                f"got {actual_codes!r}"
            )
    return failures, len(cases) + len(observed_url_cases)


def main():
    args = parse_args()
    if args.fixture:
        fixture_path = resolve_path(args.fixture)
        try:
            fixture = load_json(fixture_path, "approval validator fixture")
            failures, case_count = validate_fixture(fixture)
        except (FileNotFoundError, OSError, ValueError) as error:
            print(f"Interaction approval fixture validation failed: {error}", file=sys.stderr)
            return 1
        if failures:
            for failure in failures:
                print(f"[E900] {failure}", file=sys.stderr)
            return 1
        print("Interaction Approval Fixture Validation")
        print(f"- fixture: {display_path(fixture_path)}")
        print(f"- scenarios: {case_count}")
        print("fixture validation passed")
        return 0

    path = resolve_path(args.input)
    try:
        artifact = load_json(path)
    except (FileNotFoundError, OSError, ValueError) as error:
        print("Interaction Approval Validation")
        print(f"- approval: {display_path(path)}")
        print()
        print(f"Error: {error}")
        return 1

    errors = validate_approval_artifact(artifact)
    print_report(path, errors)
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
