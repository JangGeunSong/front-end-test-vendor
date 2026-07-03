import argparse
import json
import sys
from pathlib import Path

from validate_test_plan import DEFAULT_TEST_PLAN_PATH, load_json, rel, validate


ROOT_DIR = Path(__file__).resolve().parents[2]
DEFAULT_OUTPUT_PATH = ROOT_DIR / "tests" / "generated" / "generated_from_plan.spec.js"
SUPPORTED_TEMPLATES = {
    "navigation.urlOnly",
    "navigation.headingIdentity",
    "navigation.contentIdentity",
    "navigation.tabIdentity",
    "navigation.todoIdentity",
}


def parse_args():
    parser = argparse.ArgumentParser(
        description="Render a Playwright spec from structured test plan JSON."
    )
    parser.add_argument(
        "--input",
        default=str(DEFAULT_TEST_PLAN_PATH),
        help="Path to structured test plan JSON."
    )
    parser.add_argument(
        "--output",
        default=str(DEFAULT_OUTPUT_PATH),
        help="Path to the generated Playwright spec."
    )

    return parser.parse_args()


def js_string(value):
    return json.dumps(value, ensure_ascii=False)


def indent(text, spaces=4):
    prefix = " " * spaces
    return "\n".join(prefix + line if line else line for line in text.splitlines())


def escape_css_attr(value):
    return str(value).replace("\\", "\\\\").replace('"', '\\"')


def get_url_href(test_case):
    return ((test_case.get("assertions") or {}).get("url") or {}).get("href")


def get_identity(test_case):
    return (test_case.get("assertions") or {}).get("identity") or {}


def render_options_object(click):
    options = []

    for key in ("id", "ngClick", "cssPath"):
        value = click.get(key)
        if isinstance(value, str) and value:
            options.append(f"{key}: {js_string(value)}")

    if not options:
        return ""

    return ", { " + ", ".join(options) + " }"


def render_open_depth1(test_case):
    depth1_index = test_case.get("depth1Index")

    if isinstance(depth1_index, (int, float)) and not isinstance(depth1_index, bool):
        return f"await openDepth1ByIndex(page, {int(depth1_index)});"

    return "// TODO: depth1Index is unknown; confirm navigation open target before enabling this step."


def render_click(test_case):
    click = test_case["click"]
    click_type = click["type"]

    lines = [render_open_depth1(test_case)]

    if click_type == "depth2":
        lines.append(f"await clickVisibleMenuByText(page, {js_string(click['text'])});")
    elif click_type == "depth3":
        options = render_options_object(click)
        lines.append(
            "await clickVisibleSubMenuByText("
            f"page, {js_string(click['parentText'])}, {js_string(click['text'])}{options}"
            ");"
        )
    else:
        raise ValueError(f"Unsupported click.type: {click_type}")

    return "\n".join(lines)


def render_url_assertion(test_case):
    href = get_url_href(test_case)

    if not href:
        return ""

    return f"await expectUrlToContainHref(page, {js_string(href)});"


def render_heading_identity(test_case):
    identity = get_identity(test_case)
    text = identity["text"]
    exact = "true" if identity.get("exact") is True else "false"
    label = " > ".join(test_case["menuPath"])

    return "\n".join([
        f"const identityHeading = page.getByRole('heading', {{ name: {js_string(text)}, exact: {exact} }});",
        "await expect(identityHeading).toBeVisible();",
        f"await highlightPageIdentity(page, identityHeading, {js_string(label + ': heading')});",
    ])


def render_content_identity(test_case):
    identity = get_identity(test_case)
    selector = identity["selector"]
    label = " > ".join(test_case["menuPath"])

    return "\n".join([
        f"const identityArea = page.locator({js_string(selector)}).first();",
        "await expect(identityArea).toBeVisible();",
        f"await highlightPageIdentity(page, identityArea, {js_string(label + ': content')});",
    ])


def render_tab_locator(identity):
    if identity.get("selector"):
        return f"page.locator({js_string(identity['selector'])}).first()"

    if identity.get("id"):
        selector = f"[id=\"{escape_css_attr(identity['id'])}\"]"
        return f"page.locator({js_string(selector)}).first()"

    if identity.get("text"):
        return f"page.getByText({js_string(identity['text'])}, {{ exact: true }}).first()"

    raise ValueError("tab identity requires selector, id, or text")


def render_tab_identity(test_case):
    identity = get_identity(test_case)
    label = " > ".join(test_case["menuPath"])
    locator = render_tab_locator(identity)

    return "\n".join([
        f"const identityTab = {locator};",
        "await expect(identityTab).toBeVisible();",
        f"await highlightPageIdentity(page, identityTab, {js_string(label + ': tab')});",
    ])


def render_todo_identity(test_case):
    reason = ((test_case.get("todo") or {}).get("reason") or "Page Identity assertion is not stable yet.")
    return f"// TODO: {reason}"


def render_test_body(test_case):
    template = test_case["template"]
    lines = [render_click(test_case)]

    if template == "navigation.urlOnly":
        lines.append(render_url_assertion(test_case))
    elif template == "navigation.headingIdentity":
        lines.append(render_url_assertion(test_case))
        lines.append(render_heading_identity(test_case))
    elif template == "navigation.contentIdentity":
        lines.append(render_url_assertion(test_case))
        lines.append(render_content_identity(test_case))
    elif template == "navigation.tabIdentity":
        if test_case.get("navigationChange") == "expected" and get_url_href(test_case):
            lines.append(render_url_assertion(test_case))
        lines.append(render_tab_identity(test_case))
    elif template == "navigation.todoIdentity":
        if get_url_href(test_case):
            lines.append(render_url_assertion(test_case))
        lines.append(render_todo_identity(test_case))
    else:
        raise ValueError(f"Unsupported template: {template}")

    return "\n".join(line for line in lines if line)


def render_test_case(test_case):
    title = test_case["title"]
    body = render_test_body(test_case)

    return "\n".join([
        f"  test({js_string(title)}, async ({{ page }}) => {{",
        indent(body, 4),
        "  });",
    ])


def render_spec(plan):
    target_url = plan["targetUrl"]
    tests = plan.get("tests", [])
    unsupported = sorted({test.get("template") for test in tests if test.get("template") not in SUPPORTED_TEMPLATES})

    if unsupported:
        raise ValueError(f"Unsupported template(s): {', '.join(str(item) for item in unsupported)}")

    rendered_tests = "\n\n".join(render_test_case(test_case) for test_case in tests)

    return f"""const {{ test, expect }} = require('@playwright/test');
const {{ openDepth1ByIndex, clickVisibleMenuByText, clickVisibleSubMenuByText }} = require('../../utils/gnb');
const {{ highlightPageIdentity }} = require('../../utils/highlight');

const BASE_URL = process.env.BASE_URL || {js_string(target_url)};

function escapeRegExp(value) {{
  return String(value).replace(/[.*+?^${{}}()|[\\]\\\\]/g, '\\\\$&');
}}

async function expectUrlToContainHref(page, href) {{
  if (!href) return;
  await expect(page).toHaveURL(new RegExp(escapeRegExp(href)));
}}

test.beforeEach(async ({{ page }}) => {{
  await page.goto(BASE_URL);
  await page.waitForLoadState('domcontentloaded');
}});

test.describe('Structured test plan rendering', () => {{
{rendered_tests}
}});
"""


def render_file(input_path, output_path):
    plan = load_json(input_path)
    errors, warnings = validate(plan)

    if errors:
        for code, message in errors:
            print(f"[{code}] {message}")
        raise SystemExit(1)

    if warnings:
        for code, message in warnings:
            print(f"[{code}] {message}")

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(render_spec(plan), encoding="utf-8")
    print(f"Rendered Playwright spec: {rel(output_path)}")


def main():
    args = parse_args()
    input_path = Path(args.input)
    output_path = Path(args.output)

    if not input_path.is_absolute():
        input_path = ROOT_DIR / input_path
    if not output_path.is_absolute():
        output_path = ROOT_DIR / output_path

    render_file(input_path, output_path)
    return 0


if __name__ == "__main__":
    sys.exit(main())
