import argparse
import json
import sys
from pathlib import Path


ROOT_DIR = Path(__file__).resolve().parents[2]
DEFAULT_TEST_PLAN_PATH = ROOT_DIR / "tools" / "ai-generator" / "generated" / "test_plan.example.json"

SUPPORTED_VERSION = "1.0"
SUPPORTED_TEMPLATES = {
    "navigation.urlOnly",
    "navigation.headingIdentity",
    "navigation.contentIdentity",
    "navigation.tabIdentity",
    "navigation.todoIdentity",
}
SUPPORTED_CLICK_TYPES = {"depth2", "depth3"}
SUPPORTED_NAVIGATION_CHANGES = {"expected", "none", "unknown"}


def parse_args():
    parser = argparse.ArgumentParser(
        description="Validate structured test plan JSON."
    )
    parser.add_argument(
        "--input",
        default=str(DEFAULT_TEST_PLAN_PATH),
        help="Path to structured test plan JSON."
    )
    parser.add_argument(
        "--menu-map",
        help="Optional path to menu_map.json. When provided, validate tests[].menuPath coverage against primaryMenuTree."
    )

    return parser.parse_args()


def rel(path):
    return path.relative_to(ROOT_DIR).as_posix()


def load_json(path):
    if not path.exists():
        raise FileNotFoundError(f"test plan file not found: {rel(path)}")

    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as error:
        raise ValueError(f"test plan JSON parse failed: {rel(path)} ({error})") from error


def load_menu_map(path):
    if not path.exists():
        raise FileNotFoundError(f"menu_map file not found: {rel(path)}")

    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as error:
        raise ValueError(f"menu_map JSON parse failed: {rel(path)} ({error})") from error


def is_non_empty_string(value):
    return isinstance(value, str) and bool(value.strip())


def is_number_or_null(value):
    return value is None or (isinstance(value, (int, float)) and not isinstance(value, bool))


def is_string_array(value):
    return isinstance(value, list) and all(is_non_empty_string(item) for item in value)


def get_nested(value, *keys):
    current = value

    for key in keys:
        if not isinstance(current, dict):
            return None
        current = current.get(key)

    return current


def add_error(errors, code, message, path):
    errors.append((code, f"{path}: {message}"))


def add_warning(warnings, code, message, path):
    warnings.append((code, f"{path}: {message}"))


def validate_top_level(plan, errors):
    if not isinstance(plan, dict):
        add_error(errors, "E001", "top-level value must be an object", "$")
        return

    version = plan.get("version")
    if version is None:
        add_error(errors, "E002", "version is required", "$.version")
    elif version != SUPPORTED_VERSION:
        add_error(errors, "E003", f"version must be {SUPPORTED_VERSION!r}", "$.version")

    if not is_non_empty_string(plan.get("targetUrl")):
        add_error(errors, "E004", "targetUrl is required and must be a non-empty string", "$.targetUrl")

    source = plan.get("source")
    if not isinstance(source, dict):
        add_error(errors, "E005", "source is required and must be an object", "$.source")
    else:
        if not is_non_empty_string(source.get("menuMapPath")):
            add_error(errors, "E006", "source.menuMapPath is required", "$.source.menuMapPath")
        if not is_non_empty_string(source.get("scoutResultPath")):
            add_error(errors, "E007", "source.scoutResultPath is required", "$.source.scoutResultPath")

    if not isinstance(plan.get("tests"), list):
        add_error(errors, "E008", "tests is required and must be an array", "$.tests")


def validate_common_test_fields(test_case, index, seen_ids, errors):
    path = f"$.tests[{index}]"

    if not isinstance(test_case, dict):
        add_error(errors, "E101", "test case must be an object", path)
        return False

    test_id = test_case.get("id")
    if not is_non_empty_string(test_id):
        add_error(errors, "E102", "id is required and must be a non-empty string", f"{path}.id")
    elif test_id in seen_ids:
        add_error(errors, "E103", f"duplicate id: {test_id}", f"{path}.id")
    else:
        seen_ids.add(test_id)

    if not is_non_empty_string(test_case.get("title")):
        add_error(errors, "E104", "title is required and must be a non-empty string", f"{path}.title")

    template = test_case.get("template")
    if template not in SUPPORTED_TEMPLATES:
        add_error(errors, "E105", f"unsupported template: {template!r}", f"{path}.template")

    if not is_string_array(test_case.get("menuPath")):
        add_error(errors, "E106", "menuPath is required and must be an array of non-empty strings", f"{path}.menuPath")

    if not is_number_or_null(test_case.get("depth1Index")):
        add_error(errors, "E107", "depth1Index must be a number or null", f"{path}.depth1Index")

    if not isinstance(test_case.get("click"), dict):
        add_error(errors, "E108", "click is required and must be an object", f"{path}.click")

    if not isinstance(test_case.get("assertions"), dict):
        add_error(errors, "E109", "assertions is required and must be an object", f"{path}.assertions")

    return True


def validate_click(test_case, index, errors):
    click = test_case.get("click")
    path = f"$.tests[{index}].click"

    if not isinstance(click, dict):
        return

    click_type = click.get("type")
    if click_type not in SUPPORTED_CLICK_TYPES:
        add_error(errors, "E201", f"click.type must be one of {sorted(SUPPORTED_CLICK_TYPES)}", f"{path}.type")
        return

    if click_type == "depth2" and not is_non_empty_string(click.get("text")):
        add_error(errors, "E202", "depth2 click requires text", f"{path}.text")

    if click_type == "depth3":
        if not is_non_empty_string(click.get("parentText")):
            add_error(errors, "E203", "depth3 click requires parentText", f"{path}.parentText")
        if not is_non_empty_string(click.get("text")):
            add_error(errors, "E204", "depth3 click requires text", f"{path}.text")

    for optional_key in ("id", "ngClick", "cssPath"):
        if optional_key in click and not isinstance(click.get(optional_key), str):
            add_error(errors, "E205", f"{optional_key} must be a string when present", f"{path}.{optional_key}")


def require_url_href(test_case, index, errors):
    href = get_nested(test_case, "assertions", "url", "href")
    if not is_non_empty_string(href):
        add_error(errors, "E301", "assertions.url.href is required", f"$.tests[{index}].assertions.url.href")


def validate_identity_type(test_case, index, expected_type, errors):
    identity_type = get_nested(test_case, "assertions", "identity", "type")
    if identity_type != expected_type:
        add_error(
            errors,
            "E302",
            f"assertions.identity.type must be {expected_type!r}",
            f"$.tests[{index}].assertions.identity.type",
        )
        return False

    return True


def validate_heading_identity(test_case, index, errors):
    require_url_href(test_case, index, errors)
    validate_identity_type(test_case, index, "heading", errors)

    if not is_non_empty_string(get_nested(test_case, "assertions", "identity", "text")):
        add_error(errors, "E303", "heading identity requires text", f"$.tests[{index}].assertions.identity.text")

    exact = get_nested(test_case, "assertions", "identity", "exact")
    if not isinstance(exact, bool):
        add_error(errors, "E304", "heading identity requires exact boolean", f"$.tests[{index}].assertions.identity.exact")


def validate_content_identity(test_case, index, errors):
    require_url_href(test_case, index, errors)
    validate_identity_type(test_case, index, "content", errors)

    selector = get_nested(test_case, "assertions", "identity", "selector")
    if not is_non_empty_string(selector):
        add_error(errors, "E305", "content identity requires selector", f"$.tests[{index}].assertions.identity.selector")

    source_menu_path = get_nested(test_case, "assertions", "identity", "sourceMenuPath")
    if not is_string_array(source_menu_path):
        add_error(
            errors,
            "E306",
            "content identity requires sourceMenuPath array",
            f"$.tests[{index}].assertions.identity.sourceMenuPath",
        )
    elif source_menu_path != test_case.get("menuPath"):
        add_error(
            errors,
            "E307",
            "sourceMenuPath must exactly match test.menuPath",
            f"$.tests[{index}].assertions.identity.sourceMenuPath",
        )


def validate_tab_identity(test_case, index, errors, warnings):
    validate_identity_type(test_case, index, "tab", errors)

    navigation_change = test_case.get("navigationChange")
    if navigation_change not in SUPPORTED_NAVIGATION_CHANGES:
        add_error(
            errors,
            "E308",
            f"navigationChange must be one of {sorted(SUPPORTED_NAVIGATION_CHANGES)}",
            f"$.tests[{index}].navigationChange",
        )

    identity = get_nested(test_case, "assertions", "identity") or {}
    has_identity_target = any(is_non_empty_string(identity.get(key)) for key in ("selector", "id", "text"))
    if not has_identity_target:
        add_error(
            errors,
            "E309",
            "tab identity requires one of selector, id, or text",
            f"$.tests[{index}].assertions.identity",
        )

    if navigation_change == "expected" and not is_non_empty_string(get_nested(test_case, "assertions", "url", "href")):
        add_warning(
            warnings,
            "W301",
            "navigationChange is expected but assertions.url.href is missing",
            f"$.tests[{index}].assertions.url.href",
        )


def validate_todo_identity(test_case, index, errors):
    require_url_href(test_case, index, errors)

    if not is_non_empty_string(get_nested(test_case, "todo", "reason")):
        add_error(errors, "E310", "navigation.todoIdentity requires todo.reason", f"$.tests[{index}].todo.reason")


def validate_template_specific_fields(test_case, index, errors, warnings):
    template = test_case.get("template")

    if template == "navigation.urlOnly":
        require_url_href(test_case, index, errors)
    elif template == "navigation.headingIdentity":
        validate_heading_identity(test_case, index, errors)
    elif template == "navigation.contentIdentity":
        validate_content_identity(test_case, index, errors)
    elif template == "navigation.tabIdentity":
        validate_tab_identity(test_case, index, errors, warnings)
    elif template == "navigation.todoIdentity":
        validate_todo_identity(test_case, index, errors)


def validate_test_cases(plan, errors, warnings):
    tests = plan.get("tests")
    if not isinstance(tests, list):
        return

    seen_ids = set()
    for index, test_case in enumerate(tests):
        if not validate_common_test_fields(test_case, index, seen_ids, errors):
            continue

        validate_click(test_case, index, errors)
        validate_template_specific_fields(test_case, index, errors, warnings)


def menu_path_key(menu_path):
    if not is_string_array(menu_path):
        return None

    return tuple(menu_path)


def collect_expected_menu_paths(menu_map):
    expected = []

    if not isinstance(menu_map, dict):
        return expected

    menu_tree = menu_map.get("primaryMenuTree", menu_map.get("menuTree", []))
    if not isinstance(menu_tree, list):
        return expected

    for parent in menu_tree:
        if not isinstance(parent, dict):
            continue

        parent_text = parent.get("text")
        if not is_non_empty_string(parent_text):
            continue

        expected.append((parent_text,))

        children = parent.get("children", [])
        if not isinstance(children, list):
            continue

        for child in children:
            if not isinstance(child, dict):
                continue

            child_text = child.get("text")
            if is_non_empty_string(child_text):
                expected.append((parent_text, child_text))

    return expected


def format_menu_path(menu_path):
    return json.dumps(list(menu_path), ensure_ascii=False)


def validate_menu_coverage(plan, menu_map, errors):
    expected_paths = collect_expected_menu_paths(menu_map)
    expected_set = set(expected_paths)
    actual_paths = []
    actual_indexes = {}

    tests = plan.get("tests") if isinstance(plan, dict) else None
    if not isinstance(tests, list):
        return

    for index, test_case in enumerate(tests):
        if not isinstance(test_case, dict):
            continue

        key = menu_path_key(test_case.get("menuPath"))
        if key is None:
            continue

        actual_paths.append(key)
        actual_indexes.setdefault(key, []).append(index)

    actual_set = set(actual_paths)

    for menu_path in expected_paths:
        if menu_path not in actual_set:
            add_error(
                errors,
                "E401",
                f"missing test case for menuPath: {format_menu_path(menu_path)}",
                "$.coverage",
            )

    for menu_path in sorted(actual_set - expected_set):
        first_index = actual_indexes.get(menu_path, ["?"])[0]
        add_error(
            errors,
            "E402",
            f"unknown test case menuPath: {format_menu_path(menu_path)}",
            f"$.tests[{first_index}].menuPath",
        )

    for menu_path, indexes in actual_indexes.items():
        if len(indexes) > 1:
            add_error(
                errors,
                "E403",
                f"duplicate test case menuPath: {format_menu_path(menu_path)} at indexes {indexes}",
                "$.coverage",
            )


def validate(plan, menu_map=None):
    errors = []
    warnings = []

    validate_top_level(plan, errors)
    if isinstance(plan, dict):
        validate_test_cases(plan, errors, warnings)

        if menu_map is not None:
            validate_menu_coverage(plan, menu_map, errors)

    return errors, warnings


def print_report(path, errors, warnings, menu_map_path=None):
    print("Structured Test Plan Validation")
    print(f"- plan: {rel(path)}")
    if menu_map_path is not None:
        print(f"- menu_map: {rel(menu_map_path)}")
    print()

    print("Errors:")
    if errors:
        for code, message in errors:
            print(f"[{code}] {message}")
    else:
        print("- none")

    print()
    print("Warnings:")
    if warnings:
        for code, message in warnings:
            print(f"[{code}] {message}")
    else:
        print("- none")

    print()
    print("Summary:")
    print(f"- errors: {len(errors)}")
    print(f"- warnings: {len(warnings)}")

    if not errors and not warnings:
        print()
        print("validation passed")
    elif not errors:
        print()
        print("validation passed with warnings")


def main():
    args = parse_args()
    path = Path(args.input)
    menu_map_path = Path(args.menu_map) if args.menu_map else None

    if not path.is_absolute():
        path = ROOT_DIR / path
    if menu_map_path is not None and not menu_map_path.is_absolute():
        menu_map_path = ROOT_DIR / menu_map_path

    try:
        plan = load_json(path)
    except (FileNotFoundError, ValueError) as error:
        print("Structured Test Plan Validation")
        print(f"- plan: {rel(path)}")
        print()
        print(f"Error: {error}")
        return 1

    menu_map = None
    if menu_map_path is not None:
        try:
            menu_map = load_menu_map(menu_map_path)
        except (FileNotFoundError, ValueError) as error:
            print("Structured Test Plan Validation")
            print(f"- plan: {rel(path)}")
            print(f"- menu_map: {rel(menu_map_path)}")
            print()
            print(f"Error: {error}")
            return 1

    errors, warnings = validate(plan, menu_map=menu_map)
    print_report(path, errors, warnings, menu_map_path=menu_map_path)

    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
