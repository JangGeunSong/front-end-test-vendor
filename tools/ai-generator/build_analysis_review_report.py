import argparse
import json
import sys
from pathlib import Path


ROOT_DIR = Path(__file__).resolve().parents[2]
GENERATED_DIR = ROOT_DIR / "tools" / "ai-generator" / "generated"
DEFAULT_SCOUT_RESULT_PATH = GENERATED_DIR / "scout_result.json"
DEFAULT_MENU_MAP_PATH = GENERATED_DIR / "menu_map.json"
DEFAULT_TEST_PLAN_PATH = GENERATED_DIR / "test_plan.llm.json"
DEFAULT_OUTPUT_PATH = GENERATED_DIR / "analysis_review_report.json"

UTILITY_CANDIDATE_KINDS = {
    "footerLink",
    "logoHome",
    "navigationTrigger",
    "utilityLink",
}


def parse_args():
    parser = argparse.ArgumentParser(
        description="Build an Analysis Review Report JSON from existing generated artifacts."
    )
    parser.add_argument(
        "--scout-result",
        default=str(DEFAULT_SCOUT_RESULT_PATH),
        help="Path to scout_result.json.",
    )
    parser.add_argument(
        "--menu-map",
        default=str(DEFAULT_MENU_MAP_PATH),
        help="Path to menu_map.json.",
    )
    parser.add_argument(
        "--test-plan",
        default=str(DEFAULT_TEST_PLAN_PATH),
        help="Path to structured test plan JSON.",
    )
    parser.add_argument(
        "--output",
        default=str(DEFAULT_OUTPUT_PATH),
        help="Path to write analysis_review_report.json.",
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


def load_json(path, label):
    if not path.exists():
        raise FileNotFoundError(f"{label} file not found: {display_path(path)}")

    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as error:
        raise ValueError(
            f"{label} JSON parse failed: {display_path(path)} ({error})"
        ) from error

    if not isinstance(value, dict):
        raise ValueError(f"{label} top-level value must be an object: {display_path(path)}")
    return value


def compact_string(value):
    return value.strip() if isinstance(value, str) else ""


def object_list(value, warnings, path):
    if value is None:
        warnings.append(f"{path} is missing; using an empty list.")
        return []
    if not isinstance(value, list):
        warnings.append(f"{path} is not an array; using an empty list.")
        return []

    result = []
    for index, item in enumerate(value):
        if isinstance(item, dict):
            result.append(item)
        else:
            warnings.append(f"{path}[{index}] is not an object and was skipped.")
    return result


def menu_path(value):
    if not isinstance(value, list):
        return []
    return [item for item in value if isinstance(item, str) and item]


def menu_path_key(value):
    path = menu_path(value)
    return tuple(path) if path else None


def flatten_primary_tree(primary_tree):
    items = []
    for parent in primary_tree:
        parent_text = compact_string(parent.get("text"))
        if not parent_text:
            continue
        items.append(([parent_text], parent))
        children = parent.get("children")
        if not isinstance(children, list):
            continue
        for child in children:
            if not isinstance(child, dict):
                continue
            child_text = compact_string(child.get("text"))
            if child_text:
                items.append(([parent_text, child_text], child))
    return items


def build_menu_index(primary_items):
    return {tuple(path): item for path, item in primary_items}


def build_profile_index(profiles):
    result = {}
    for profile in profiles:
        key = menu_path_key(profile.get("menuPath"))
        if key is not None:
            result[key] = profile
    return result


def identity_payload(test_case):
    assertions = test_case.get("assertions")
    assertions = assertions if isinstance(assertions, dict) else {}
    identity = assertions.get("identity")
    identity = identity if isinstance(identity, dict) else {}
    todo = test_case.get("todo")
    todo = todo if isinstance(todo, dict) else {}
    return assertions, identity, todo


def generated_navigation_tests(plan_tests, menu_index, profile_index):
    output = []
    for test_case in plan_tests:
        path = menu_path(test_case.get("menuPath"))
        key = tuple(path)
        menu = menu_index.get(key, {})
        profile = profile_index.get(key)
        assertions, identity, todo = identity_payload(test_case)
        url_assertion = assertions.get("url")
        url_assertion = url_assertion if isinstance(url_assertion, dict) else {}
        discovery_reason = menu.get("discoveryReason")
        evidence = list(discovery_reason) if isinstance(discovery_reason, list) else []
        if profile is not None:
            evidence.append("exact-menuPath-pageProfile")
        if identity:
            evidence.append(f"identity:{compact_string(identity.get('type')) or 'unknown'}")
        elif todo:
            evidence.append("identity:todo")

        output.append(
            {
                "id": compact_string(test_case.get("id")),
                "title": compact_string(test_case.get("title")),
                "menuPath": path,
                "template": compact_string(test_case.get("template")),
                "href": compact_string(url_assertion.get("href"))
                or compact_string(menu.get("href")),
                "depth1Index": test_case.get("depth1Index"),
                "openTriggerCssPath": compact_string(menu.get("openTriggerCssPath")),
                "hoverTargetCssPath": compact_string(menu.get("hoverTargetCssPath")),
                "confidence": compact_string(menu.get("confidence")) or "unknown",
                "evidence": evidence,
                "suggestedAction": (
                    "Review and strengthen the page identity evidence."
                    if todo
                    else "Confirm navigation and identity evidence in visual debug."
                ),
            }
        )
    return output


def page_identity_assertions(plan_tests, profile_index):
    output = []
    for test_case in plan_tests:
        path = menu_path(test_case.get("menuPath"))
        key = tuple(path)
        profile = profile_index.get(key, {})
        profile_data = profile.get("pageProfile")
        profile_data = profile_data if isinstance(profile_data, dict) else {}
        _, identity, todo = identity_payload(test_case)
        identity_type = compact_string(identity.get("type"))
        source_path = menu_path(identity.get("sourceMenuPath"))
        has_exact_profile = key in profile_index

        if identity_type:
            reason = f"The structured plan selected {identity_type} identity evidence."
            suggested_action = "Confirm this identity signal is stable and page-specific."
        elif todo:
            identity_type = "todo"
            reason = compact_string(todo.get("reason")) or "No stable identity evidence was selected."
            suggested_action = "Review the exact pageProfile and approve a stable identity signal."
        else:
            identity_type = "none"
            reason = "The test plan does not contain a page identity assertion."
            suggested_action = "Review whether URL-only coverage is sufficient."

        evidence = []
        if has_exact_profile:
            evidence.append("exact-menuPath-pageProfile")
        if identity_type == "heading" and profile_data.get("headings"):
            evidence.append("pageProfile.headings")
        if identity_type == "content" and profile_data.get("mainContainers"):
            evidence.append("pageProfile.mainContainers")
        if identity_type == "tab" and profile_data.get("tabs"):
            evidence.append("pageProfile.tabs")

        output.append(
            {
                "menuPath": path,
                "identityType": identity_type,
                "text": compact_string(identity.get("text")),
                "selector": compact_string(identity.get("selector")),
                "sourceMenuPath": source_path,
                "confidence": "high" if has_exact_profile and identity_type not in {"none", "todo"} else "unknown",
                "reason": reason,
                "evidence": evidence,
                "suggestedAction": suggested_action,
            }
        )
    return output


def candidate_evidence(candidate):
    reasons = candidate.get("discoveryReason")
    evidence = list(reasons) if isinstance(reasons, list) else []
    css_path = compact_string(candidate.get("cssPath"))
    if css_path:
        evidence.append(f"cssPath:{css_path}")
    return evidence


def excluded_utility_controls(non_primary):
    output = []
    for candidate in non_primary:
        kind = compact_string(candidate.get("candidateKind"))
        role = compact_string(candidate.get("navigationRole"))
        if kind not in UTILITY_CANDIDATE_KINDS and role not in UTILITY_CANDIDATE_KINDS:
            continue
        output.append(
            {
                "text": compact_string(candidate.get("text")),
                "candidateKind": kind or "unknown",
                "navigationRole": role or "unknown",
                "semanticRegion": compact_string(candidate.get("semanticRegion")) or "unknown",
                "reason": compact_string(candidate.get("excludeReason")) or "excluded-from-primary-navigation",
                "confidence": compact_string(candidate.get("confidence")) or "unknown",
                "signals": candidate_evidence(candidate),
                "suggestedAction": "Confirm this control should remain outside primary navigation coverage.",
            }
        )
    return output


def non_primary_candidates(non_primary):
    output = []
    for candidate in non_primary:
        kind = compact_string(candidate.get("candidateKind"))
        role = compact_string(candidate.get("navigationRole"))
        if kind in UTILITY_CANDIDATE_KINDS or role in UTILITY_CANDIDATE_KINDS:
            continue
        output.append(
            {
                "text": compact_string(candidate.get("text")),
                "href": compact_string(candidate.get("href")),
                "candidateKind": kind or "unknown",
                "semanticRegion": compact_string(candidate.get("semanticRegion")) or "unknown",
                "reason": compact_string(candidate.get("excludeReason")) or "not-selected-as-primary-navigation",
                "confidence": compact_string(candidate.get("confidence")) or "unknown",
                "evidence": candidate_evidence(candidate),
                "suggestedAction": "Review for future link checks or interaction candidate classification.",
            }
        )
    return output


def unresolved_candidates(unresolved):
    output = []
    for candidate in unresolved:
        output.append(
            {
                "text": compact_string(candidate.get("text")),
                "candidateKind": compact_string(candidate.get("candidateKind")) or "unknown",
                "semanticRegion": compact_string(candidate.get("semanticRegion")) or "unknown",
                "reason": compact_string(candidate.get("excludeReason"))
                or compact_string(candidate.get("reason"))
                or "classification-or-hierarchy-unresolved",
                "confidence": compact_string(candidate.get("confidence")) or "unknown",
                "evidence": candidate_evidence(candidate),
                "suggestedAction": "Review classification evidence and refine the general projection rule if needed.",
            }
        )
    return output


def recommended_actions(identity_assertions, excluded, non_primary, unresolved):
    actions = [
        {
            "action": "Run visual debug for generated navigation tests.",
            "reason": "Navigation and Page Identity evidence still require human confirmation before promotion.",
            "relatedCount": len(identity_assertions),
        }
    ]

    weak_identities = [item for item in identity_assertions if item["identityType"] in {"none", "todo"}]
    if weak_identities:
        actions.append(
            {
                "action": "Review weak Page Identity evidence.",
                "reason": "Some generated tests have no stable identity assertion or remain TODO.",
                "relatedCount": len(weak_identities),
            }
        )
    if excluded:
        actions.append(
            {
                "action": "Review excluded utility controls.",
                "reason": "Confirm excluded controls are not primary navigation targets.",
                "relatedCount": len(excluded),
            }
        )
    if non_primary:
        actions.append(
            {
                "action": "Classify non-primary candidates for future coverage.",
                "reason": "These candidates may support link checks or safe interaction planning.",
                "relatedCount": len(non_primary),
            }
        )
    if unresolved:
        actions.append(
            {
                "action": "Resolve ambiguous navigation candidates.",
                "reason": "The current projection could not classify or attach these candidates safely.",
                "relatedCount": len(unresolved),
            }
        )
    actions.append(
        {
            "action": "Add safe and unsafe interaction classification before Level 3 execution.",
            "reason": "Current artifacts do not provide a reviewed interaction safety classification.",
            "relatedCount": 0,
        }
    )
    return actions


def build_report(scout_result, menu_map, test_plan, warnings, source_paths=None):
    plan_tests = object_list(test_plan.get("tests"), warnings, "test_plan.tests")
    primary_tree_value = menu_map.get("primaryMenuTree")
    if primary_tree_value is None and isinstance(menu_map.get("menuTree"), list):
        warnings.append("menu_map.primaryMenuTree is missing; using menu_map.menuTree.")
        primary_tree_value = menu_map.get("menuTree")
    primary_tree = object_list(primary_tree_value, warnings, "menu_map.primaryMenuTree")
    primary_items = flatten_primary_tree(primary_tree)
    menu_index = build_menu_index(primary_items)

    profile_value = menu_map.get("pageProfiles")
    if profile_value is None and isinstance(scout_result.get("pageProfiles"), list):
        warnings.append("menu_map.pageProfiles is missing; using scout_result.pageProfiles.")
        profile_value = scout_result.get("pageProfiles")
    profiles = object_list(profile_value, warnings, "menu_map.pageProfiles")
    profile_index = build_profile_index(profiles)

    for index, test_case in enumerate(plan_tests):
        key = menu_path_key(test_case.get("menuPath"))
        if key is None:
            warnings.append(f"test_plan.tests[{index}].menuPath is missing or invalid.")
            continue
        if key not in menu_index:
            warnings.append(
                f"test_plan.tests[{index}].menuPath is not present in primaryMenuTree: {list(key)!r}."
            )
        if key not in profile_index:
            warnings.append(
                f"test_plan.tests[{index}].menuPath has no exact pageProfile: {list(key)!r}."
            )

    non_primary = object_list(
        menu_map.get("nonPrimaryNavigationCandidates"),
        warnings,
        "menu_map.nonPrimaryNavigationCandidates",
    )
    unresolved = object_list(
        menu_map.get("unresolvedPrimaryNavigationCandidates"),
        warnings,
        "menu_map.unresolvedPrimaryNavigationCandidates",
    )

    generated_tests = generated_navigation_tests(plan_tests, menu_index, profile_index)
    identities = page_identity_assertions(plan_tests, profile_index)
    excluded = excluded_utility_controls(non_primary)
    other_non_primary = non_primary_candidates(non_primary)
    unresolved_output = unresolved_candidates(unresolved)
    actions = recommended_actions(identities, excluded, other_non_primary, unresolved_output)

    warnings.append(
        "Safe/unsafe interaction classification is not available in current artifacts; both sections are empty."
    )
    target_url = (
        compact_string(test_plan.get("targetUrl"))
        or compact_string(menu_map.get("url"))
        or compact_string(scout_result.get("url"))
    )
    if not target_url:
        warnings.append("targetUrl is missing from all input artifacts.")

    sources = source_paths or {
        "scoutResultPath": "tools/ai-generator/generated/scout_result.json",
        "menuMapPath": "tools/ai-generator/generated/menu_map.json",
        "testPlanPath": "tools/ai-generator/generated/test_plan.llm.json",
    }

    return {
        "version": "1.0",
        "sources": sources,
        "summary": {
            "targetUrl": target_url,
            "generatedTestCount": len(plan_tests),
            "primaryNavigationCount": len(primary_items),
            "pageProfileCount": len(profiles),
            "excludedCandidateCount": len(non_primary),
            "safeInteractionCandidateCount": 0,
            "unsafeActionCandidateCount": 0,
            "unresolvedCandidateCount": len(unresolved_output),
            "recommendedActionCount": len(actions),
        },
        "generatedNavigationTests": generated_tests,
        "pageIdentityAssertions": identities,
        "excludedUtilityControls": excluded,
        "nonPrimaryNavigationCandidates": other_non_primary,
        "safeInteractionCandidates": [],
        "unsafeActionCandidates": [],
        "unresolvedCandidates": unresolved_output,
        "recommendedNextActions": actions,
        "warnings": warnings,
    }


def write_report(path, report):
    path.parent.mkdir(parents=True, exist_ok=True)
    content = json.dumps(report, ensure_ascii=False, indent=2) + "\n"
    path.write_text(content, encoding="utf-8")


def main():
    args = parse_args()
    scout_path = resolve_path(args.scout_result)
    menu_map_path = resolve_path(args.menu_map)
    test_plan_path = resolve_path(args.test_plan)
    output_path = resolve_path(args.output)

    try:
        scout_result = load_json(scout_path, "scout_result")
        menu_map = load_json(menu_map_path, "menu_map")
        test_plan = load_json(test_plan_path, "test_plan")
        warnings = []
        report = build_report(
            scout_result,
            menu_map,
            test_plan,
            warnings,
            source_paths={
                "scoutResultPath": display_path(scout_path),
                "menuMapPath": display_path(menu_map_path),
                "testPlanPath": display_path(test_plan_path),
            },
        )
        write_report(output_path, report)
    except (FileNotFoundError, OSError, ValueError) as error:
        print(f"Analysis Review Report build failed: {error}", file=sys.stderr)
        return 1

    print("Analysis Review Report")
    print(f"- output: {display_path(output_path)}")
    print(f"- generated tests: {report['summary']['generatedTestCount']}")
    print(f"- primary navigation: {report['summary']['primaryNavigationCount']}")
    print(f"- page profiles: {report['summary']['pageProfileCount']}")
    print(f"- warnings: {len(warnings)}")
    for warning in warnings:
        print(f"[W001] {warning}")
    print("report generated")
    return 0


if __name__ == "__main__":
    sys.exit(main())
