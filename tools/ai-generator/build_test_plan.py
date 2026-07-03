import argparse
import hashlib
import json
import sys
from pathlib import Path


ROOT_DIR = Path(__file__).resolve().parents[2]
DEFAULT_MENU_MAP_PATH = ROOT_DIR / "tools" / "ai-generator" / "generated" / "menu_map.json"
DEFAULT_OUTPUT_PATH = ROOT_DIR / "tools" / "ai-generator" / "generated" / "test_plan.generated.json"
MENU_MAP_SOURCE_PATH = "tools/ai-generator/generated/menu_map.json"
SCOUT_RESULT_SOURCE_PATH = "tools/ai-generator/generated/scout_result.json"


def parse_args():
    parser = argparse.ArgumentParser(
        description="Build structured test plan JSON from menu_map.json."
    )
    parser.add_argument(
        "--input",
        default=str(DEFAULT_MENU_MAP_PATH),
        help="Path to menu_map.json."
    )
    parser.add_argument(
        "--output",
        default=str(DEFAULT_OUTPUT_PATH),
        help="Path to generated structured test plan JSON."
    )

    return parser.parse_args()


def rel(path):
    return path.relative_to(ROOT_DIR).as_posix()


def load_json(path):
    if not path.exists():
        raise FileNotFoundError(f"menu_map file not found: {rel(path)}")

    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as error:
        raise ValueError(f"menu_map JSON parse failed: {rel(path)} ({error})") from error


def is_non_empty_string(value):
    return isinstance(value, str) and bool(value.strip())


def compact_string(value):
    return value.strip() if isinstance(value, str) else ""


def stable_id(menu_path):
    digest = hashlib.sha1(" > ".join(menu_path).encode("utf-8")).hexdigest()[:10]
    return f"gnb-{digest}"


def profile_key(menu_path):
    return tuple(menu_path or [])


def build_profile_index(menu_map):
    profiles = {}

    for profile in menu_map.get("pageProfiles", []) or []:
        if not isinstance(profile, dict):
            continue
        key = profile_key(profile.get("menuPath"))
        if key:
            profiles[key] = profile

    return profiles


def visible_items(items):
    return [
        item for item in (items or [])
        if isinstance(item, dict) and item.get("isVisible", True) is not False
    ]


def exact_heading(page_profile, menu_path):
    headings = visible_items((page_profile.get("pageProfile") or {}).get("headings"))
    if not headings:
        return None

    leaf_text = menu_path[-1] if menu_path else ""

    for heading in headings:
        if compact_string(heading.get("text")) == leaf_text:
            return heading

    return None


def first_css_path(page_profile, field_name):
    for item in visible_items((page_profile.get("pageProfile") or {}).get(field_name)):
        css_path = compact_string(item.get("cssPath"))
        if css_path:
            return css_path

    return ""


def stable_main_container_selector(page_profile):
    for item in visible_items((page_profile.get("pageProfile") or {}).get("mainContainers")):
        css_path = compact_string(item.get("cssPath"))
        tag_name = compact_string(item.get("tagName")).upper()
        class_name = compact_string(item.get("className")).lower()

        if not css_path:
            continue
        if tag_name == "MAIN":
            continue
        if "subcontainer" in class_name and "subcontent" not in class_name:
            continue

        return css_path

    return ""


def matching_tab_selector(page_profile, menu_path):
    leaf_text = menu_path[-1] if menu_path else ""

    for item in visible_items((page_profile.get("pageProfile") or {}).get("tabs")):
        if compact_string(item.get("text")) != leaf_text:
            continue

        css_path = compact_string(item.get("cssPath"))
        if css_path:
            return css_path

    return first_css_path(page_profile, "tabs")


def has_ng_click(menu_item):
    return bool(compact_string(menu_item.get("ngClick")))


def navigation_href(menu_item, page_profile):
    href = compact_string(menu_item.get("href"))
    if href:
        return href

    navigation = page_profile.get("navigation") if isinstance(page_profile, dict) else {}
    if not isinstance(navigation, dict):
        return ""

    for key in ("hash", "url"):
        value = compact_string(navigation.get(key))
        if value:
            return value

    return ""


def copy_optional_click_fields(menu_item, click):
    for key in ("id", "ngClick", "cssPath"):
        value = menu_item.get(key)
        if isinstance(value, str):
            click[key] = value


def build_click(menu_item, menu_path, parent_text=None):
    if parent_text:
        click = {
            "type": "depth3",
            "parentText": parent_text,
            "text": menu_path[-1],
        }
    else:
        click = {
            "type": "depth2",
            "text": menu_path[-1],
        }

    copy_optional_click_fields(menu_item, click)
    return click


def base_test_case(menu_item, menu_path, parent_text=None):
    return {
        "id": stable_id(menu_path),
        "title": "GNB: " + " > ".join(menu_path),
        "menuPath": menu_path,
        "depth1Index": menu_item.get("depth1Index"),
        "click": build_click(menu_item, menu_path, parent_text),
        "assertions": {},
    }


def with_url(test_case, href):
    if href:
        test_case["assertions"]["url"] = {"href": href}


def build_case(menu_item, menu_path, profile, parent_text=None):
    test_case = base_test_case(menu_item, menu_path, parent_text)
    href = navigation_href(menu_item, profile or {})
    heading = exact_heading(profile or {}, menu_path) if profile else None
    main_selector = stable_main_container_selector(profile or {}) if profile else ""
    tab_selector = matching_tab_selector(profile or {}, menu_path) if profile else ""
    is_depth3 = parent_text is not None
    is_tab_like_child = is_depth3 and (has_ng_click(menu_item) or not compact_string(menu_item.get("href")))

    if is_tab_like_child:
        tab_fallback_selector = tab_selector or compact_string(menu_item.get("cssPath"))
        if tab_fallback_selector:
            test_case["template"] = "navigation.tabIdentity"
            test_case["navigationChange"] = "none" if tab_selector else "unknown"
            with_url(test_case, href)
            test_case["assertions"]["identity"] = {
                "type": "tab",
                "selector": tab_fallback_selector,
                "sourceMenuPath": menu_path,
            }
            return test_case

        test_case["template"] = "navigation.todoIdentity"
        with_url(test_case, href)
        test_case["todo"] = {
            "reason": "Depth3 tab-like menu has no stable exact-match tab or content identity evidence yet."
        }
        return test_case

    if heading and href:
        test_case["template"] = "navigation.headingIdentity"
        with_url(test_case, href)
        test_case["assertions"]["identity"] = {
            "type": "heading",
            "text": compact_string(heading.get("text")),
            "exact": True,
        }
        return test_case

    if main_selector and href:
        test_case["template"] = "navigation.contentIdentity"
        with_url(test_case, href)
        test_case["assertions"]["identity"] = {
            "type": "content",
            "selector": main_selector,
            "sourceMenuPath": menu_path,
        }
        return test_case

    if tab_selector:
        test_case["template"] = "navigation.tabIdentity"
        test_case["navigationChange"] = "expected" if href else "none"
        with_url(test_case, href)
        test_case["assertions"]["identity"] = {
            "type": "tab",
            "selector": tab_selector,
            "sourceMenuPath": menu_path,
        }
        return test_case

    if not href and compact_string(menu_item.get("cssPath")):
        test_case["template"] = "navigation.tabIdentity"
        test_case["navigationChange"] = "unknown"
        test_case["assertions"]["identity"] = {
            "type": "tab",
            "selector": compact_string(menu_item.get("cssPath")),
            "sourceMenuPath": menu_path,
        }
        return test_case

    test_case["template"] = "navigation.todoIdentity"
    with_url(test_case, href)
    test_case["todo"] = {
        "reason": "No stable exact-match pageProfile identity evidence is available yet."
    }
    return test_case


def iter_primary_menu_cases(menu_map):
    for parent in menu_map.get("primaryMenuTree", []) or menu_map.get("menuTree", []) or []:
        if not isinstance(parent, dict):
            continue

        parent_text = compact_string(parent.get("text"))
        if not parent_text:
            continue

        yield parent, [parent_text], None

        for child in parent.get("children", []) or []:
            if not isinstance(child, dict):
                continue
            child_text = compact_string(child.get("text"))
            if not child_text:
                continue
            yield child, [parent_text, child_text], parent_text


def build_test_plan(menu_map):
    profile_index = build_profile_index(menu_map)
    tests = []

    for menu_item, menu_path, parent_text in iter_primary_menu_cases(menu_map):
        profile = profile_index.get(profile_key(menu_path))
        tests.append(build_case(menu_item, menu_path, profile, parent_text))

    return {
        "version": "1.0",
        "targetUrl": menu_map.get("url", ""),
        "source": {
            "menuMapPath": MENU_MAP_SOURCE_PATH,
            "scoutResultPath": SCOUT_RESULT_SOURCE_PATH,
        },
        "tests": tests,
    }


def write_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(data, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )


def main():
    args = parse_args()
    input_path = Path(args.input)
    output_path = Path(args.output)

    if not input_path.is_absolute():
        input_path = ROOT_DIR / input_path
    if not output_path.is_absolute():
        output_path = ROOT_DIR / output_path

    try:
        menu_map = load_json(input_path)
    except (FileNotFoundError, ValueError) as error:
        print(f"Error: {error}")
        return 1

    test_plan = build_test_plan(menu_map)
    write_json(output_path, test_plan)
    print(f"Built structured test plan: {rel(output_path)}")
    print(f"- tests: {len(test_plan.get('tests', []))}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
