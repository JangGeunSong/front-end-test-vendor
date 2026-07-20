import argparse
import html
import json
import sys
from pathlib import Path


ROOT_DIR = Path(__file__).resolve().parents[2]
GENERATED_DIR = ROOT_DIR / "tools" / "ai-generator" / "generated"
DEFAULT_INPUT_PATH = GENERATED_DIR / "analysis_review_report.json"
DEFAULT_OUTPUT_PATH = GENERATED_DIR / "analysis_review_report.md"

SUMMARY_FIELDS = [
    ("targetUrl", "Target URL"),
    ("generatedTestCount", "Generated tests"),
    ("primaryNavigationCount", "Primary navigation targets"),
    ("pageProfileCount", "Page profiles"),
    ("excludedCandidateCount", "Excluded candidates"),
    ("safeInteractionCandidateCount", "Safe interaction candidates"),
    ("tabRestoreReadyCandidateCount", "Tab restore ready candidates"),
    ("tabRestoreUnavailableCandidateCount", "Tab restore unavailable candidates"),
    ("unsafeActionCandidateCount", "Unsafe action candidates"),
    ("unresolvedCandidateCount", "Unresolved candidates"),
    ("recommendedActionCount", "Recommended actions"),
]


def parse_args():
    parser = argparse.ArgumentParser(
        description="Render Analysis Review Report JSON as deterministic Markdown."
    )
    parser.add_argument(
        "--input",
        default=str(DEFAULT_INPUT_PATH),
        help="Path to analysis_review_report.json.",
    )
    parser.add_argument(
        "--output",
        default=str(DEFAULT_OUTPUT_PATH),
        help="Path to write analysis_review_report.md.",
    )
    return parser.parse_args()


def resolve_path(value):
    path = Path(value)
    return path if path.is_absolute() else ROOT_DIR / path


def display_path(path):
    try:
        return path.relative_to(ROOT_DIR).as_posix()
    except ValueError:
        return str(path)


def load_report(path):
    if not path.exists():
        raise FileNotFoundError(f"Analysis Review Report JSON not found: {display_path(path)}")

    try:
        report = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as error:
        raise ValueError(
            f"Analysis Review Report JSON parse failed: {display_path(path)} ({error})"
        ) from error

    if not isinstance(report, dict):
        raise ValueError("Analysis Review Report top-level value must be an object.")
    return report


def compact_string(value):
    if value is None:
        return ""
    if isinstance(value, bool):
        return "true" if value else "false"
    return str(value).strip()


def object_list(report, key):
    value = report.get(key)
    if not isinstance(value, list):
        return []
    return [item for item in value if isinstance(item, dict)]


def string_list(value):
    if not isinstance(value, list):
        return []
    return [compact_string(item) for item in value if compact_string(item)]


def menu_path_text(value):
    parts = string_list(value)
    return " > ".join(parts) if parts else "(unknown menu path)"


def table_cell(value):
    text = compact_string(value) or "-"
    return text.replace("\\", "\\\\").replace("|", "\\|").replace("\r", "").replace("\n", "<br>")


def render_table(headers, rows):
    lines = [
        "| " + " | ".join(headers) + " |",
        "| " + " | ".join("---" for _ in headers) + " |",
    ]
    lines.extend("| " + " | ".join(table_cell(cell) for cell in row) + " |" for row in rows)
    return lines


def detail_summary(index, label):
    safe_label = html.escape(compact_string(label) or "Unnamed candidate", quote=True)
    return f"<details><summary>{index}. {safe_label}</summary>"


def append_value(lines, label, value):
    text = compact_string(value)
    if text:
        lines.append(f"- {label}: {text}")


def append_code_value(lines, label, value):
    text = compact_string(value)
    if not text:
        return
    lines.extend([f"- {label}:", "", "```text", text, "```", ""])


def append_list(lines, label, values):
    items = string_list(values)
    if not items:
        return
    lines.append(f"- {label}:")
    lines.extend(f"  - {item}" for item in items)


def append_mapping(lines, label, value):
    if not isinstance(value, dict) or not value:
        return
    lines.append(f"- {label}:")
    lines.extend(f"  - {key}: {compact_string(item)}" for key, item in value.items())


def close_detail(lines):
    lines.extend(["", "</details>", ""])


def append_tab_restore(lines, item):
    restore = item.get("tabRestore")
    if isinstance(restore, dict):
        target = restore.get("target")
        target = target if isinstance(target, dict) else {}
        append_value(lines, "Restore readiness", "ready")
        append_code_value(lines, "Tab group", restore.get("tabGroupSelector"))
        append_value(lines, "Restore strategy", restore.get("strategy"))
        append_value(lines, "Previous selected tab", target.get("text"))
        append_code_value(lines, "Restore candidate key", target.get("candidateKey"))
        append_code_value(lines, "Restore selector", target.get("selector"))
        append_code_value(lines, "Restore observed URL", target.get("observedUrl"))
        append_value(lines, "Restore page context", target.get("pageContext"))
        append_value(lines, "Restore role", target.get("role"))
        append_value(lines, "Restore tag name", target.get("tagName"))
        append_mapping(lines, "Restore ARIA attributes", target.get("ariaAttributes"))
    else:
        append_value(
            lines,
            "Restore readiness",
            item.get("tabRestoreUnavailableReason"),
        )


def render_warnings(report):
    warnings = string_list(report.get("warnings"))
    lines = ["## Warnings", ""]
    if not warnings:
        return lines + ["No warnings.", ""]
    lines.extend(f"- {warning}" for warning in warnings)
    lines.append("")
    return lines


def render_recommended_actions(report):
    actions = object_list(report, "recommendedNextActions")
    lines = ["## Recommended Next Actions", ""]
    if not actions:
        return lines + ["No recommended actions.", ""]
    rows = []
    for index, item in enumerate(actions, 1):
        rows.append(
            [
                index,
                item.get("action"),
                item.get("relatedCount"),
                item.get("criticalCount"),
                item.get("reason"),
            ]
        )
    lines.extend(render_table(["#", "Action", "Related", "Critical", "Reason"], rows))
    lines.append("")
    return lines


def render_summary(report):
    summary = report.get("summary")
    summary = summary if isinstance(summary, dict) else {}
    rows = [[label, summary.get(key)] for key, label in SUMMARY_FIELDS]
    return ["## Summary", "", *render_table(["Metric", "Value"], rows), ""]


def render_generated_navigation_tests(report):
    items = object_list(report, "generatedNavigationTests")
    lines = ["## Generated Navigation Tests", ""]
    if not items:
        return lines + ["No candidates.", ""]

    rows = []
    for index, item in enumerate(items, 1):
        rows.append(
            [
                index,
                menu_path_text(item.get("menuPath")),
                item.get("template"),
                item.get("confidence"),
                item.get("suggestedAction"),
            ]
        )
    lines.extend(render_table(["#", "Menu Path", "Template", "Confidence", "Review"], rows))
    lines.extend(["", "### Navigation Evidence Details", ""])

    for index, item in enumerate(items, 1):
        lines.extend([detail_summary(index, menu_path_text(item.get("menuPath"))), ""])
        append_value(lines, "Test ID", item.get("id"))
        append_value(lines, "Title", item.get("title"))
        append_value(lines, "Href", item.get("href"))
        append_value(lines, "Depth 1 index", item.get("depth1Index"))
        append_code_value(lines, "Open trigger selector", item.get("openTriggerCssPath"))
        append_code_value(lines, "Hover target selector", item.get("hoverTargetCssPath"))
        append_list(lines, "Evidence", item.get("evidence"))
        close_detail(lines)
    return lines


def render_page_identity_assertions(report):
    items = object_list(report, "pageIdentityAssertions")
    lines = ["## Page Identity Assertions", ""]
    if not items:
        return lines + ["No candidates.", ""]

    rows = []
    for index, item in enumerate(items, 1):
        rows.append(
            [
                index,
                menu_path_text(item.get("menuPath")),
                item.get("identityType"),
                item.get("confidence"),
                item.get("suggestedAction"),
            ]
        )
    lines.extend(render_table(["#", "Menu Path", "Identity", "Confidence", "Review"], rows))
    lines.extend(["", "### Page Identity Evidence Details", ""])

    for index, item in enumerate(items, 1):
        lines.extend([detail_summary(index, menu_path_text(item.get("menuPath"))), ""])
        append_value(lines, "Identity type", item.get("identityType"))
        append_value(lines, "Text", item.get("text"))
        append_value(lines, "Source menu path", menu_path_text(item.get("sourceMenuPath")))
        append_value(lines, "Reason", item.get("reason"))
        append_code_value(lines, "Selector", item.get("selector"))
        append_list(lines, "Evidence", item.get("evidence"))
        close_detail(lines)
    return lines


def render_candidate_section(report, key, heading, mode):
    items = object_list(report, key)
    lines = [f"## {heading}", ""]
    if not items:
        return lines + ["No candidates.", ""]

    if mode == "excluded":
        headers = ["#", "Text", "Kind", "Region", "Reason", "Confidence"]
        rows = [
            [
                index,
                item.get("text") or "(no text)",
                item.get("candidateKind"),
                item.get("semanticRegion"),
                item.get("reason"),
                item.get("confidence"),
            ]
            for index, item in enumerate(items, 1)
        ]
    elif mode == "safe":
        headers = ["#", "Text", "Interaction", "Role/Type", "Region", "Confidence"]
        rows = [
            [
                index,
                item.get("text") or "(no text)",
                item.get("interactionKind"),
                "/".join(filter(None, [compact_string(item.get("role")), compact_string(item.get("type"))])),
                item.get("semanticRegion"),
                item.get("confidence"),
            ]
            for index, item in enumerate(items, 1)
        ]
    elif mode == "unsafe":
        headers = ["#", "Text", "Action", "Risk", "Reason"]
        rows = [
            [index, item.get("text") or "(no text)", item.get("actionKind"), item.get("riskLevel"), item.get("reason")]
            for index, item in enumerate(items, 1)
        ]
    else:
        headers = ["#", "Text", "Kind", "Region", "Reason", "Confidence"]
        rows = [
            [
                index,
                item.get("text") or "(no text)",
                item.get("candidateKind"),
                item.get("semanticRegion"),
                item.get("reason"),
                item.get("confidence"),
            ]
            for index, item in enumerate(items, 1)
        ]

    lines.extend(render_table(headers, rows))
    lines.extend(["", "### Candidate Details", ""])
    for index, item in enumerate(items, 1):
        lines.extend([detail_summary(index, item.get("text") or "(no text)"), ""])
        append_code_value(lines, "Candidate key", item.get("candidateKey"))
        append_value(lines, "Href", item.get("href"))
        append_value(lines, "Classification", item.get("classification"))
        append_value(lines, "Candidate subtype", item.get("candidateSubtype"))
        append_value(lines, "Navigation role", item.get("navigationRole"))
        append_value(lines, "Interaction kind", item.get("interactionKind"))
        append_value(lines, "Action kind", item.get("actionKind"))
        append_value(lines, "Risk level", item.get("riskLevel"))
        append_value(lines, "Role", item.get("role"))
        append_value(lines, "Type", item.get("type"))
        append_value(lines, "Confidence", item.get("confidence"))
        append_value(lines, "Reason", item.get("reason"))
        append_value(lines, "Page context", item.get("pageContext"))
        append_code_value(lines, "Observed URL", item.get("observedUrl"))
        append_value(lines, "Form association", item.get("formAssociation"))
        append_value(lines, "Surrounding text", item.get("surroundingText"))
        append_mapping(lines, "ARIA attributes", item.get("ariaAttributes"))
        append_code_value(lines, "Selector", item.get("selector"))
        if item.get("interactionKind") == "tab":
            append_tab_restore(lines, item)
        append_list(lines, "Candidate sources", item.get("candidateSources"))
        append_list(lines, "Evidence", item.get("evidence"))
        append_list(lines, "Signals", item.get("signals"))
        append_value(lines, "Suggested action", item.get("suggestedAction"))
        close_detail(lines)
    return lines


def render_report(report):
    lines = [
        "# Analysis Review Report",
        "",
        "This report summarizes generated navigation coverage, Page Identity evidence, excluded candidates, and follow-up review actions.",
        "",
    ]
    lines.extend(render_warnings(report))
    lines.extend(render_recommended_actions(report))
    lines.extend(render_summary(report))
    lines.extend(render_generated_navigation_tests(report))
    lines.extend(render_page_identity_assertions(report))
    lines.extend(render_candidate_section(report, "excludedUtilityControls", "Excluded Utility Controls", "excluded"))
    lines.extend(
        render_candidate_section(
            report,
            "nonPrimaryNavigationCandidates",
            "Non-primary Navigation Candidates",
            "non-primary",
        )
    )
    lines.extend(render_candidate_section(report, "safeInteractionCandidates", "Safe Interaction Candidates", "safe"))
    lines.extend(render_candidate_section(report, "unsafeActionCandidates", "Unsafe Action Candidates", "unsafe"))
    lines.extend(render_candidate_section(report, "unresolvedCandidates", "Unresolved Candidates", "unresolved"))
    return "\n".join(lines).rstrip() + "\n"


def main():
    args = parse_args()
    input_path = resolve_path(args.input)
    output_path = resolve_path(args.output)

    try:
        report = load_report(input_path)
        markdown = render_report(report)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(markdown, encoding="utf-8")
    except (FileNotFoundError, OSError, ValueError) as error:
        print(f"Analysis Review Report render failed: {error}", file=sys.stderr)
        return 1

    summary = report.get("summary") if isinstance(report.get("summary"), dict) else {}
    print("Analysis Review Report Markdown")
    print(f"- input: {display_path(input_path)}")
    print(f"- output: {display_path(output_path)}")
    print(f"- generated tests: {summary.get('generatedTestCount', 0)}")
    print(f"- warnings: {len(string_list(report.get('warnings')))}")
    print("report rendered")
    return 0


if __name__ == "__main__":
    sys.exit(main())
