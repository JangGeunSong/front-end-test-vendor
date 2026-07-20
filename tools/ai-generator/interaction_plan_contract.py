import json
import re
from pathlib import Path, PurePosixPath

from interaction_url import is_same_origin

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

PLAN_SCHEMA_VERSION = "3.0"
RECONCILIATION_SCHEMA_VERSION = "3.0"
ANALYSIS_REPORT_VERSION = "2.1"

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
    "observedUrl",
    "selector",
    "text",
    "tabRestore",
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
    "startUrl",
    "target",
    "initialState",
    "expectedState",
    "restore",
    "restoredState",
    "reset",
}
PLAN_TEST_TARGET_FIELDS = {"selector", "interactionKind", "tabGroupSelector"}
PLAN_RESET_FIELDS = {"required", "strategy", "restoredState"}
PLAN_RESTORE_FIELDS = {"strategy", "target"}
PLAN_RESTORE_TARGET_FIELDS = {"candidateKey", "selector"}
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

TAB_INITIAL_STATE = {
    "interactionTarget": {"selected": False},
    "restoreTarget": {"selected": True},
}
TAB_EXPECTED_STATE = {
    "interactionTarget": {"selected": True},
    "restoreTarget": {"selected": False},
}
TAB_RESTORED_STATE = TAB_INITIAL_STATE
EXPANDED_INITIAL_STATE = {"expanded": False}
EXPANDED_EXPECTED_STATE = {"expanded": True}

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
    temporary_path = path.with_name(f"{path.name}.tmp")
    try:
        temporary_path.write_text(render_json(value), encoding="utf-8", newline="\n")
        temporary_path.replace(path)
    finally:
        if temporary_path.exists():
            temporary_path.unlink()


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


def nested_value(value, path):
    current = value
    for part in path.split("."):
        if not isinstance(current, dict) or part not in current:
            return None
        current = current[part]
    return current


def validate_tab_restore_evidence(restore, candidate, path, target_url, errors):
    if not isinstance(restore, dict):
        add_input_error(errors, "I113", path, "tabRestore must be an object")
        return False
    reject_unknown_fields(restore, TAB_RESTORE_FIELDS, path, "I113", errors)
    target = restore.get("target")
    valid = (
        restore.get("strategy") == "restorePreviousSelection"
        and is_non_empty_string(restore.get("tabGroupSelector"))
        and isinstance(target, dict)
    )
    if not isinstance(target, dict):
        add_input_error(errors, "I113", f"{path}.target", "restore target must be an object")
        return False
    reject_unknown_fields(target, TAB_RESTORE_TARGET_FIELDS, f"{path}.target", "I113", errors)
    aria = target.get("ariaAttributes")
    valid = valid and (
        isinstance(target.get("candidateKey"), str)
        and CANDIDATE_KEY_PATTERN.fullmatch(target.get("candidateKey", "")) is not None
        and is_non_empty_string(target.get("selector"))
        and target.get("selector") != candidate.get("selector")
        and target.get("observedUrl") == candidate.get("observedUrl")
        and target.get("pageContext") == candidate.get("pageContext")
        and target.get("role") == "tab"
        and is_non_empty_string(target.get("tagName"))
        and target.get("tagName") == target.get("tagName", "").lower()
        and isinstance(target.get("text"), str)
        and isinstance(aria, dict)
        and set(aria) == {"selected"}
        and aria.get("selected") == "true"
        and is_absolute_http_url(target.get("observedUrl"))
        and is_same_origin(target_url, target.get("observedUrl"))
    )
    if not valid:
        add_input_error(errors, "I113", path, "invalid bounded tab restore evidence")
    return valid


def validate_eligible_candidates(reconciliation, target_url, errors):
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
        observed_url = item.get("observedUrl")
        if not is_absolute_http_url(observed_url):
            add_input_error(errors, "I109", f"{path}.observedUrl", "observedUrl must be an absolute HTTP(S) URL without credentials")
        elif is_absolute_http_url(target_url) and not is_same_origin(target_url, observed_url):
            add_input_error(errors, "I110", f"{path}.observedUrl", "observedUrl must be same-origin with target.url")
        interaction_kind = item.get("interactionKind")
        restore = item.get("tabRestore")
        if interaction_kind == "tab":
            if restore is None:
                add_input_error(errors, "I111", f"{path}.tabRestore", "eligible tab requires tabRestore")
            else:
                validate_tab_restore_evidence(restore, item, f"{path}.tabRestore", target_url, errors)
        elif restore is not None:
            add_input_error(errors, "I112", f"{path}.tabRestore", "tabRestore is only allowed for tab candidates")
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
    eligible = validate_eligible_candidates(reconciliation, target_url, errors)
    return target_url if isinstance(target_url, str) else "", eligible


def report_candidate_sections(report, target_url, errors):
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
                restore = item.get("tabRestore")
                selected = aria.get("selected") if isinstance(aria, dict) else None
                if item.get("interactionKind") == "tab" and selected == "false" and restore is not None:
                    validate_tab_restore_evidence(restore, item, f"{path}.tabRestore", target_url, errors)
                elif restore is not None:
                    add_input_error(errors, "I216", f"{path}.tabRestore", "tabRestore is only allowed for a safe unselected tab")
            observed_url = item.get("observedUrl")
            if not is_absolute_http_url(observed_url):
                add_input_error(errors, "I214", f"{path}.observedUrl", "observedUrl must be an absolute HTTP(S) URL without credentials")
            elif is_absolute_http_url(target_url) and not is_same_origin(target_url, observed_url):
                add_input_error(errors, "I215", f"{path}.observedUrl", "observedUrl must be same-origin with report targetUrl")
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
    return target_url if isinstance(target_url, str) else "", report_candidate_sections(report, target_url, errors)


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
        ("observedUrl", "observedUrl"),
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
        if item.get("interactionKind") == "tab":
            eligible_restore = item.get("tabRestore")
            report_restore = current.get("tabRestore")
            if not isinstance(report_restore, dict):
                add_input_error(
                    errors,
                    "I304",
                    f"$.report.safeInteractionCandidates[{candidate_key}].tabRestore",
                    "eligible tab exact restore evidence is missing from the analysis report",
                )
                continue
            restore_paths = (
                "strategy",
                "tabGroupSelector",
                "target.candidateKey",
                "target.selector",
                "target.observedUrl",
                "target.pageContext",
                "target.role",
                "target.tagName",
                "target.text",
                "target.ariaAttributes.selected",
            )
            if isinstance(eligible_restore, dict):
                for restore_path in restore_paths:
                    if nested_value(eligible_restore, restore_path) != nested_value(report_restore, restore_path):
                        add_input_error(
                            errors,
                            "I304",
                            f"$.reconciliation.eligibleCandidates[{candidate_key}].tabRestore.{restore_path}",
                            "eligible/report exact tab restore evidence mismatch",
                        )
            aria = current.get("ariaAttributes")
            if not isinstance(aria, dict) or aria.get("selected") != "false":
                add_input_error(errors, "I305", f"$.report.safeInteractionCandidates[{candidate_key}].ariaAttributes.selected", "interaction target must currently be selected=false")
            restore_key = nested_value(report_restore, "target.candidateKey")
            peer = report_by_key.get(restore_key)
            peer_aria = peer.get("ariaAttributes") if isinstance(peer, dict) else None
            peer_target = report_restore.get("target") if isinstance(report_restore, dict) else {}
            peer_matches = isinstance(peer, dict) and (
                peer.get("classification") == "safe"
                and peer.get("interactionKind") == "tab"
                and peer.get("selector") == peer_target.get("selector")
                and peer.get("observedUrl") == peer_target.get("observedUrl")
                and peer.get("pageContext") == peer_target.get("pageContext")
                and peer.get("role") == peer_target.get("role")
                and peer.get("tagName") == peer_target.get("tagName")
                and peer.get("text") == peer_target.get("text")
                and isinstance(peer_aria, dict)
                and peer_aria.get("selected") == "true"
            )
            if not peer_matches:
                add_input_error(errors, "I306", f"$.report.safeInteractionCandidates[{restore_key}]", "exact current selected restore peer is missing or changed")
    return {
        "targetUrl": reconciliation_target,
        "eligibleByKey": eligible_by_key,
        "reportByKey": report_by_key,
        "errors": errors,
    }
