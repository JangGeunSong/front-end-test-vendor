import argparse
import json
import sys
from collections import Counter
from pathlib import Path
from urllib.parse import urlparse


ROOT_DIR = Path(__file__).resolve().parents[2]
DEFAULT_DETERMINISTIC_PLAN_PATH = ROOT_DIR / "tools" / "ai-generator" / "generated" / "test_plan.generated.json"
DEFAULT_LLM_PLAN_PATH = ROOT_DIR / "tools" / "ai-generator" / "generated" / "test_plan.llm.json"
DEFAULT_JSON_REPORT_PATH = ROOT_DIR / "tools" / "ai-generator" / "generated" / "plan_compare_report.json"
DEFAULT_MARKDOWN_REPORT_PATH = ROOT_DIR / "tools" / "ai-generator" / "generated" / "plan_compare_report.md"


def parse_args():
    parser = argparse.ArgumentParser(
        description="Compare deterministic and LLM structured test plans by menuPath."
    )
    parser.add_argument(
        "--deterministic",
        default=str(DEFAULT_DETERMINISTIC_PLAN_PATH),
        help="Path to deterministic structured test plan JSON."
    )
    parser.add_argument(
        "--llm",
        default=str(DEFAULT_LLM_PLAN_PATH),
        help="Path to LLM structured test plan JSON."
    )
    parser.add_argument(
        "--json-output",
        default=str(DEFAULT_JSON_REPORT_PATH),
        help="Path to write JSON comparison report."
    )
    parser.add_argument(
        "--markdown-output",
        default=str(DEFAULT_MARKDOWN_REPORT_PATH),
        help="Path to write Markdown comparison report."
    )

    return parser.parse_args()


def resolve_path(path):
    path = Path(path)
    if path.is_absolute():
        return path
    return ROOT_DIR / path


def rel(path):
    return path.relative_to(ROOT_DIR).as_posix()


def load_json(path, label):
    if not path.exists():
        raise FileNotFoundError(f"{label} plan file not found: {rel(path)}")

    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as error:
        raise ValueError(f"{label} plan JSON parse failed: {rel(path)} ({error})") from error


def tests(plan):
    value = plan.get("tests") if isinstance(plan, dict) else None
    return value if isinstance(value, list) else []


def menu_path_key(test_case):
    menu_path = test_case.get("menuPath") if isinstance(test_case, dict) else None
    if not isinstance(menu_path, list):
        return None
    if not all(isinstance(item, str) and item for item in menu_path):
        return None
    return tuple(menu_path)


def format_menu_path(menu_path):
    return " > ".join(menu_path)


def index_by_menu_path(plan_tests):
    indexed = {}
    duplicates = {}
    order = []

    for index, test_case in enumerate(plan_tests):
        key = menu_path_key(test_case)
        if key is None:
            continue

        if key not in indexed:
            indexed[key] = test_case
            order.append(key)
        else:
            duplicates.setdefault(key, [indexed[key].get("_index", "?")]).append(index)

        test_case["_index"] = index

    return indexed, duplicates, order


def get_nested(value, *keys):
    current = value

    for key in keys:
        if not isinstance(current, dict):
            return None
        current = current.get(key)

    return current


def identity_summary(test_case):
    assertions = test_case.get("assertions") if isinstance(test_case, dict) else {}
    assertions = assertions if isinstance(assertions, dict) else {}
    identity = assertions.get("identity") if isinstance(assertions.get("identity"), dict) else {}
    url = assertions.get("url") if isinstance(assertions.get("url"), dict) else {}
    todo = test_case.get("todo") if isinstance(test_case.get("todo"), dict) else {}

    identity_type = identity.get("type")
    selector = identity.get("selector")
    tab_id = identity.get("id")
    identity_text = identity.get("text")
    selector_kind = classify_selector_kind(test_case, identity)

    return {
        "id": test_case.get("id"),
        "title": test_case.get("title"),
        "template": test_case.get("template"),
        "navigationChange": test_case.get("navigationChange"),
        "clickType": get_nested(test_case, "click", "type"),
        "urlHref": url.get("href"),
        "identityType": identity_type,
        "selectorKind": selector_kind,
        "selector": selector,
        "identityText": identity_text,
        "identityId": tab_id,
        "exact": identity.get("exact"),
        "todoReason": todo.get("reason"),
    }


def classify_selector_kind(test_case, identity):
    template = test_case.get("template")
    identity_type = identity.get("type")

    if template == "navigation.todoIdentity":
        return "todo"
    if identity_type == "heading":
        return "headingText"
    if identity_type == "content":
        return "contentSelector" if identity.get("selector") else "contentMissingSelector"
    if identity_type == "tab":
        if identity.get("selector"):
            return "tabSelector"
        if identity.get("id"):
            return "tabId"
        if identity.get("text"):
            return "tabText"
        return "tabMissingTarget"
    if template == "navigation.urlOnly":
        return "urlOnly"
    return "none"


def diff_summaries(deterministic, llm):
    fields = [
        ("template", "template"),
        ("navigationChange", "navigationChange"),
        ("selectorKind", "selector kind"),
        ("identityType", "identity type"),
        ("selector", "selector"),
        ("identityText", "identity text"),
        ("identityId", "identity id"),
        ("urlHref", "url href"),
        ("todoReason", "todo reason"),
    ]
    differences = []

    for key, label in fields:
        if deterministic.get(key) != llm.get(key):
            differences.append({
                "field": key,
                "label": label,
                "deterministic": deterministic.get(key),
                "llm": llm.get(key),
            })

    return differences


def normalize_url_href(value):
    if not isinstance(value, str):
        return value

    value = value.strip()
    if not value:
        return value

    parsed = urlparse(value)
    if parsed.fragment:
        return f"#{parsed.fragment}"

    hash_index = value.find("#")
    if hash_index >= 0:
        return value[hash_index:]

    return value


def equivalent_url_href(left, right):
    return normalize_url_href(left) == normalize_url_href(right)


def same_tab_target(deterministic, llm):
    if deterministic.get("template") != "navigation.tabIdentity":
        return False
    if llm.get("template") != "navigation.tabIdentity":
        return False
    if deterministic.get("selectorKind") != llm.get("selectorKind"):
        return False

    selector_kind = deterministic.get("selectorKind")
    if selector_kind == "tabSelector":
        return deterministic.get("selector") == llm.get("selector")
    if selector_kind == "tabId":
        return deterministic.get("identityId") == llm.get("identityId")

    return False


def meaningful_differences(deterministic, llm, raw_differences):
    meaningful = []

    for diff in raw_differences:
        field = diff["field"]

        if field == "urlHref" and equivalent_url_href(diff["deterministic"], diff["llm"]):
            continue

        if field == "identityText" and same_tab_target(deterministic, llm):
            continue

        meaningful.append(diff)

    return meaningful


def template_distribution(plan_tests):
    return dict(Counter(test_case.get("template") for test_case in plan_tests))


def todo_count(plan_tests):
    return sum(1 for test_case in plan_tests if test_case.get("template") == "navigation.todoIdentity")


def build_report(deterministic_plan, llm_plan, deterministic_path, llm_path):
    deterministic_tests = tests(deterministic_plan)
    llm_tests = tests(llm_plan)
    deterministic_index, deterministic_duplicates, deterministic_order = index_by_menu_path(deterministic_tests)
    llm_index, llm_duplicates, llm_order = index_by_menu_path(llm_tests)

    deterministic_paths = set(deterministic_index)
    llm_paths = set(llm_index)
    matched_paths = deterministic_paths & llm_paths
    only_in_deterministic = [path for path in deterministic_order if path not in llm_paths]
    only_in_llm = [path for path in llm_order if path not in deterministic_paths]

    details = []
    ordered_paths = list(deterministic_order)
    ordered_paths.extend(path for path in llm_order if path not in deterministic_paths)

    raw_template_mismatch_count = 0
    meaningful_template_mismatch_count = 0
    navigation_change_mismatch_count = 0
    raw_selector_kind_mismatch_count = 0
    meaningful_selector_mismatch_count = 0
    raw_assertion_mismatch_count = 0
    meaningful_assertion_mismatch_count = 0
    todo_mismatch_count = 0

    for path in ordered_paths:
        deterministic_case = deterministic_index.get(path)
        llm_case = llm_index.get(path)

        if deterministic_case is None:
            details.append({
                "menuPath": list(path),
                "status": "onlyInLlm",
                "deterministic": None,
                "llm": identity_summary(llm_case),
                "rawDifferences": [],
                "meaningfulDifferences": [],
            })
            continue

        if llm_case is None:
            details.append({
                "menuPath": list(path),
                "status": "onlyInDeterministic",
                "deterministic": identity_summary(deterministic_case),
                "llm": None,
                "rawDifferences": [],
                "meaningfulDifferences": [],
            })
            continue

        deterministic_summary = identity_summary(deterministic_case)
        llm_summary = identity_summary(llm_case)
        raw_differences = diff_summaries(deterministic_summary, llm_summary)
        meaningful = meaningful_differences(deterministic_summary, llm_summary, raw_differences)

        if deterministic_summary["template"] != llm_summary["template"]:
            raw_template_mismatch_count += 1
            meaningful_template_mismatch_count += 1
        if deterministic_summary["navigationChange"] != llm_summary["navigationChange"]:
            navigation_change_mismatch_count += 1
        if deterministic_summary["selectorKind"] != llm_summary["selectorKind"]:
            raw_selector_kind_mismatch_count += 1
            meaningful_selector_mismatch_count += 1
        if any(diff["field"] in {"identityType", "selector", "identityText", "identityId", "urlHref", "todoReason"} for diff in raw_differences):
            raw_assertion_mismatch_count += 1
        if any(diff["field"] in {"identityType", "selector", "identityText", "identityId", "urlHref", "todoReason"} for diff in meaningful):
            meaningful_assertion_mismatch_count += 1
        if deterministic_summary["template"] == "navigation.todoIdentity" or llm_summary["template"] == "navigation.todoIdentity":
            if deterministic_summary["template"] != llm_summary["template"]:
                todo_mismatch_count += 1

        details.append({
            "menuPath": list(path),
            "status": "matchedWithMeaningfulDiff" if meaningful else "matched",
            "rawStatus": "matchedWithRawDiff" if raw_differences else "matched",
            "deterministic": deterministic_summary,
            "llm": llm_summary,
            "rawDifferences": raw_differences,
            "meaningfulDifferences": meaningful,
        })

    summary = {
        "deterministicPlan": rel(deterministic_path),
        "llmPlan": rel(llm_path),
        "deterministicTotalTests": len(deterministic_tests),
        "llmTotalTests": len(llm_tests),
        "matchedMenuPaths": len(matched_paths),
        "missingOnlyInDeterministic": len(only_in_deterministic),
        "missingOnlyInLlm": len(only_in_llm),
        "rawTemplateMismatchCount": raw_template_mismatch_count,
        "meaningfulTemplateMismatchCount": meaningful_template_mismatch_count,
        "navigationChangeMismatchCount": navigation_change_mismatch_count,
        "rawSelectorKindMismatchCount": raw_selector_kind_mismatch_count,
        "meaningfulSelectorMismatchCount": meaningful_selector_mismatch_count,
        "rawAssertionMismatchCount": raw_assertion_mismatch_count,
        "meaningfulAssertionMismatchCount": meaningful_assertion_mismatch_count,
        "todoMismatchCount": todo_mismatch_count,
        "deterministicTodoIdentityCount": todo_count(deterministic_tests),
        "llmTodoIdentityCount": todo_count(llm_tests),
        "deterministicTemplateDistribution": template_distribution(deterministic_tests),
        "llmTemplateDistribution": template_distribution(llm_tests),
        "deterministicDuplicateMenuPaths": {format_menu_path(path): indexes for path, indexes in deterministic_duplicates.items()},
        "llmDuplicateMenuPaths": {format_menu_path(path): indexes for path, indexes in llm_duplicates.items()},
    }

    return {
        "summary": summary,
        "onlyInDeterministic": [list(path) for path in only_in_deterministic],
        "onlyInLlm": [list(path) for path in only_in_llm],
        "details": details,
    }


def write_json_report(report, path):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(report, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )


def render_markdown(report):
    summary = report["summary"]
    lines = [
        "# Structured Test Plan Compare Report",
        "",
        "## Summary",
        "",
        f"- deterministic plan: `{summary['deterministicPlan']}`",
        f"- LLM plan: `{summary['llmPlan']}`",
        f"- deterministic total tests: {summary['deterministicTotalTests']}",
        f"- LLM total tests: {summary['llmTotalTests']}",
        f"- matched menuPaths: {summary['matchedMenuPaths']}",
        f"- missing only in deterministic: {summary['missingOnlyInDeterministic']}",
        f"- missing only in LLM: {summary['missingOnlyInLlm']}",
        f"- meaningful template mismatch count: {summary['meaningfulTemplateMismatchCount']}",
        f"- navigationChange mismatch count: {summary['navigationChangeMismatchCount']}",
        f"- meaningful selector mismatch count: {summary['meaningfulSelectorMismatchCount']}",
        f"- meaningful assertion/page identity mismatch count: {summary['meaningfulAssertionMismatchCount']}",
        f"- raw assertion/page identity mismatch count: {summary['rawAssertionMismatchCount']}",
        f"- todo mismatch count: {summary['todoMismatchCount']}",
        f"- deterministic todoIdentity count: {summary['deterministicTodoIdentityCount']}",
        f"- LLM todoIdentity count: {summary['llmTodoIdentityCount']}",
        "",
        "## Template Distribution",
        "",
        "| template | deterministic | LLM |",
        "| --- | ---: | ---: |",
    ]

    all_templates = sorted(
        set(summary["deterministicTemplateDistribution"]) |
        set(summary["llmTemplateDistribution"])
    )
    for template in all_templates:
        lines.append(
            f"| `{template}` | {summary['deterministicTemplateDistribution'].get(template, 0)} | {summary['llmTemplateDistribution'].get(template, 0)} |"
        )

    if report["onlyInDeterministic"]:
        lines.extend(["", "## Only In Deterministic", ""])
        for menu_path in report["onlyInDeterministic"]:
            lines.append(f"- {format_menu_path(tuple(menu_path))}")

    if report["onlyInLlm"]:
        lines.extend(["", "## Only In LLM", ""])
        for menu_path in report["onlyInLlm"]:
            lines.append(f"- {format_menu_path(tuple(menu_path))}")

    meaningful_mismatched_details = [
        detail for detail in report["details"]
        if detail["status"] == "matchedWithMeaningfulDiff"
    ]
    lines.extend(["", "## Meaningful MenuPath Differences", ""])
    if not meaningful_mismatched_details:
        lines.append("- none")
    else:
        for detail in meaningful_mismatched_details:
            lines.append(f"### {format_menu_path(tuple(detail['menuPath']))}")
            lines.append("")
            lines.append(f"- deterministic template: `{detail['deterministic']['template']}`")
            lines.append(f"- LLM template: `{detail['llm']['template']}`")
            lines.append(f"- deterministic selector kind: `{detail['deterministic']['selectorKind']}`")
            lines.append(f"- LLM selector kind: `{detail['llm']['selectorKind']}`")
            for diff in detail["meaningfulDifferences"]:
                lines.append(
                    f"- {diff['label']}: deterministic `{diff['deterministic']}` / LLM `{diff['llm']}`"
                )
            lines.append("")

    raw_only_details = [
        detail for detail in report["details"]
        if detail.get("rawStatus") == "matchedWithRawDiff" and detail["status"] == "matched"
    ]
    lines.extend(["", "## Raw-Only Differences", ""])
    if not raw_only_details:
        lines.append("- none")
    else:
        for detail in raw_only_details:
            lines.append(f"### {format_menu_path(tuple(detail['menuPath']))}")
            lines.append("")
            for diff in detail["rawDifferences"]:
                lines.append(
                    f"- {diff['label']}: deterministic `{diff['deterministic']}` / LLM `{diff['llm']}`"
                )
            lines.append("")

    return "\n".join(lines).rstrip() + "\n"


def write_markdown_report(report, path):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(render_markdown(report), encoding="utf-8")


def print_console_report(report, json_output, markdown_output):
    summary = report["summary"]

    print("Structured Test Plan Compare")
    print(f"- deterministic: {summary['deterministicPlan']}")
    print(f"- llm: {summary['llmPlan']}")
    print()
    print("Summary:")
    print(f"- deterministic total tests: {summary['deterministicTotalTests']}")
    print(f"- llm total tests: {summary['llmTotalTests']}")
    print(f"- matched menuPaths: {summary['matchedMenuPaths']}")
    print(f"- missing only in deterministic: {summary['missingOnlyInDeterministic']}")
    print(f"- missing only in llm: {summary['missingOnlyInLlm']}")
    print(f"- meaningful template mismatch count: {summary['meaningfulTemplateMismatchCount']}")
    print(f"- navigationChange mismatch count: {summary['navigationChangeMismatchCount']}")
    print(f"- meaningful selector mismatch count: {summary['meaningfulSelectorMismatchCount']}")
    print(f"- meaningful assertion/page identity mismatch count: {summary['meaningfulAssertionMismatchCount']}")
    print(f"- raw assertion/page identity mismatch count: {summary['rawAssertionMismatchCount']}")
    print(f"- todo mismatch count: {summary['todoMismatchCount']}")
    print(f"- deterministic todoIdentity count: {summary['deterministicTodoIdentityCount']}")
    print(f"- llm todoIdentity count: {summary['llmTodoIdentityCount']}")
    print()
    print("Template distribution:")
    for label, distribution in (
        ("deterministic", summary["deterministicTemplateDistribution"]),
        ("llm", summary["llmTemplateDistribution"]),
    ):
        print(f"- {label}: {distribution}")
    print()
    print("Reports:")
    print(f"- json: {rel(json_output)}")
    print(f"- markdown: {rel(markdown_output)}")


def main():
    args = parse_args()
    deterministic_path = resolve_path(args.deterministic)
    llm_path = resolve_path(args.llm)
    json_output = resolve_path(args.json_output)
    markdown_output = resolve_path(args.markdown_output)

    try:
        deterministic_plan = load_json(deterministic_path, "deterministic")
        llm_plan = load_json(llm_path, "llm")
    except (FileNotFoundError, ValueError) as error:
        print("Structured Test Plan Compare")
        print()
        print(f"Error: {error}")
        return 1

    report = build_report(deterministic_plan, llm_plan, deterministic_path, llm_path)
    write_json_report(report, json_output)
    write_markdown_report(report, markdown_output)
    print_console_report(report, json_output, markdown_output)

    return 0


if __name__ == "__main__":
    sys.exit(main())
