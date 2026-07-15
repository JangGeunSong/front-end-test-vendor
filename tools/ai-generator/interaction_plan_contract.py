import json
import re
from pathlib import Path, PurePosixPath

from validate_interaction_approvals import (
    CANDIDATE_KEY_PATTERN,
    CONFIDENCE_LEVELS,
    ROOT_DIR,
    is_absolute_http_url,
    is_non_empty_string,
)


GENERATED_DIR = ROOT_DIR / "tools" / "ai-generator" / "generated"
DEFAULT_RECONCILIATION_PATH = GENERATED_DIR / "interaction_approval_reconciliation.json"
DEFAULT_ANALYSIS_REPORT_PATH = GENERATED_DIR / "analysis_review_report.json"
DEFAULT_INTERACTION_PLAN_PATH = GENERATED_DIR / "interaction_plan.generated.json"

PLAN_SCHEMA_VERSION = "1.0"
RECONCILIATION_SCHEMA_VERSION = "1.0"
ANALYSIS_REPORT_VERSION = "1.0"

TEMPLATE_BY_INTERACTION_KIND = {
    "tab": "interaction.tabSelection",
    "accordion": "interaction.expandedToggle",
    "expandCollapse": "interaction.expandedToggle",
}
SUPPORTED_TEMPLATES = frozenset(TEMPLATE_BY_INTERACTION_KIND.values())
INTERACTION_KINDS_BY_TEMPLATE = {
    template: frozenset(
        kind for kind, mapped_template in TEMPLATE_BY_INTERACTION_KIND.items()
        if mapped_template == template
    )
    for template in SUPPORTED_TEMPLATES
}

ELIGIBLE_FIELDS = {
    "candidateKey",
    "currentClassification",
    "interactionKind",
    "confidence",
    "pageContext",
    "selector",
    "text",
}
PLAN_TOP_LEVEL_FIELDS = {"schemaVersion", "target", "source", "tests"}
PLAN_TARGET_FIELDS = {"url"}
PLAN_SOURCE_FIELDS = {"reconciliationPath", "analysisReportPath"}
PLAN_TEST_FIELDS = {
    "id",
    "title",
    "candidateKey",
    "template",
    "pageContext",
    "target",
    "initialState",
    "expectedState",
    "reset",
}
PLAN_TEST_TARGET_FIELDS = {"selector", "interactionKind"}
PLAN_RESET_FIELDS = {"required", "strategy", "restoredState"}

TEST_ID_PATTERN = re.compile(
    r"^interaction-test:(selector|fallback):([0-9a-f]{24}):(tabSelection|expandedToggle)$"
)


def resolve_path(value):
    path = Path(value)
    return path if path.is_absolute() else ROOT_DIR / path


def display_path(path):
    try:
        return path.relative_to(ROOT_DIR).as_posix()
    except ValueError:
        return str(path)


def portable_source_path(path):
    resolved = path.resolve()
    try:
        return resolved.relative_to(ROOT_DIR.resolve()).as_posix()
    except ValueError as error:
        raise ValueError(f"input path must be inside the repository: {path}") from error


def is_portable_relative_path(value):
    if not is_non_empty_string(value) or "\\" in value:
        return False
    path = PurePosixPath(value)
    parts = path.parts
    return (
        bool(parts)
        and not path.is_absolute()
        and ":" not in parts[0]
        and all(part not in {"", ".", ".."} for part in parts)
    )


def load_json(path, label):
    if not path.exists():
        raise FileNotFoundError(f"{label} file not found: {display_path(path)}")
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as error:
        raise ValueError(
            f"{label} JSON parse failed: {display_path(path)} ({error})"
        ) from error


def render_json(value):
    return json.dumps(value, ensure_ascii=False, indent=2) + "\n"


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(render_json(value), encoding="utf-8")


def stable_test_id(candidate_key, template):
    if CANDIDATE_KEY_PATTERN.fullmatch(candidate_key) is None:
        raise ValueError(f"invalid candidateKey for test id: {candidate_key!r}")
    if template not in SUPPORTED_TEMPLATES:
        raise ValueError(f"unsupported template for test id: {template!r}")
    _, identity_kind, digest = candidate_key.split(":")
    template_name = template.split(".", 1)[1]
    return f"interaction-test:{identity_kind}:{digest}:{template_name}"


def add_input_error(errors, code, path, message):
    errors.append((code, path, message))


def reject_unknown_fields(value, allowed, path, code, errors):
    if not isinstance(value, dict):
        return
    for field in sorted(set(value) - allowed):
        add_input_error(errors, code, f"{path}.{field}", "unknown field")


def validate_eligible_candidates(reconciliation, errors):
    items = reconciliation.get("eligibleCandidates")
    if not isinstance(items, list):
        add_input_error(
            errors,
            "I006",
            "$.reconciliation.eligibleCandidates",
            "eligibleCandidates is required and must be an array",
        )
        return []

    eligible = []
    seen_keys = set()
    for index, item in enumerate(items):
        path = f"$.reconciliation.eligibleCandidates[{index}]"
        if not isinstance(item, dict):
            add_input_error(errors, "I101", path, "eligible candidate must be an object")
            continue
        reject_unknown_fields(item, ELIGIBLE_FIELDS, path, "I102", errors)

        candidate_key = item.get("candidateKey")
        if not isinstance(candidate_key, str) or CANDIDATE_KEY_PATTERN.fullmatch(candidate_key) is None:
            add_input_error(errors, "I103", f"{path}.candidateKey", "invalid interaction candidateKey")
        elif candidate_key in seen_keys:
            add_input_error(errors, "I104", f"{path}.candidateKey", f"duplicate eligible candidateKey: {candidate_key}")
        else:
            seen_keys.add(candidate_key)

        if item.get("currentClassification") != "safe":
            add_input_error(
                errors,
                "I105",
                f"{path}.currentClassification",
                "eligible candidate currentClassification must be 'safe'",
            )
        if not is_non_empty_string(item.get("interactionKind")):
            add_input_error(errors, "I106", f"{path}.interactionKind", "interactionKind is required")
        if item.get("confidence") not in CONFIDENCE_LEVELS:
            add_input_error(errors, "I107", f"{path}.confidence", "confidence is invalid")
        for field in ("pageContext", "selector", "text"):
            if not isinstance(item.get(field), str):
                add_input_error(errors, "I108", f"{path}.{field}", "field is required and must be a string")
        eligible.append(item)
    return eligible


def validate_reconciliation_input(reconciliation, errors):
    if not isinstance(reconciliation, dict):
        add_input_error(errors, "I001", "$.reconciliation", "top-level value must be an object")
        return "", []
    if reconciliation.get("schemaVersion") != RECONCILIATION_SCHEMA_VERSION:
        add_input_error(
            errors,
            "I002",
            "$.reconciliation.schemaVersion",
            f"schemaVersion must be {RECONCILIATION_SCHEMA_VERSION!r}",
        )
    target = reconciliation.get("target")
    target_url = target.get("url") if isinstance(target, dict) else None
    if not is_absolute_http_url(target_url):
        add_input_error(
            errors,
            "I003",
            "$.reconciliation.target.url",
            "target.url must be an absolute HTTP(S) URL",
        )
    eligible = validate_eligible_candidates(reconciliation, errors)
    return target_url if isinstance(target_url, str) else "", eligible


def report_candidate_sections(report, errors):
    sections = (
        ("safeInteractionCandidates", "safe", False),
        ("unsafeActionCandidates", "unsafe", False),
        ("unresolvedCandidates", "unknown", True),
    )
    candidates = []
    seen_keys = set()
    for section, classification, interaction_only in sections:
        items = report.get(section)
        if not isinstance(items, list):
            add_input_error(
                errors,
                "I205",
                f"$.report.{section}",
                "section is required and must be an array",
            )
            continue
        for index, item in enumerate(items):
            path = f"$.report.{section}[{index}]"
            if not isinstance(item, dict):
                add_input_error(errors, "I206", path, "candidate must be an object")
                continue
            if interaction_only and item.get("candidateSubtype") != "interaction":
                continue
            candidate_key = item.get("candidateKey")
            if not isinstance(candidate_key, str) or CANDIDATE_KEY_PATTERN.fullmatch(candidate_key) is None:
                add_input_error(errors, "I207", f"{path}.candidateKey", "invalid interaction candidateKey")
                continue
            if candidate_key in seen_keys:
                add_input_error(errors, "I208", f"{path}.candidateKey", f"duplicate report candidateKey: {candidate_key}")
            else:
                seen_keys.add(candidate_key)
            if item.get("classification") != classification:
                add_input_error(
                    errors,
                    "I209",
                    f"{path}.classification",
                    f"section requires classification {classification!r}",
                )
            aria = item.get("ariaAttributes")
            if not isinstance(aria, dict) or any(
                not isinstance(key, str) or not isinstance(value, str)
                for key, value in (aria.items() if isinstance(aria, dict) else [])
            ):
                add_input_error(
                    errors,
                    "I210",
                    f"{path}.ariaAttributes",
                    "ariaAttributes must be an object with string keys and values",
                )
            if classification == "safe":
                if item.get("confidence") not in CONFIDENCE_LEVELS:
                    add_input_error(errors, "I211", f"{path}.confidence", "confidence is invalid")
                for field in ("pageContext", "selector", "text"):
                    if not isinstance(item.get(field), str):
                        add_input_error(errors, "I212", f"{path}.{field}", "field is required and must be a string")
                if not is_non_empty_string(item.get("interactionKind")):
                    add_input_error(errors, "I213", f"{path}.interactionKind", "safe candidate interactionKind is required")
            candidates.append(item)
    candidates.sort(key=lambda item: item.get("candidateKey", ""))
    return candidates


def validate_report_input(report, errors):
    if not isinstance(report, dict):
        add_input_error(errors, "I201", "$.report", "top-level value must be an object")
        return "", []
    if report.get("version") != ANALYSIS_REPORT_VERSION:
        add_input_error(
            errors,
            "I202",
            "$.report.version",
            f"version must be {ANALYSIS_REPORT_VERSION!r}",
        )
    summary = report.get("summary")
    target_url = summary.get("targetUrl") if isinstance(summary, dict) else None
    if not is_absolute_http_url(target_url):
        add_input_error(
            errors,
            "I203",
            "$.report.summary.targetUrl",
            "targetUrl must be an absolute HTTP(S) URL",
        )
    return target_url if isinstance(target_url, str) else "", report_candidate_sections(report, errors)


def bind_plan_inputs(reconciliation, report):
    errors = []
    reconciliation_target, eligible = validate_reconciliation_input(reconciliation, errors)
    report_target, candidates = validate_report_input(report, errors)
    if reconciliation_target and report_target and reconciliation_target != report_target:
        add_input_error(
            errors,
            "I301",
            "$.target",
            f"target mismatch: reconciliation={reconciliation_target!r}, report={report_target!r}",
        )

    report_by_key = {item["candidateKey"]: item for item in candidates if "candidateKey" in item}
    eligible_by_key = {}
    exact_fields = (
        ("currentClassification", "classification"),
        ("interactionKind", "interactionKind"),
        ("confidence", "confidence"),
        ("pageContext", "pageContext"),
        ("selector", "selector"),
        ("text", "text"),
    )
    for item in eligible:
        candidate_key = item.get("candidateKey")
        if not isinstance(candidate_key, str):
            continue
        eligible_by_key[candidate_key] = item
        current = report_by_key.get(candidate_key)
        if current is None:
            add_input_error(
                errors,
                "I302",
                f"$.reconciliation.eligibleCandidates[{candidate_key}]",
                "eligible candidate exact candidateKey is missing from the analysis report",
            )
            continue
        for eligible_field, report_field in exact_fields:
            if item.get(eligible_field) != current.get(report_field):
                add_input_error(
                    errors,
                    "I303",
                    f"$.reconciliation.eligibleCandidates[{candidate_key}].{eligible_field}",
                    f"eligible/report exact evidence mismatch for {report_field}",
                )
    return {
        "targetUrl": reconciliation_target,
        "eligibleByKey": eligible_by_key,
        "reportByKey": report_by_key,
        "errors": errors,
    }
