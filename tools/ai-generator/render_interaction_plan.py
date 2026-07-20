import argparse
import copy
import json
import re
import sys
import tempfile
from pathlib import Path

from interaction_plan_contract import (
    CANDIDATE_KEY_PATTERN,
    DEFAULT_INTERACTION_PLAN_PATH,
    EXPANDED_EXPECTED_STATE,
    EXPANDED_INITIAL_STATE,
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
    TEST_ID_PATTERN,
    TAB_EXPECTED_STATE,
    TAB_INITIAL_STATE,
    TAB_RESTORED_STATE,
    display_path,
    is_non_empty_string,
    load_json,
    resolve_path,
)


ROOT_DIR = Path(__file__).resolve().parents[2]
DEFAULT_OUTPUT_PATH = ROOT_DIR / "tests" / "generated" / "generated_interaction_plan.spec.js"

TEMPLATE_CONTRACTS = {
    "interaction.tabSelection": {
        "interactionKinds": {"tab"},
        "initialState": TAB_INITIAL_STATE,
        "expectedState": TAB_EXPECTED_STATE,
        "restoredState": TAB_RESTORED_STATE,
    },
    "interaction.expandedToggle": {
        "interactionKinds": {"accordion", "expandCollapse"},
        "initialState": EXPANDED_INITIAL_STATE,
        "expectedState": EXPANDED_EXPECTED_STATE,
        "resetStrategy": "toggleSameTarget",
        "restoredState": EXPANDED_INITIAL_STATE,
    },
}


def parse_args():
    parser = argparse.ArgumentParser(
        description="Render a deterministic Playwright spec from a validated Structured Interaction Plan."
    )
    parser.add_argument(
        "--input",
        default=str(DEFAULT_INTERACTION_PLAN_PATH),
        help="Path to interaction_plan.generated.json.",
    )
    parser.add_argument(
        "--output",
        default=str(DEFAULT_OUTPUT_PATH),
        help="Path to the generated Playwright interaction spec.",
    )
    parser.add_argument(
        "--fixture",
        help="Optional renderer fixture with a valid plan and direct-input failure scenarios.",
    )
    return parser.parse_args()


def js_string(value):
    return json.dumps(value, ensure_ascii=False)


def add_error(errors, code, path, message):
    errors.append((code, path, message))


def reject_unknown_fields(value, allowed, path, code, errors):
    if isinstance(value, dict):
        for field in sorted(set(value) - allowed):
            add_error(errors, code, f"{path}.{field}", "unknown field")


def validate_exact_object(value, expected, path, code, errors):
    if value != expected:
        add_error(errors, code, path, f"value must exactly equal {expected!r}")


def validate_test_case(test_case, index, seen_ids, seen_keys, errors):
    path = f"$.tests[{index}]"
    if not isinstance(test_case, dict):
        add_error(errors, "R101", path, "test case must be an object")
        return
    reject_unknown_fields(test_case, PLAN_TEST_FIELDS, path, "R102", errors)

    test_id = test_case.get("id")
    if not isinstance(test_id, str) or TEST_ID_PATTERN.fullmatch(test_id) is None:
        add_error(errors, "R103", f"{path}.id", "valid deterministic test id is required")
    elif test_id in seen_ids:
        add_error(errors, "R104", f"{path}.id", f"duplicate id: {test_id}")
    else:
        seen_ids.add(test_id)

    if not is_non_empty_string(test_case.get("title")):
        add_error(errors, "R106", f"{path}.title", "non-empty title is required")

    candidate_key = test_case.get("candidateKey")
    if not isinstance(candidate_key, str) or CANDIDATE_KEY_PATTERN.fullmatch(candidate_key) is None:
        add_error(errors, "R107", f"{path}.candidateKey", "valid interaction candidateKey is required")
    elif candidate_key in seen_keys:
        add_error(errors, "R108", f"{path}.candidateKey", f"duplicate candidateKey: {candidate_key}")
    else:
        seen_keys.add(candidate_key)

    template = test_case.get("template")
    if template not in SUPPORTED_TEMPLATES or template not in TEMPLATE_CONTRACTS:
        add_error(errors, "R109", f"{path}.template", f"unsupported template: {template!r}")
        return

    if not is_non_empty_string(test_case.get("startUrl")):
        add_error(errors, "R115", f"{path}.startUrl", "non-empty startUrl is required")

    target = test_case.get("target")
    if not isinstance(target, dict):
        add_error(errors, "R111", f"{path}.target", "target object is required")
        target = {}
    else:
        reject_unknown_fields(target, PLAN_TEST_TARGET_FIELDS, f"{path}.target", "R112", errors)
    if not is_non_empty_string(target.get("selector")):
        add_error(errors, "R113", f"{path}.target.selector", "non-empty selector is required")

    contract = TEMPLATE_CONTRACTS[template]
    if target.get("interactionKind") not in contract["interactionKinds"]:
        add_error(errors, "R114", f"{path}.target.interactionKind", "interactionKind is incompatible with template")

    validate_exact_object(
        test_case.get("initialState"), contract["initialState"], f"{path}.initialState", "R301", errors
    )
    validate_exact_object(
        test_case.get("expectedState"), contract["expectedState"], f"{path}.expectedState", "R302", errors
    )

    if template == "interaction.tabSelection":
        if not is_non_empty_string(target.get("tabGroupSelector")):
            add_error(errors, "R116", f"{path}.target.tabGroupSelector", "non-empty tabGroupSelector is required")
        if "reset" in test_case:
            add_error(errors, "R308", f"{path}.reset", "reset is not allowed for tabSelection")
        restore = test_case.get("restore")
        restore_target = restore.get("target") if isinstance(restore, dict) else None
        if isinstance(restore, dict):
            reject_unknown_fields(restore, PLAN_RESTORE_FIELDS, f"{path}.restore", "R304", errors)
        if isinstance(restore_target, dict):
            reject_unknown_fields(restore_target, PLAN_RESTORE_TARGET_FIELDS, f"{path}.restore.target", "R310", errors)
        if not isinstance(restore, dict) or restore.get("strategy") != "restorePreviousSelection":
            add_error(errors, "R306", f"{path}.restore", "restorePreviousSelection restore is required")
        if not isinstance(restore_target, dict) or not is_non_empty_string(restore_target.get("selector")):
            add_error(errors, "R311", f"{path}.restore.target.selector", "non-empty restore selector is required")
        elif restore_target.get("selector") == target.get("selector"):
            add_error(errors, "R312", f"{path}.restore.target.selector", "restore selector must differ from interaction selector")
        if not isinstance(restore_target, dict) or CANDIDATE_KEY_PATTERN.fullmatch(restore_target.get("candidateKey", "")) is None:
            add_error(errors, "R313", f"{path}.restore.target.candidateKey", "valid restore candidateKey is required")
        validate_exact_object(test_case.get("restoredState"), contract["restoredState"], f"{path}.restoredState", "R307", errors)
    else:
        if "restore" in test_case or "restoredState" in test_case:
            add_error(errors, "R308", path, "tab restore fields are not allowed for expandedToggle")
        reset = test_case.get("reset")
        if not isinstance(reset, dict):
            add_error(errors, "R303", f"{path}.reset", "reset object is required")
            return
        reject_unknown_fields(reset, PLAN_RESET_FIELDS, f"{path}.reset", "R304", errors)
        if reset.get("required") is not True:
            add_error(errors, "R305", f"{path}.reset.required", "reset.required must be true")
        if reset.get("strategy") != contract["resetStrategy"]:
            add_error(errors, "R306", f"{path}.reset.strategy", f"reset.strategy must be {contract['resetStrategy']!r}")
        validate_exact_object(reset.get("restoredState"), contract["restoredState"], f"{path}.reset.restoredState", "R307", errors)


def validate_renderer_input(plan):
    errors = []
    if not isinstance(plan, dict):
        add_error(errors, "R001", "$", "top-level value must be an object")
        return errors
    reject_unknown_fields(plan, PLAN_TOP_LEVEL_FIELDS, "$", "R002", errors)
    if plan.get("schemaVersion") != PLAN_SCHEMA_VERSION:
        add_error(
            errors,
            "R003",
            "$.schemaVersion",
            f"schemaVersion must be {PLAN_SCHEMA_VERSION!r}",
        )
    target = plan.get("target")
    if not isinstance(target, dict) or not is_non_empty_string(target.get("url")):
        add_error(errors, "R004", "$.target.url", "target.url is required")
    elif isinstance(target, dict):
        reject_unknown_fields(target, PLAN_TARGET_FIELDS, "$.target", "R005", errors)
    source = plan.get("source")
    if not isinstance(source, dict):
        add_error(errors, "R008", "$.source", "source object is required")
    else:
        reject_unknown_fields(source, PLAN_SOURCE_FIELDS, "$.source", "R009", errors)
    tests = plan.get("tests")
    if not isinstance(tests, list):
        add_error(errors, "R012", "$.tests", "tests is required and must be an array")
        return errors

    seen_ids = set()
    seen_keys = set()
    for index, test_case in enumerate(tests):
        validate_test_case(test_case, index, seen_ids, seen_keys, errors)

    ordered_keys = [
        item.get("candidateKey", "") if isinstance(item, dict) else ""
        for item in tests
    ]
    if ordered_keys != sorted(ordered_keys):
        add_error(errors, "R120", "$.tests", "tests must be ordered by candidateKey")
    return errors


def state_attribute_value(state, state_name):
    return "true" if state[state_name] is True else "false"


def render_tab_selection(test_case):
    interaction_selector = js_string(test_case["target"]["selector"])
    restore_selector = js_string(test_case["restore"]["target"]["selector"])
    return [
        f"const interactionTarget = page.locator({interaction_selector});",
        f"const restoreTarget = page.locator({restore_selector});",
        "await expect(interactionTarget).toHaveAttribute('aria-selected', 'false');",
        "await expect(restoreTarget).toHaveAttribute('aria-selected', 'true');",
        "",
        "await interactionTarget.click();",
        "await expect(interactionTarget).toHaveAttribute('aria-selected', 'true');",
        "await expect(restoreTarget).toHaveAttribute('aria-selected', 'false');",
        "",
        "await restoreTarget.click();",
        "await expect(restoreTarget).toHaveAttribute('aria-selected', 'true');",
        "await expect(interactionTarget).toHaveAttribute('aria-selected', 'false');",
    ]


def render_expanded_toggle(test_case):
    selector = js_string(test_case["target"]["selector"])
    initial = js_string(state_attribute_value(test_case["initialState"], "expanded"))
    expected = js_string(state_attribute_value(test_case["expectedState"], "expanded"))
    restored = js_string(state_attribute_value(test_case["reset"]["restoredState"], "expanded"))
    return [
        f"const target = page.locator({selector});",
        f"await expect(target).toHaveAttribute('aria-expanded', {initial});",
        "",
        "await target.click();",
        f"await expect(target).toHaveAttribute('aria-expanded', {expected});",
        "",
        "await target.click();",
        f"await expect(target).toHaveAttribute('aria-expanded', {restored});",
    ]


def render_test_case(test_case):
    title = f"{test_case['title']} [{test_case['id']}]"
    lines = [
        f"  test({js_string(title)}, async ({{ page }}) => {{",
        f"    // candidateKey: {test_case['candidateKey']}",
        f"    await page.goto({js_string(test_case['startUrl'])});",
        "",
    ]
    if test_case["template"] == "interaction.tabSelection":
        body = render_tab_selection(test_case)
    elif test_case["template"] == "interaction.expandedToggle":
        body = render_expanded_toggle(test_case)
    else:
        raise ValueError(f"unsupported template after validation: {test_case['template']!r}")
    lines.extend(f"    {line}" if line else "" for line in body)
    lines.append("  });")
    return "\n".join(lines)


def render_spec(plan):
    errors = validate_renderer_input(plan)
    if errors:
        return None, errors
    rendered_tests = "\n\n".join(render_test_case(test_case) for test_case in plan["tests"])
    if rendered_tests:
        rendered_tests = f"\n{rendered_tests}\n"
    source = (
        "// Generated from a validated Structured Interaction Plan.\n"
        "// Do not edit directly.\n"
        "const { test, expect } = require('@playwright/test');\n\n"
        "test.describe('Structured interaction plan rendering', () => {"
        f"{rendered_tests}"
        "});\n"
    )
    return source, []


def write_source_atomic(output_path, source):
    output_path.parent.mkdir(parents=True, exist_ok=True)
    temporary_path = output_path.with_name(f"{output_path.name}.tmp")
    try:
        temporary_path.write_text(source, encoding="utf-8", newline="\n")
        temporary_path.replace(output_path)
    finally:
        if temporary_path.exists():
            temporary_path.unlink()


def render_plan_to_path(plan, output_path):
    source, errors = render_spec(plan)
    if errors:
        return None, errors
    write_source_atomic(output_path, source)
    return source, []


def set_fixture_path(value, path, replacement):
    current = value
    for part in path[:-1]:
        current = current[part]
    current[path[-1]] = replacement


def apply_fixture_mutation(plan, mutation):
    mutated = copy.deepcopy(plan)
    operation = mutation.get("operation")
    path = mutation.get("path")
    if operation == "set":
        set_fixture_path(mutated, path, mutation.get("value"))
    elif operation == "remove":
        current = mutated
        for part in path[:-1]:
            current = current[part]
        del current[path[-1]]
    else:
        raise ValueError(f"unsupported fixture mutation operation: {operation!r}")
    return mutated


def validate_fixture(fixture):
    if not isinstance(fixture, dict):
        raise ValueError("renderer fixture top-level value must be an object")
    valid_plan = fixture.get("validPlan")
    validator_fixture_path = fixture.get("validatorFixture")
    if validator_fixture_path:
        validator_fixture = load_json(resolve_path(validator_fixture_path), "interaction plan validator fixture")
        valid_plan = validator_fixture.get("validPlan") if isinstance(validator_fixture, dict) else None
    failure_cases = fixture.get("failureCases")
    if not isinstance(failure_cases, list):
        raise ValueError("renderer fixture requires failureCases array")

    source, errors = render_spec(valid_plan)
    failures = []
    if errors:
        failures.append(f"validPlan: expected no errors, got {errors!r}")
        return failures, None, 0, len(failure_cases)
    repeated_source, repeated_errors = render_spec(valid_plan)
    if repeated_errors or repeated_source != source:
        failures.append("validPlan: repeated rendering was not byte-identical")
    if source.encode("utf-8").decode("utf-8") != source:
        failures.append("validPlan: generated source did not round-trip as UTF-8")
    if not source.endswith("\n") or "\r" in source:
        failures.append("validPlan: output must use LF and end with a trailing newline")
    if str(ROOT_DIR) in source or re.search(r"(?:^|[\"'\s])[A-Za-z]:[\\/]", source):
        failures.append("validPlan: generated source contains a local absolute path")

    tests = valid_plan.get("tests", []) if isinstance(valid_plan, dict) else []
    for index, test_case in enumerate(tests):
        for label, literal in (
            ("startUrl", js_string(test_case["startUrl"])),
            ("selector", js_string(test_case["target"]["selector"])),
        ):
            if literal not in source:
                failures.append(f"validPlan.tests[{index}]: exact {label} literal is missing")
        if test_case.get("template") == "interaction.tabSelection":
            restore_literal = js_string(test_case["restore"]["target"]["selector"])
            if restore_literal not in source:
                failures.append(f"validPlan.tests[{index}]: exact restore selector literal is missing")
    for fragment in fixture.get("expectedFragments", []):
        if fragment not in source:
            failures.append(f"validPlan: expected source fragment is missing: {fragment!r}")
    for fragment, expected_count in fixture.get("expectedCounts", {}).items():
        actual_count = source.count(fragment)
        if actual_count != expected_count:
            failures.append(
                f"validPlan: expected {fragment!r} count {expected_count}, got {actual_count}"
            )

    for index, case in enumerate(failure_cases):
        scenario = case.get("scenario", f"failureCases[{index}]") if isinstance(case, dict) else f"failureCases[{index}]"
        try:
            mutated = apply_fixture_mutation(valid_plan, case.get("mutation", {}))
            _, actual_errors = render_spec(mutated)
        except (KeyError, IndexError, TypeError, ValueError) as error:
            failures.append(f"{scenario}: invalid fixture mutation: {error}")
            continue
        actual_codes = [code for code, _, _ in actual_errors]
        if actual_codes != case.get("expectedCodes"):
            failures.append(
                f"{scenario}: expected codes {case.get('expectedCodes')!r}, got {actual_codes!r}"
            )
    if failure_cases:
        try:
            invalid_plan = apply_fixture_mutation(valid_plan, failure_cases[0].get("mutation", {}))
            with tempfile.TemporaryDirectory() as temporary_directory:
                preserved_path = Path(temporary_directory) / "preserved.spec.js"
                preserved_path.write_text("preserved\n", encoding="utf-8")
                _, preserved_errors = render_plan_to_path(invalid_plan, preserved_path)
                if not preserved_errors or preserved_path.read_text(encoding="utf-8") != "preserved\n":
                    failures.append("invalid plan must preserve an existing output file")
        except (KeyError, IndexError, OSError, TypeError, ValueError) as error:
            failures.append(f"output preservation check failed: {error}")
    return failures, source, len(tests), len(failure_cases)


def print_errors(errors):
    print("Interaction plan rendering failed:", file=sys.stderr)
    for code, path, message in errors:
        print(f"[{code}] {path}: {message}", file=sys.stderr)


def main():
    args = parse_args()
    output_path = resolve_path(args.output)
    if args.fixture:
        fixture_path = resolve_path(args.fixture)
        try:
            fixture = load_json(fixture_path, "interaction renderer fixture")
            failures, source, test_count, failure_count = validate_fixture(fixture)
        except (FileNotFoundError, OSError, ValueError) as error:
            print(f"Interaction renderer fixture failed: {error}", file=sys.stderr)
            return 1
        if failures:
            for failure in failures:
                print(f"[R900] {failure}", file=sys.stderr)
            return 1
        try:
            write_source_atomic(output_path, source)
        except OSError as error:
            print(f"Interaction renderer fixture output failed: {error}", file=sys.stderr)
            return 1
        print("Structured Interaction Plan Renderer Fixture")
        print(f"- fixture: {display_path(fixture_path)}")
        print(f"- output: {display_path(output_path)}")
        print(f"- valid tests: {test_count}")
        print(f"- failure scenarios: {failure_count}")
        print("fixture rendering passed")
        return 0

    input_path = resolve_path(args.input)
    try:
        plan = load_json(input_path, "structured interaction plan")
    except (FileNotFoundError, OSError, ValueError) as error:
        print(f"Interaction plan rendering failed: {error}", file=sys.stderr)
        return 1
    try:
        source, errors = render_plan_to_path(plan, output_path)
    except OSError as error:
        print(f"Interaction plan output failed: {error}", file=sys.stderr)
        return 1
    if errors:
        print_errors(errors)
        return 1
    print("Structured Interaction Plan Renderer")
    print(f"- input: {display_path(input_path)}")
    print(f"- output: {display_path(output_path)}")
    print(f"- tests: {len(plan['tests'])}")
    print("rendering passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
