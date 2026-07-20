import argparse
import copy
import sys

from interaction_plan_contract import (
    CANDIDATE_KEY_PATTERN,
    DEFAULT_ANALYSIS_REPORT_PATH,
    DEFAULT_INTERACTION_PLAN_PATH,
    DEFAULT_RECONCILIATION_PATH,
    EXPANDED_EXPECTED_STATE,
    EXPANDED_INITIAL_STATE,
    INTERACTION_KINDS_BY_TEMPLATE,
    PLAN_RESET_FIELDS,
    PLAN_RESTORE_FIELDS,
    PLAN_RESTORE_TARGET_FIELDS,
    PLAN_SCHEMA_VERSION,
    PLAN_SOURCE_FIELDS,
    PLAN_TARGET_FIELDS,
    PLAN_TEST_FIELDS,
    PLAN_TEST_TARGET_FIELDS,
    PLAN_TOP_LEVEL_FIELDS,
    SUPPORTED_TEMPLATES,
    TAB_EXPECTED_STATE,
    TAB_INITIAL_STATE,
    TAB_RESTORED_STATE,
    TEST_ID_PATTERN,
    bind_plan_inputs,
    display_path,
    is_absolute_http_url,
    is_non_empty_string,
    is_portable_relative_path,
    is_same_origin,
    load_json,
    portable_source_path,
    resolve_path,
    stable_test_id,
)


def parse_args():
    parser = argparse.ArgumentParser(
        description="Strictly validate a Structured Interaction Plan."
    )
    parser.add_argument(
        "--input",
        default=str(DEFAULT_INTERACTION_PLAN_PATH),
        help="Path to interaction_plan.generated.json.",
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
        "--fixture",
        help="Optional validator fixture with valid and invalid plan scenarios.",
    )
    return parser.parse_args()


def add_error(errors, code, path, message):
    errors.append((code, path, message))


def reject_unknown_fields(value, allowed, path, code, errors):
    if not isinstance(value, dict):
        return
    for field in sorted(set(value) - allowed):
        add_error(errors, code, f"{path}.{field}", "unknown field")


def validate_top_level(plan, bound, expected_sources, errors):
    if not isinstance(plan, dict):
        add_error(errors, "P001", "$", "top-level value must be an object")
        return False
    reject_unknown_fields(plan, PLAN_TOP_LEVEL_FIELDS, "$", "P002", errors)

    if plan.get("schemaVersion") != PLAN_SCHEMA_VERSION:
        add_error(
            errors,
            "P003",
            "$.schemaVersion",
            f"schemaVersion must be {PLAN_SCHEMA_VERSION!r}",
        )

    target = plan.get("target")
    if not isinstance(target, dict):
        add_error(errors, "P004", "$.target", "target is required and must be an object")
    else:
        reject_unknown_fields(target, PLAN_TARGET_FIELDS, "$.target", "P005", errors)
        target_url = target.get("url")
        if not is_absolute_http_url(target_url):
            add_error(errors, "P006", "$.target.url", "target.url must be an absolute HTTP(S) URL")
        elif target_url != bound["targetUrl"]:
            add_error(errors, "P007", "$.target.url", "target.url must exactly match reconciliation/report target")

    source = plan.get("source")
    if not isinstance(source, dict):
        add_error(errors, "P008", "$.source", "source is required and must be an object")
    else:
        reject_unknown_fields(source, PLAN_SOURCE_FIELDS, "$.source", "P009", errors)
        for field in sorted(PLAN_SOURCE_FIELDS):
            value = source.get(field)
            if not is_portable_relative_path(value):
                add_error(errors, "P010", f"$.source.{field}", "source path must be a portable repository-relative path")
            elif expected_sources and value != expected_sources[field]:
                add_error(errors, "P011", f"$.source.{field}", "source path must exactly identify the validated input artifact")

    if not isinstance(plan.get("tests"), list):
        add_error(errors, "P012", "$.tests", "tests is required and must be an array")
        return False
    return True


def validate_exact_state(value, expected, path, code, errors):
    if not isinstance(value, dict):
        add_error(errors, code, path, "state is required and must be an object")
    elif value != expected:
        add_error(errors, code, path, f"state must exactly equal {expected!r}")


def validate_tab_state(test_case, index, eligible, report_candidate, errors):
    path = f"$.tests[{index}]"
    aria = report_candidate.get("ariaAttributes") if isinstance(report_candidate, dict) else None
    if not isinstance(aria, dict) or aria.get("selected") != "false":
        add_error(errors, "P206", f"{path}.initialState.interactionTarget.selected", "current report must contain ariaAttributes.selected == 'false'")

    validate_exact_state(test_case.get("initialState"), TAB_INITIAL_STATE, f"{path}.initialState", "P301", errors)
    validate_exact_state(test_case.get("expectedState"), TAB_EXPECTED_STATE, f"{path}.expectedState", "P302", errors)
    validate_exact_state(test_case.get("restoredState"), TAB_RESTORED_STATE, f"{path}.restoredState", "P307", errors)

    if "reset" in test_case:
        add_error(errors, "P308", f"{path}.reset", "reset is not allowed for tabSelection")
    restore = test_case.get("restore")
    if not isinstance(restore, dict):
        add_error(errors, "P303", f"{path}.restore", "restore is required and must be an object")
        return
    reject_unknown_fields(restore, PLAN_RESTORE_FIELDS, f"{path}.restore", "P304", errors)
    if restore.get("strategy") != "restorePreviousSelection":
        add_error(errors, "P306", f"{path}.restore.strategy", "restore.strategy must be 'restorePreviousSelection'")
    restore_target = restore.get("target")
    if not isinstance(restore_target, dict):
        add_error(errors, "P309", f"{path}.restore.target", "restore target is required and must be an object")
        return
    reject_unknown_fields(restore_target, PLAN_RESTORE_TARGET_FIELDS, f"{path}.restore.target", "P310", errors)
    restore_candidate_key = restore_target.get("candidateKey")
    if not isinstance(restore_candidate_key, str) or CANDIDATE_KEY_PATTERN.fullmatch(restore_candidate_key) is None:
        add_error(errors, "P313", f"{path}.restore.target.candidateKey", "valid restore candidateKey is required")
    if not is_non_empty_string(restore_target.get("selector")):
        add_error(errors, "P311", f"{path}.restore.target.selector", "restore selector is required and must be non-empty")
    if restore_target.get("selector") == test_case.get("target", {}).get("selector"):
        add_error(errors, "P312", f"{path}.restore.target.selector", "restore selector must differ from interaction selector")

    upstream_restore = eligible.get("tabRestore") if isinstance(eligible, dict) else None
    upstream_target = upstream_restore.get("target") if isinstance(upstream_restore, dict) else None
    exact_pairs = (
        (test_case.get("target", {}).get("tabGroupSelector"), upstream_restore.get("tabGroupSelector") if isinstance(upstream_restore, dict) else None, f"{path}.target.tabGroupSelector", "P209"),
        (restore_target.get("candidateKey"), upstream_target.get("candidateKey") if isinstance(upstream_target, dict) else None, f"{path}.restore.target.candidateKey", "P210"),
        (restore_target.get("selector"), upstream_target.get("selector") if isinstance(upstream_target, dict) else None, f"{path}.restore.target.selector", "P211"),
    )
    for actual, expected, field_path, code in exact_pairs:
        if actual != expected:
            add_error(errors, code, field_path, "field must exactly match eligible/report restore evidence")


def validate_expanded_state(test_case, index, report_candidate, errors):
    path = f"$.tests[{index}]"
    aria = report_candidate.get("ariaAttributes") if isinstance(report_candidate, dict) else None
    if not isinstance(aria, dict) or aria.get("expanded") != "false":
        add_error(errors, "P206", f"{path}.initialState.expanded", "current report must contain ariaAttributes.expanded == 'false'")
    validate_exact_state(test_case.get("initialState"), EXPANDED_INITIAL_STATE, f"{path}.initialState", "P301", errors)
    validate_exact_state(test_case.get("expectedState"), EXPANDED_EXPECTED_STATE, f"{path}.expectedState", "P302", errors)
    if "restore" in test_case or "restoredState" in test_case:
        add_error(errors, "P308", path, "tab restore fields are not allowed for expandedToggle")

    reset = test_case.get("reset")
    if not isinstance(reset, dict):
        add_error(errors, "P303", f"{path}.reset", "reset is required and must be an object")
        return
    reject_unknown_fields(reset, PLAN_RESET_FIELDS, f"{path}.reset", "P304", errors)
    if reset.get("required") is not True:
        add_error(errors, "P305", f"{path}.reset.required", "reset.required must be true")
    if reset.get("strategy") != "toggleSameTarget":
        add_error(errors, "P306", f"{path}.reset.strategy", "reset.strategy must be 'toggleSameTarget'")
    validate_exact_state(reset.get("restoredState"), EXPANDED_INITIAL_STATE, f"{path}.reset.restoredState", "P307", errors)


def validate_test_case(test_case, index, bound, seen_ids, seen_keys, errors):
    path = f"$.tests[{index}]"
    if not isinstance(test_case, dict):
        add_error(errors, "P101", path, "test case must be an object")
        return
    reject_unknown_fields(test_case, PLAN_TEST_FIELDS, path, "P102", errors)

    test_id = test_case.get("id")
    if not isinstance(test_id, str) or TEST_ID_PATTERN.fullmatch(test_id) is None:
        add_error(errors, "P103", f"{path}.id", "id does not match the deterministic interaction test id format")
    elif test_id in seen_ids:
        add_error(errors, "P104", f"{path}.id", f"duplicate id: {test_id}")
    else:
        seen_ids.add(test_id)

    if not is_non_empty_string(test_case.get("title")):
        add_error(errors, "P106", f"{path}.title", "title is required and must be a non-empty string")

    candidate_key = test_case.get("candidateKey")
    if not isinstance(candidate_key, str) or CANDIDATE_KEY_PATTERN.fullmatch(candidate_key) is None:
        add_error(errors, "P107", f"{path}.candidateKey", "invalid interaction candidateKey")
    elif candidate_key in seen_keys:
        add_error(errors, "P108", f"{path}.candidateKey", f"duplicate candidateKey: {candidate_key}")
    else:
        seen_keys.add(candidate_key)

    template = test_case.get("template")
    if template not in SUPPORTED_TEMPLATES:
        add_error(errors, "P109", f"{path}.template", f"unsupported template: {template!r}")
    if not isinstance(test_case.get("pageContext"), str):
        add_error(errors, "P110", f"{path}.pageContext", "pageContext is required and must be a string")

    start_url = test_case.get("startUrl")
    if not is_absolute_http_url(start_url):
        add_error(errors, "P115", f"{path}.startUrl", "startUrl must be an absolute HTTP(S) URL without credentials")
    elif not is_same_origin(bound["targetUrl"], start_url):
        add_error(errors, "P116", f"{path}.startUrl", "startUrl must be same-origin with target.url")

    target = test_case.get("target")
    if not isinstance(target, dict):
        add_error(errors, "P111", f"{path}.target", "target is required and must be an object")
        target = {}
    else:
        reject_unknown_fields(target, PLAN_TEST_TARGET_FIELDS, f"{path}.target", "P112", errors)
    if not is_non_empty_string(target.get("selector")):
        add_error(errors, "P113", f"{path}.target.selector", "selector is required and must be non-empty")
    if not is_non_empty_string(target.get("interactionKind")):
        add_error(errors, "P114", f"{path}.target.interactionKind", "interactionKind is required")

    eligible = bound["eligibleByKey"].get(candidate_key)
    report_candidate = bound["reportByKey"].get(candidate_key)
    if eligible is None:
        add_error(errors, "P201", f"{path}.candidateKey", "candidateKey is not present in reconciliation eligibleCandidates")
    else:
        exact_fields = (
            (target.get("selector"), eligible.get("selector"), f"{path}.target.selector", "P202"),
            (target.get("interactionKind"), eligible.get("interactionKind"), f"{path}.target.interactionKind", "P203"),
            (test_case.get("pageContext"), eligible.get("pageContext"), f"{path}.pageContext", "P204"),
            (test_case.get("startUrl"), eligible.get("observedUrl"), f"{path}.startUrl", "P207"),
        )
        for actual, expected, field_path, code in exact_fields:
            if actual != expected:
                add_error(errors, code, field_path, "field must exactly match eligible/report evidence")
        if isinstance(report_candidate, dict) and test_case.get("startUrl") != report_candidate.get("observedUrl"):
            add_error(errors, "P208", f"{path}.startUrl", "startUrl must exactly match current report observedUrl")

    if template in SUPPORTED_TEMPLATES:
        interaction_kind = target.get("interactionKind")
        if interaction_kind not in INTERACTION_KINDS_BY_TEMPLATE[template]:
            add_error(errors, "P205", f"{path}.template", "template is incompatible with interactionKind")
        if isinstance(candidate_key, str) and CANDIDATE_KEY_PATTERN.fullmatch(candidate_key):
            expected_id = stable_test_id(candidate_key, template)
            if test_id != expected_id:
                add_error(errors, "P105", f"{path}.id", f"id must exactly equal {expected_id!r}")
        if template == "interaction.tabSelection":
            if not is_non_empty_string(target.get("tabGroupSelector")):
                add_error(errors, "P117", f"{path}.target.tabGroupSelector", "tabGroupSelector is required for tabSelection")
            validate_tab_state(test_case, index, eligible, report_candidate, errors)
        else:
            if "tabGroupSelector" in target:
                add_error(errors, "P118", f"{path}.target.tabGroupSelector", "tabGroupSelector is not allowed for expandedToggle")
            validate_expanded_state(test_case, index, report_candidate, errors)


def validate_plan(plan, bound, expected_sources=None):
    errors = []
    if not validate_top_level(plan, bound, expected_sources, errors):
        return errors

    tests = plan["tests"]
    seen_ids = set()
    seen_keys = set()
    for index, test_case in enumerate(tests):
        validate_test_case(test_case, index, bound, seen_ids, seen_keys, errors)

    ordered_keys = [
        item.get("candidateKey", "") if isinstance(item, dict) else ""
        for item in tests
    ]
    if ordered_keys != sorted(ordered_keys):
        add_error(errors, "P120", "$.tests", "tests must be ordered by candidateKey")
    return errors


def set_fixture_path(value, path, replacement):
    current = value
    for part in path[:-1]:
        current = current[part]
    current[path[-1]] = replacement


def apply_fixture_mutation(plan, mutation):
    mutated = copy.deepcopy(plan)
    operation = mutation.get("operation")
    if operation == "set":
        set_fixture_path(mutated, mutation["path"], mutation.get("value"))
    elif operation == "add":
        set_fixture_path(mutated, mutation["path"], mutation.get("value"))
    elif operation == "remove":
        current = mutated
        for part in mutation["path"][:-1]:
            current = current[part]
        del current[mutation["path"][-1]]
    elif operation == "appendTest":
        mutated["tests"].append(copy.deepcopy(mutated["tests"][mutation["sourceIndex"]]))
    elif operation == "swapTests":
        first = mutation["firstIndex"]
        second = mutation["secondIndex"]
        mutated["tests"][first], mutated["tests"][second] = (
            mutated["tests"][second],
            mutated["tests"][first],
        )
    else:
        raise ValueError(f"unsupported fixture mutation operation: {operation!r}")
    return mutated


def validate_fixture(fixture):
    if not isinstance(fixture, dict):
        raise ValueError("interaction plan validator fixture top-level value must be an object")
    reconciliation = fixture.get("reconciliation")
    report = fixture.get("analysisReviewReport")
    builder_fixture_path = fixture.get("builderFixture")
    if builder_fixture_path:
        builder_fixture = load_json(resolve_path(builder_fixture_path), "interaction plan builder fixture")
        success = builder_fixture.get("success") if isinstance(builder_fixture, dict) else None
        if not isinstance(success, dict):
            raise ValueError("referenced builder fixture requires success object")
        reconciliation = success.get("reconciliation")
        report = success.get("analysisReviewReport")
    valid_plan = fixture.get("validPlan")
    empty_plan = fixture.get("emptyPlan")
    failure_cases = fixture.get("failureCases")
    if not isinstance(failure_cases, list):
        raise ValueError("validator fixture requires failureCases array")

    bound = bind_plan_inputs(reconciliation, report)
    if bound["errors"]:
        raise ValueError(f"validator fixture input errors: {bound['errors']!r}")
    expected_sources = {
        "reconciliationPath": "tools/ai-generator/fixtures/interaction_plan_validator.fixture.json",
        "analysisReportPath": "tools/ai-generator/fixtures/interaction_plan_validator.fixture.json",
    }
    failures = []
    for scenario, plan in (("validPlan", valid_plan), ("emptyPlan", empty_plan)):
        errors = validate_plan(plan, bound, expected_sources)
        if errors:
            failures.append(f"{scenario}: expected no errors, got {errors!r}")

    for index, case in enumerate(failure_cases):
        if not isinstance(case, dict):
            failures.append(f"failureCases[{index}] must be an object")
            continue
        try:
            plan = apply_fixture_mutation(valid_plan, case.get("mutation", {}))
        except (KeyError, IndexError, TypeError, ValueError) as error:
            failures.append(f"{case.get('scenario')}: invalid fixture mutation: {error}")
            continue
        actual_codes = [code for code, _, _ in validate_plan(plan, bound, expected_sources)]
        if actual_codes != case.get("expectedCodes"):
            failures.append(
                f"{case.get('scenario')}: expected codes {case.get('expectedCodes')!r}, got {actual_codes!r}"
            )
    return failures, len(valid_plan.get("tests", [])), len(failure_cases)


def print_input_errors(errors):
    print("Interaction plan input validation failed:")
    for code, path, message in errors:
        print(f"[{code}] {path}: {message}")


def print_report(plan_path, reconciliation_path, report_path, plan, bound, errors):
    print("Structured Interaction Plan Validation")
    print(f"- plan: {display_path(plan_path)}")
    print(f"- reconciliation: {display_path(reconciliation_path)}")
    print(f"- analysis report: {display_path(report_path)}")
    print()
    print("Errors:")
    if errors:
        for code, path, message in errors:
            print(f"[{code}] {path}: {message}")
    else:
        print("- none")
    tests = plan.get("tests", []) if isinstance(plan, dict) else []
    counts = {template: 0 for template in sorted(SUPPORTED_TEMPLATES)}
    for item in tests if isinstance(tests, list) else []:
        if isinstance(item, dict) and item.get("template") in counts:
            counts[item["template"]] += 1
    print()
    print("Summary:")
    print(f"- errors: {len(errors)}")
    print(f"- tests: {len(tests) if isinstance(tests, list) else 0}")
    print(f"- eligible references: {len(bound['eligibleByKey'])}")
    for template in sorted(counts):
        print(f"- {template}: {counts[template]}")
    if not errors:
        print()
        print("validation passed")


def main():
    args = parse_args()
    if args.fixture:
        fixture_path = resolve_path(args.fixture)
        try:
            fixture = load_json(fixture_path, "interaction plan validator fixture")
            failures, test_count, failure_count = validate_fixture(fixture)
        except (FileNotFoundError, OSError, ValueError) as error:
            print(f"Interaction plan validator fixture failed: {error}", file=sys.stderr)
            return 1
        if failures:
            for failure in failures:
                print(f"[P900] {failure}", file=sys.stderr)
            return 1
        print("Structured Interaction Plan Validator Fixture")
        print(f"- fixture: {display_path(fixture_path)}")
        print(f"- valid tests: {test_count}")
        print("- empty plan: valid")
        print(f"- failure scenarios: {failure_count}")
        print("fixture validation passed")
        return 0

    plan_path = resolve_path(args.input)
    reconciliation_path = resolve_path(args.reconciliation)
    report_path = resolve_path(args.report)
    try:
        plan = load_json(plan_path, "structured interaction plan")
        reconciliation = load_json(reconciliation_path, "interaction approval reconciliation")
        report = load_json(report_path, "analysis review report")
        expected_sources = {
            "reconciliationPath": portable_source_path(reconciliation_path),
            "analysisReportPath": portable_source_path(report_path),
        }
    except (FileNotFoundError, OSError, ValueError) as error:
        print(f"Structured interaction plan validation failed: {error}", file=sys.stderr)
        return 1

    bound = bind_plan_inputs(reconciliation, report)
    if bound["errors"]:
        print_input_errors(bound["errors"])
        return 1
    errors = validate_plan(plan, bound, expected_sources)
    print_report(plan_path, reconciliation_path, report_path, plan, bound, errors)
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
