import json
import re
import sys
from pathlib import Path


ROOT_DIR = Path(__file__).resolve().parents[2]
DEFAULT_SPEC_PATH = ROOT_DIR / "tests" / "generated" / "generated_menu_access.spec.js"
DEFAULT_MENU_MAP_PATH = ROOT_DIR / "tools" / "ai-generator" / "generated" / "menu_map.json"
DEFAULT_SCOUT_RESULT_PATH = ROOT_DIR / "tools" / "ai-generator" / "generated" / "scout_result.json"


FORBIDDEN_SELECTOR_PATTERNS = [
    ("E001", "Forbidden generic selector", "table"),
    ("E001", "Forbidden generic selector", "form"),
    ("E001", "Forbidden generic selector", "[role=\"tab\"]"),
    ("E001", "Forbidden generic selector", "[role='tab']"),
    ("E002", "Forbidden shortened guide selector", "div#developGuide01-01"),
    ("E002", "Forbidden shortened guide selector", "div#verifyGuide01-01"),
]

BUTTON_ASSERTION_TEXTS = {
    "상세보기",
    "확대",
    "이전",
    "다음",
    "Previous",
    "Next",
    "조회",
    "검색",
}


def rel(path):
    return path.relative_to(ROOT_DIR).as_posix()


def load_text(path, label):
    if not path.exists():
        raise FileNotFoundError(f"{label} file not found: {rel(path)}")

    return path.read_text(encoding="utf-8")


def load_json(path, label):
    if not path.exists():
        raise FileNotFoundError(f"{label} file not found: {rel(path)}")

    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as error:
        raise ValueError(f"{label} JSON parse failed: {rel(path)} ({error})") from error


def js_string_pattern(value):
    escaped = re.escape(value)
    return rf"""(['"]){escaped}\1"""


def normalize_selector(selector):
    normalized = selector.strip()

    while "\\\\" in normalized:
        normalized = normalized.replace("\\\\", "\\")

    return normalized


def iter_page_profiles(data):
    if isinstance(data, dict):
        for profile in data.get("pageProfiles", []) or []:
            if isinstance(profile, dict):
                yield profile


def collect_css_paths_from_value(value, css_paths):
    if isinstance(value, dict):
        css_path = value.get("cssPath")
        if isinstance(css_path, str) and css_path.strip():
            css_paths.add(normalize_selector(css_path))

        for child in value.values():
            collect_css_paths_from_value(child, css_paths)
    elif isinstance(value, list):
        for item in value:
            collect_css_paths_from_value(item, css_paths)


def collect_page_profile_css_paths(*sources):
    css_paths = set()

    for source in sources:
        for profile in iter_page_profiles(source):
            collect_css_paths_from_value(profile.get("pageProfile", {}), css_paths)

    return css_paths


def collect_menu_tree_css_paths(menu_map):
    css_paths = set()

    for parent, child in iter_menu_tree(menu_map):
        item = child if child is not None else parent
        css_path = item.get("cssPath")

        if isinstance(css_path, str) and css_path.strip():
            css_paths.add(normalize_selector(css_path))

    return css_paths


def extract_page_locators(spec_text):
    pattern = re.compile(r"""page\.locator\(\s*(['"])(.*?)\1\s*\)""", re.DOTALL)

    for match in pattern.finditer(spec_text):
        yield {
            "selector": match.group(2),
            "expression": match.group(0),
            "start": match.start(),
        }


def add_forbidden_selector_errors(spec_text, errors):
    for code, message, selector in FORBIDDEN_SELECTOR_PATTERNS:
        pattern = re.compile(rf"""page\.locator\(\s*{js_string_pattern(selector)}\s*\)""")

        for match in pattern.finditer(spec_text):
            errors.append((code, f"{message}: {match.group(0)}"))


def add_unknown_css_path_warnings(spec_text, allowed_css_paths, warnings):
    for locator in extract_page_locators(spec_text):
        selector = normalize_selector(locator["selector"])

        if is_forbidden_selector(selector):
            continue

        if selector not in allowed_css_paths:
            warnings.append((
                "W201",
                f"Selector not found in pageProfiles/menuTree cssPath list: {selector}",
            ))


def is_forbidden_selector(selector):
    return any(selector == item[2] for item in FORBIDDEN_SELECTOR_PATTERNS)


def iter_menu_tree(menu_map):
    for parent in menu_map.get("menuTree", []) or []:
        if not isinstance(parent, dict):
            continue

        yield parent, None

        for child in parent.get("children", []) or []:
            if isinstance(child, dict):
                yield parent, child


def extract_static_child_arrays(spec_text):
    arrays = {}
    for array_info in extract_static_child_array_instances(spec_text):
        arrays[array_info["name"]] = array_info["items"]

    return arrays


def extract_static_child_array_instances(spec_text):
    arrays = []
    array_pattern = re.compile(r"""const\s+(\w+)\s*=\s*\[(.*?)\]\s*;""", re.DOTALL)
    object_pattern = re.compile(r"""\{(.*?)\}""", re.DOTALL)

    for array_match in array_pattern.finditer(spec_text):
        array_name = array_match.group(1)
        body = array_match.group(2)
        items = []

        for object_match in object_pattern.finditer(body):
            object_body = object_match.group(1)
            text = extract_object_string_value(object_body, "text")
            css_path = extract_object_string_value(object_body, "cssPath")

            if text:
                items.append({
                    "text": text,
                    "cssPath": css_path or "",
                })

        if items:
            arrays.append({
                "name": array_name,
                "items": items,
                "start": array_match.start(),
                "end": array_match.end(),
            })

    return arrays


def extract_object_string_value(object_body, key):
    pattern = re.compile(rf"""\b{re.escape(key)}\s*:\s*(['"])(.*?)\1""", re.DOTALL)
    match = pattern.search(object_body)

    if not match:
        return ""

    return match.group(2)


def extract_loop_submenu_calls(spec_text):
    loop_pattern = re.compile(r"""for\s*\(\s*const\s+(\w+)\s+of\s+(\w+)\s*\)\s*\{""")
    calls = []
    static_arrays = extract_static_child_array_instances(spec_text)

    for match in loop_pattern.finditer(spec_text):
        item_name = match.group(1)
        array_name = match.group(2)
        open_brace_index = match.end() - 1
        close_brace_index = find_matching_brace(spec_text, open_brace_index)

        if close_brace_index == -1:
            calls.append({
                "array": array_name,
                "item": item_name,
                "parent": "",
                "options": "",
                "has_step": False,
                "recognized": False,
                "items": find_nearest_static_array_items(static_arrays, array_name, match.start()),
            })
            continue

        body = spec_text[open_brace_index + 1:close_brace_index]
        items = find_nearest_static_array_items(static_arrays, array_name, match.start())
        submenu_call = extract_loop_submenu_call_from_body(body, item_name)

        if not submenu_call:
            calls.append({
                "array": array_name,
                "item": item_name,
                "parent": "",
                "options": "",
                "has_step": has_child_text_step(body, item_name),
                "recognized": False,
                "items": items,
            })
            continue

        calls.append({
            "array": array_name,
            "item": item_name,
            "parent": submenu_call["parent"],
            "options": submenu_call["options"],
            "has_step": has_child_text_step(body, item_name),
            "recognized": True,
            "items": items,
        })

    return calls


def extract_loop_submenu_call_from_body(loop_body, item_name):
    function_name = "clickVisibleSubMenuByText"
    search_from = 0

    while True:
        function_index = loop_body.find(function_name, search_from)
        if function_index == -1:
            return None

        open_index = loop_body.find("(", function_index + len(function_name))
        if open_index == -1:
            return None

        close_index = find_matching_paren(loop_body, open_index)
        if close_index == -1:
            search_from = open_index + 1
            continue

        args_text = loop_body[open_index + 1:close_index]
        args = split_top_level_args(args_text)

        if len(args) >= 4 and args[0].strip() == "page":
            parent = parse_js_string_literal(args[1])
            child_expression = re.sub(r"\s+", "", args[2])
            expected_child_expression = f"{item_name}.text"

            if parent and child_expression == expected_child_expression:
                return {
                    "parent": parent,
                    "options": args[3],
                    "expression": loop_body[function_index:close_index + 1],
                }

        search_from = close_index + 1


def find_nearest_static_array_items(static_arrays, array_name, before_index):
    candidates = [
        item for item in static_arrays
        if item["name"] == array_name and item["end"] <= before_index
    ]

    if not candidates:
        return []

    return max(candidates, key=lambda item: item["end"])["items"]


def has_child_text_step(loop_body, item_name):
    pattern = re.compile(
        rf"""test\.step\s*\(\s*`[^`]*\$\{{\s*{re.escape(item_name)}\.text\s*\}}[^`]*`""",
        re.DOTALL,
    )
    return bool(pattern.search(loop_body))


def extract_submenu_calls(spec_text):
    calls = []
    function_name = "clickVisibleSubMenuByText"
    search_from = 0

    while True:
        function_index = spec_text.find(function_name, search_from)
        if function_index == -1:
            break

        open_index = spec_text.find("(", function_index + len(function_name))
        if open_index == -1:
            break

        close_index = find_matching_paren(spec_text, open_index)
        if close_index == -1:
            search_from = open_index + 1
            continue

        args_text = spec_text[open_index + 1:close_index]
        args = split_top_level_args(args_text)

        if len(args) >= 4 and args[0].strip() == "page":
            parent = parse_js_string_literal(args[1])
            child = parse_js_string_literal(args[2])

            if parent and child:
                calls.append({
                    "parent": parent,
                    "child": child,
                    "options": args[3],
                    "expression": spec_text[function_index:close_index + 1],
                })

        search_from = close_index + 1

    return calls


def find_matching_paren(text, open_index):
    depth = 0
    quote = None
    escaped = False

    for index in range(open_index, len(text)):
        char = text[index]

        if quote:
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == quote:
                quote = None
            continue

        if char in ("'", '"', "`"):
            quote = char
        elif char == "(":
            depth += 1
        elif char == ")":
            depth -= 1
            if depth == 0:
                return index

    return -1


def find_matching_brace(text, open_index):
    depth = 0
    quote = None
    escaped = False

    for index in range(open_index, len(text)):
        char = text[index]

        if quote:
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == quote:
                quote = None
            continue

        if char in ("'", '"', "`"):
            quote = char
        elif char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
            if depth == 0:
                return index

    return -1


def split_top_level_args(args_text):
    args = []
    start = 0
    paren_depth = 0
    brace_depth = 0
    bracket_depth = 0
    quote = None
    escaped = False

    for index, char in enumerate(args_text):
        if quote:
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == quote:
                quote = None
            continue

        if char in ("'", '"', "`"):
            quote = char
        elif char == "(":
            paren_depth += 1
        elif char == ")":
            paren_depth -= 1
        elif char == "{":
            brace_depth += 1
        elif char == "}":
            brace_depth -= 1
        elif char == "[":
            bracket_depth += 1
        elif char == "]":
            bracket_depth -= 1
        elif char == "," and paren_depth == 0 and brace_depth == 0 and bracket_depth == 0:
            args.append(args_text[start:index].strip())
            start = index + 1

    tail = args_text[start:].strip()
    if tail:
        args.append(tail)

    return args


def parse_js_string_literal(value):
    value = value.strip()

    if len(value) < 2 or value[0] not in ("'", '"') or value[-1] != value[0]:
        return ""

    inner = value[1:-1]
    return inner.replace("\\'", "'").replace('\\"', '"')


def add_depth3_css_path_errors(spec_text, menu_map, errors):
    calls = extract_submenu_calls(spec_text)
    loop_calls = extract_loop_submenu_calls(spec_text)
    loop_coverage = build_loop_css_path_coverage(loop_calls)
    computed_css_path_groups = build_computed_css_path_groups(loop_calls)
    reported_computed_groups = set()

    for parent, child in iter_menu_tree(menu_map):
        if child is None:
            continue

        css_path = child.get("cssPath")
        if not css_path:
            continue

        parent_text = parent.get("text", "")
        child_text = child.get("text", "")

        if loop_has_depth3_css_path(loop_coverage, parent_text, child_text, css_path):
            continue

        computed_key = (parent_text, child_text)
        computed_group = computed_css_path_groups.get(computed_key)
        if computed_group:
            group_key = (parent_text, computed_group)
            if group_key not in reported_computed_groups:
                errors.append((
                    "E104",
                    f"Computed cssPath is not allowed for depth3 menu group: {parent_text}",
                ))
                reported_computed_groups.add(group_key)
            continue

        matching_calls = [
            call for call in calls
            if call["parent"] == parent_text and call["child"] == child_text
        ]

        if not matching_calls:
            errors.append((
                "E101",
                f"Missing clickVisibleSubMenuByText call for depth3 menu: {parent_text} > {child_text}",
            ))
            continue

        if not any("cssPath" in call["options"] for call in matching_calls):
            errors.append((
                "E101",
                f"Missing cssPath option for depth3 menu: {parent_text} > {child_text}",
            ))


def build_loop_css_path_coverage(loop_calls):
    coverage = {}

    for loop_call in loop_calls:
        if not loop_call.get("recognized"):
            continue

        if "cssPath" not in loop_call.get("options", ""):
            continue

        if f"{loop_call['item']}.cssPath" not in loop_call.get("options", ""):
            continue

        parent_text = loop_call.get("parent", "")
        if not parent_text:
            continue

        for item in loop_call.get("items", []):
            coverage[(parent_text, item["text"])] = {
                "cssPath": item.get("cssPath", ""),
                "has_step": loop_call.get("has_step", False),
            }

    return coverage


def build_loop_step_coverage(loop_calls):
    coverage = {}

    for loop_call in loop_calls:
        if not loop_call.get("recognized"):
            continue

        parent_text = loop_call.get("parent", "")
        if not parent_text or not loop_call.get("has_step"):
            continue

        for item in loop_call.get("items", []):
            coverage[(parent_text, item["text"])] = {
                "array": loop_call["array"],
                "has_step": True,
            }

    return coverage


def build_computed_css_path_groups(loop_calls):
    groups = {}

    for loop_call in loop_calls:
        if not loop_call.get("recognized"):
            continue

        options = loop_call.get("options", "")
        if "cssPath" not in options:
            continue

        if f"{loop_call['item']}.cssPath" in options:
            continue

        if not has_computed_css_path_option(options):
            continue

        parent_text = loop_call.get("parent", "")
        if not parent_text:
            continue

        for item in loop_call.get("items", []):
            groups[(parent_text, item["text"])] = loop_call["array"]

    return groups


def has_computed_css_path_option(options):
    pattern = re.compile(r"""cssPath\s*:\s*(?!['"])[^,}]+""", re.DOTALL)
    return bool(pattern.search(options))


def loop_has_depth3_css_path(loop_coverage, parent_text, child_text, expected_css_path):
    item = loop_coverage.get((parent_text, child_text))

    if not item:
        return False

    return normalize_selector(item.get("cssPath", "")) == normalize_selector(expected_css_path)


def add_depth3_standalone_click_errors(spec_text, menu_map, errors):
    depth2_texts = set()
    depth3_texts = set()

    for parent, child in iter_menu_tree(menu_map):
        if child is None:
            text = parent.get("text")
            if text:
                depth2_texts.add(text)
            continue

        text = child.get("text")
        if text:
            depth3_texts.add(text)

    pattern = re.compile(r"""clickVisibleMenuByText\s*\(\s*page\s*,\s*(['"])(.*?)\1\s*\)""")

    for match in pattern.finditer(spec_text):
        clicked_text = match.group(2)

        if clicked_text in depth3_texts and clicked_text not in depth2_texts:
            errors.append((
                "E102",
                f"Depth3 menu clicked without parent scope: {match.group(0)}",
            ))


def extract_test_step_titles(spec_text):
    pattern = re.compile(r"""test\.step\s*\(\s*(['"`])(.+?)\1\s*,""", re.DOTALL)
    return [match.group(2).replace("\n", " ") for match in pattern.finditer(spec_text)]


def add_menu_step_coverage_errors(spec_text, menu_map, errors):
    step_titles = extract_test_step_titles(spec_text)
    loop_coverage = build_loop_step_coverage(extract_loop_submenu_calls(spec_text))

    for parent, child in iter_menu_tree(menu_map):
        if child is None:
            menu_text = parent.get("text", "")
            menu_label = menu_text
        else:
            menu_text = child.get("text", "")
            menu_label = f"{parent.get('text', '')} > {menu_text}"

        if not menu_text:
            continue

        if child is not None:
            loop_item = loop_coverage.get((parent.get("text", ""), menu_text))
            if loop_item and loop_item.get("has_step"):
                continue

        if not any(menu_text in title for title in step_titles):
            errors.append((
                "E103",
                f"Missing test.step coverage for menu: {menu_label}",
            ))


def extract_get_by_text_assertion_candidates(spec_text):
    pattern = re.compile(r"""getByText\s*\(\s*(['"])(.*?)\1""", re.DOTALL)

    for match in pattern.finditer(spec_text):
        yield match.group(2)


def add_assertion_candidate_warnings(spec_text, warnings):
    for text in extract_get_by_text_assertion_candidates(spec_text):
        normalized = re.sub(r"\s+", " ", text).strip()

        if not normalized:
            continue

        if looks_like_bracket_notice(normalized):
            warnings.append(("W301", f"Bracketed notice-like getByText assertion: {normalized}"))
        elif looks_like_faq_question(normalized):
            warnings.append(("W302", f"FAQ/question-like getByText assertion: {normalized}"))
        elif looks_like_model_name(normalized):
            warnings.append(("W303", f"Product/model-like getByText assertion: {normalized}"))
        elif normalized in BUTTON_ASSERTION_TEXTS:
            warnings.append(("W304", f"Button text assertion candidate: {normalized}"))


def looks_like_bracket_notice(text):
    return ("[" in text and "]" in text) or ("【" in text and "】" in text)


def looks_like_faq_question(text):
    return len(text) >= 18 and text.rstrip().endswith(("?", "？"))


def looks_like_model_name(text):
    has_alpha = re.search(r"[A-Za-z]", text)
    has_digit = re.search(r"\d", text)
    has_model_shape = re.search(r"[A-Za-z]{2,}[-_]?\d|\d[-_]?[A-Za-z]{2,}", text)

    return bool(has_alpha and has_digit and has_model_shape)


def print_report(spec_path, menu_map_path, scout_result_path, errors, warnings):
    print("Generated Spec Validation")
    print(f"- spec: {rel(spec_path)}")
    print(f"- menu_map: {rel(menu_map_path)}")
    print(f"- scout_result: {rel(scout_result_path)}")
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


def validate(spec_path, menu_map_path, scout_result_path):
    spec_text = load_text(spec_path, "generated spec")
    menu_map = load_json(menu_map_path, "menu_map")
    scout_result = load_json(scout_result_path, "scout_result")

    errors = []
    warnings = []
    page_profile_css_paths = collect_page_profile_css_paths(scout_result, menu_map)
    menu_tree_css_paths = collect_menu_tree_css_paths(menu_map)
    allowed_css_paths = page_profile_css_paths | menu_tree_css_paths

    add_forbidden_selector_errors(spec_text, errors)
    add_unknown_css_path_warnings(spec_text, allowed_css_paths, warnings)
    add_depth3_css_path_errors(spec_text, menu_map, errors)
    add_depth3_standalone_click_errors(spec_text, menu_map, errors)
    add_menu_step_coverage_errors(spec_text, menu_map, errors)
    add_assertion_candidate_warnings(spec_text, warnings)

    return errors, warnings


def main():
    spec_path = DEFAULT_SPEC_PATH
    menu_map_path = DEFAULT_MENU_MAP_PATH
    scout_result_path = DEFAULT_SCOUT_RESULT_PATH

    try:
        errors, warnings = validate(spec_path, menu_map_path, scout_result_path)
    except (FileNotFoundError, ValueError) as error:
        print("Generated Spec Validation")
        print(f"- spec: {rel(spec_path)}")
        print(f"- menu_map: {rel(menu_map_path)}")
        print(f"- scout_result: {rel(scout_result_path)}")
        print()
        print(f"Error: {error}")
        return 1

    print_report(spec_path, menu_map_path, scout_result_path, errors, warnings)

    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
