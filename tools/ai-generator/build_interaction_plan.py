import argparse
import json
import sys

from interaction_plan_contract import (
    DEFAULT_ANALYSIS_REPORT_PATH,
    DEFAULT_INTERACTION_PLAN_PATH,
    DEFAULT_RECONCILIATION_PATH,
    PLAN_SCHEMA_VERSION,
    TEMPLATE_BY_INTERACTION_KIND,
    bind_plan_inputs,
    display_path,
    load_json,
    portable_source_path,
    render_json,
    resolve_path,
    stable_test_id,
    write_json,
)


UNSUPPORTED_REASONS = (
    "unsupportedInteractionKind",
    "missingStateEvidence",
    "initialStateNotSupported",
    "missingSelector",
)


def parse_args():
    parser = argparse.ArgumentParser(
        description="Build a deterministic Structured Interaction Plan from eligible candidates."
    )
    parser.add_argument(
        "--reconciliation",
        default=str(DEFAULT_RECONCILIATION_PATH),
        help="Path to interaction_approval_reconciliation.json.",
    )
    parser.add_argument(
        "--report",
        default=str(DEFAULT_ANALYSIS_REPORT_PATH),
        help="Path to analysis_review_report.json.",
    )
    parser.add_argument(
        "--output",
        default=str(DEFAULT_INTERACTION_PLAN_PATH),
        help="Path to write interaction_plan.generated.json.",
    )
    parser.add_argument(
        "--fixture",
        help="Optional builder fixture with success and input-failure scenarios.",
    )
    return parser.parse_args()


def unsupported_candidate(candidate, reason):
    return {
        "candidateKey": candidate["candidateKey"],
        "interactionKind": candidate["interactionKind"],
        "reason": reason,
    }


def deterministic_title(candidate, report_candidate, template):
    label = (
        report_candidate.get("text", "").strip()
        or candidate.get("pageContext", "").strip()
        or candidate["interactionKind"]
    )
    suffix = "tab selection" if template == "interaction.tabSelection" else "expanded toggle"
    return f"Interaction: {label} {suffix}"


def build_test_case(candidate, report_candidate, template):
    candidate_key = candidate["candidateKey"]
    interaction_kind = candidate["interactionKind"]
    common = {
        "id": stable_test_id(candidate_key, template),
        "title": deterministic_title(candidate, report_candidate, template),
        "candidateKey": candidate_key,
        "template": template,
        "pageContext": candidate["pageContext"],
        "startUrl": report_candidate["observedUrl"],
        "target": {
            "selector": candidate["selector"],
            "interactionKind": interaction_kind,
        },
    }
    if template == "interaction.tabSelection":
        common.update(
            {
                "initialState": {"selected": False},
                "expectedState": {"selected": True},
                "reset": {
                    "required": True,
                    "strategy": "reloadPage",
                    "restoredState": {"selected": False},
                },
            }
        )
    else:
        common.update(
            {
                "initialState": {"expanded": False},
                "expectedState": {"expanded": True},
                "reset": {
                    "required": True,
                    "strategy": "toggleSameTarget",
                    "restoredState": {"expanded": False},
                },
            }
        )
    return common


def build_interaction_plan(bound_inputs, reconciliation_path, report_path):
    tests = []
    unsupported = []
    for candidate_key in sorted(bound_inputs["eligibleByKey"]):
        candidate = bound_inputs["eligibleByKey"][candidate_key]
        report_candidate = bound_inputs["reportByKey"][candidate_key]
        interaction_kind = candidate["interactionKind"]
        selector = candidate["selector"]
        template = TEMPLATE_BY_INTERACTION_KIND.get(interaction_kind)

        if not selector.strip():
            unsupported.append(unsupported_candidate(candidate, "missingSelector"))
            continue
        if template is None:
            unsupported.append(unsupported_candidate(candidate, "unsupportedInteractionKind"))
            continue

        state_name = "selected" if template == "interaction.tabSelection" else "expanded"
        aria = report_candidate["ariaAttributes"]
        if state_name not in aria:
            unsupported.append(unsupported_candidate(candidate, "missingStateEvidence"))
            continue
        if aria[state_name] != "false":
            unsupported.append(unsupported_candidate(candidate, "initialStateNotSupported"))
            continue

        tests.append(build_test_case(candidate, report_candidate, template))

    tests.sort(key=lambda item: item["candidateKey"])
    unsupported.sort(key=lambda item: item["candidateKey"])
    plan = {
        "schemaVersion": PLAN_SCHEMA_VERSION,
        "target": {"url": bound_inputs["targetUrl"]},
        "source": {
            "reconciliationPath": reconciliation_path,
            "analysisReportPath": report_path,
        },
        "tests": tests,
    }
    return plan, unsupported


def print_input_errors(errors):
    print("Interaction plan input validation failed:")
    for code, path, message in errors:
        print(f"[{code}] {path}: {message}")


def summary_counts(plan, unsupported):
    template_counts = {
        "interaction.tabSelection": 0,
        "interaction.expandedToggle": 0,
    }
    for test_case in plan["tests"]:
        template_counts[test_case["template"]] += 1
    reason_counts = {reason: 0 for reason in UNSUPPORTED_REASONS}
    for item in unsupported:
        reason_counts[item["reason"]] += 1
    return template_counts, reason_counts


def validate_fixture(fixture):
    if not isinstance(fixture, dict):
        raise ValueError("interaction plan builder fixture top-level value must be an object")
    success = fixture.get("success")
    failure_cases = fixture.get("failureCases")
    if not isinstance(success, dict) or not isinstance(failure_cases, list):
        raise ValueError("builder fixture requires success object and failureCases array")

    reconciliation = success.get("reconciliation")
    report = success.get("analysisReviewReport")
    expected = success.get("expected")
    if not isinstance(expected, dict):
        raise ValueError("builder fixture success case requires expected object")
    bound = bind_plan_inputs(reconciliation, report)
    failures = []
    if bound["errors"]:
        failures.append(f"success input errors: {bound['errors']!r}")
        return failures, None, [], len(failure_cases)

    source_reconciliation = "tools/ai-generator/fixtures/interaction_plan_builder.fixture.json"
    source_report = "tools/ai-generator/fixtures/interaction_plan_builder.fixture.json"
    first_plan, first_unsupported = build_interaction_plan(
        bound, source_reconciliation, source_report
    )
    second_plan, second_unsupported = build_interaction_plan(
        bound, source_reconciliation, source_report
    )
    first_bytes = render_json(first_plan)
    second_bytes = render_json(second_plan)
    if first_bytes != second_bytes:
        failures.append("repeated plan output is not byte-stable")
    try:
        if json.loads(first_bytes) != first_plan:
            failures.append("rendered plan JSON does not round-trip to the built plan")
    except json.JSONDecodeError as error:
        failures.append(f"rendered plan JSON is invalid: {error}")
    if first_unsupported != second_unsupported:
        failures.append("repeated unsupported diagnostics are not stable")

    test_keys = [item["candidateKey"] for item in first_plan["tests"]]
    if test_keys != expected.get("testCandidateKeys"):
        failures.append(
            f"testCandidateKeys: expected {expected.get('testCandidateKeys')!r}, got {test_keys!r}"
        )
    templates = [item["template"] for item in first_plan["tests"]]
    if templates != expected.get("templates"):
        failures.append(f"templates: expected {expected.get('templates')!r}, got {templates!r}")
    test_ids = [item["id"] for item in first_plan["tests"]]
    if test_ids != expected.get("testIds"):
        failures.append(f"testIds: expected {expected.get('testIds')!r}, got {test_ids!r}")
    start_urls = [item["startUrl"] for item in first_plan["tests"]]
    if start_urls != expected.get("startUrls"):
        failures.append(
            f"startUrls: expected {expected.get('startUrls')!r}, got {start_urls!r}"
        )
    if first_unsupported != expected.get("unsupported"):
        failures.append(
            f"unsupported: expected {expected.get('unsupported')!r}, got {first_unsupported!r}"
        )

    for index, case in enumerate(failure_cases):
        if not isinstance(case, dict):
            failures.append(f"failureCases[{index}] must be an object")
            continue
        scenario = case.get("scenario")
        case_bound = bind_plan_inputs(
            case.get("reconciliation"), case.get("analysisReviewReport")
        )
        actual_codes = [code for code, _, _ in case_bound["errors"]]
        if actual_codes != case.get("expectedCodes"):
            failures.append(
                f"{scenario}: expected codes {case.get('expectedCodes')!r}, got {actual_codes!r}"
            )
    return failures, first_plan, first_unsupported, len(failure_cases)


def main():
    args = parse_args()
    if args.fixture:
        fixture_path = resolve_path(args.fixture)
        try:
            fixture = load_json(fixture_path, "interaction plan builder fixture")
            failures, plan, unsupported, failure_case_count = validate_fixture(fixture)
        except (FileNotFoundError, OSError, ValueError) as error:
            print(f"Interaction plan builder fixture failed: {error}", file=sys.stderr)
            return 1
        if failures:
            for failure in failures:
                print(f"[B900] {failure}", file=sys.stderr)
            return 1
        template_counts, _ = summary_counts(plan, unsupported)
        print("Structured Interaction Plan Builder Fixture")
        print(f"- fixture: {display_path(fixture_path)}")
        print(f"- tests: {len(plan['tests'])}")
        print(f"- tabSelection: {template_counts['interaction.tabSelection']}")
        print(f"- expandedToggle: {template_counts['interaction.expandedToggle']}")
        print(f"- unsupported: {len(unsupported)}")
        print(f"- input failure scenarios: {failure_case_count}")
        print("fixture build passed")
        return 0

    reconciliation_path = resolve_path(args.reconciliation)
    report_path = resolve_path(args.report)
    output_path = resolve_path(args.output)
    try:
        reconciliation = load_json(reconciliation_path, "interaction approval reconciliation")
        report = load_json(report_path, "analysis review report")
        reconciliation_source = portable_source_path(reconciliation_path)
        report_source = portable_source_path(report_path)
    except (FileNotFoundError, OSError, ValueError) as error:
        print(f"Structured interaction plan build failed: {error}", file=sys.stderr)
        return 1

    bound = bind_plan_inputs(reconciliation, report)
    if bound["errors"]:
        print_input_errors(bound["errors"])
        return 1

    plan, unsupported = build_interaction_plan(
        bound, reconciliation_source, report_source
    )
    try:
        write_json(output_path, plan)
    except OSError as error:
        print(f"Structured interaction plan build failed: {error}", file=sys.stderr)
        return 1

    template_counts, reason_counts = summary_counts(plan, unsupported)
    print("Structured Interaction Plan Build")
    print(f"- reconciliation: {display_path(reconciliation_path)}")
    print(f"- analysis report: {display_path(report_path)}")
    print(f"- output: {display_path(output_path)}")
    print(f"- tests: {len(plan['tests'])}")
    print(f"- interaction.tabSelection: {template_counts['interaction.tabSelection']}")
    print(f"- interaction.expandedToggle: {template_counts['interaction.expandedToggle']}")
    print(f"- unsupported: {len(unsupported)}")
    for reason in UNSUPPORTED_REASONS:
        if reason_counts[reason]:
            print(f"  - {reason}: {reason_counts[reason]}")
    for item in unsupported:
        print(f"  - {item['candidateKey']}: {item['reason']}")
    print("build completed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
