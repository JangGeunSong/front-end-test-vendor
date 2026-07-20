import argparse
import hashlib
import json
import re
import sys
from pathlib import Path

from interaction_url import is_absolute_http_url, is_same_origin


ROOT_DIR = Path(__file__).resolve().parents[2]
GENERATED_DIR = ROOT_DIR / "tools" / "ai-generator" / "generated"
DEFAULT_SCOUT_RESULT_PATH = GENERATED_DIR / "scout_result.json"
DEFAULT_MENU_MAP_PATH = GENERATED_DIR / "menu_map.json"

ACTION_TAGS = {"button", "input", "select", "textarea", "summary"}
ACTION_ROLES = {"button", "tab", "checkbox", "radio", "combobox", "switch", "menuitem"}
TAB_RESTORE_UNAVAILABLE_REASONS = {
    "missingTabGroupEvidence",
    "missingPreviousSelection",
    "ambiguousPreviousSelection",
    "invalidRestoreTarget",
}
CANDIDATE_KEY_PATTERN = re.compile(
    r"^interaction:(?:selector|fallback):[0-9a-f]{24}$"
)

UNSAFE_KEYWORDS = [
    ("delete", "critical", ["delete", "remove", "삭제"]),
    ("payment", "critical", ["payment", "pay", "purchase", "checkout", "결제", "구매"]),
    ("order", "critical", ["order", "주문"]),
    ("upload", "high", ["upload", "file upload", "업로드"]),
    ("login", "high", ["login", "log in", "sign in", "로그인"]),
    ("signup", "high", ["signup", "sign up", "register account", "회원가입"]),
    ("logout", "high", ["logout", "log out", "로그아웃"]),
    ("approve", "high", ["approve", "approval", "승인"]),
    ("reject", "high", ["reject", "rejection", "반려"]),
    ("send", "high", ["send", "message", "발송", "전송"]),
    ("save", "high", ["save", "저장"]),
    ("submit", "high", ["submit", "제출"]),
    ("create", "high", ["create", "register", "생성", "등록"]),
    ("update", "high", ["update", "edit", "modify", "수정", "편집"]),
]

PERSONAL_INFORMATION_KEYWORDS = [
    "password",
    "email",
    "phone",
    "telephone",
    "address",
    "birth",
    "비밀번호",
    "이메일",
    "전화번호",
    "주소",
    "생년월일",
    "개인정보",
]


def parse_args():
    parser = argparse.ArgumentParser(
        description="Classify existing UI/action candidates as safe, unsafe, or unknown."
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
        "--fixture",
        help="Optional classifier fixture containing scoutResult, menuMap, and expected text lists.",
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
        raise ValueError(f"{label} JSON parse failed: {display_path(path)} ({error})") from error
    if not isinstance(value, dict):
        raise ValueError(f"{label} top-level value must be an object: {display_path(path)}")
    return value


def compact_string(value):
    if value is None:
        return ""
    if isinstance(value, bool):
        return "true" if value else "false"
    return str(value).strip()


def first_string(candidate, *keys):
    for key in keys:
        value = compact_string(candidate.get(key))
        if value:
            return value
    return ""


def truthy_signal(value):
    if isinstance(value, bool):
        return value
    return compact_string(value).lower() not in {"", "false", "0", "none", "null", "no"}


def normalized_space(value):
    return " ".join(compact_string(value).split())


def keyword_match(text, keyword):
    haystack = text.casefold()
    needle = keyword.casefold()
    if all(character.isascii() for character in needle):
        return re.search(r"(?<![a-z0-9])" + re.escape(needle) + r"(?![a-z0-9])", haystack) is not None
    return needle in haystack


def first_keyword_match(text, groups):
    for kind, risk, keywords in groups:
        for keyword in keywords:
            if keyword_match(text, keyword):
                return kind, risk, keyword
    return None


def aria_attributes(candidate):
    fields = {
        "label": ("ariaLabel", "aria-label"),
        "expanded": ("ariaExpanded", "aria-expanded"),
        "pressed": ("ariaPressed", "aria-pressed"),
        "selected": ("ariaSelected", "aria-selected", "selected"),
        "controls": ("ariaControls", "aria-controls"),
        "haspopup": ("ariaHaspopup", "aria-haspopup"),
        "readonly": ("ariaReadonly", "aria-readonly", "readOnly", "readonly"),
    }
    result = {}
    for output_key, input_keys in fields.items():
        value = first_string(candidate, *input_keys)
        if value:
            result[output_key] = value
    return result


def page_context_text(value):
    if isinstance(value, list):
        return " > ".join(compact_string(item) for item in value if compact_string(item))
    return compact_string(value)


def is_action_candidate(candidate, force=False):
    if force:
        return True
    tag_name = compact_string(candidate.get("tagName")).lower()
    role = compact_string(candidate.get("role")).lower()
    hint = candidate.get("testHint")
    hint = hint if isinstance(hint, dict) else {}
    aria = aria_attributes(candidate)
    return (
        tag_name in ACTION_TAGS
        or role in ACTION_ROLES
        or hint.get("isActionCandidate") is True
        or "expanded" in aria
        or "haspopup" in aria
    )


def normalize_tab_restore(candidate, normalized, source, target_url):
    raw_restore = candidate.get("tabRestore")
    raw_reason = compact_string(candidate.get("tabRestoreUnavailableReason"))
    role = normalized["role"]
    selected = normalized["ariaAttributes"].get("selected")

    if role != "tab" or selected != "false":
        if raw_restore is not None or raw_reason:
            raise ValueError(
                f"tab restore evidence is only allowed on an unselected role=tab candidate: {source}"
            )
        return

    if raw_restore is None:
        reason = raw_reason or "missingTabGroupEvidence"
        if reason not in TAB_RESTORE_UNAVAILABLE_REASONS:
            raise ValueError(f"unsupported tab restore readiness reason {reason!r}: {source}")
        normalized["tabRestoreUnavailableReason"] = reason
        return

    if raw_reason:
        raise ValueError(f"tab restore evidence and unavailable reason cannot coexist: {source}")
    if not isinstance(raw_restore, dict):
        raise ValueError(f"tabRestore must be an object: {source}")
    if set(raw_restore) != {"strategy", "tabGroupSelector", "target"}:
        raise ValueError(f"tabRestore must contain exact bounded fields: {source}")
    if raw_restore.get("strategy") != "restorePreviousSelection":
        raise ValueError(f"tabRestore strategy must be restorePreviousSelection: {source}")

    group_selector = compact_string(raw_restore.get("tabGroupSelector"))
    raw_target = raw_restore.get("target")
    if not group_selector or not isinstance(raw_target, dict):
        raise ValueError(f"tabRestore group selector and target are required: {source}")

    restore_url = compact_string(raw_target.get("observedUrl"))
    if not is_absolute_http_url(restore_url):
        raise ValueError(f"tab restore target observedUrl must be absolute HTTP(S): {source}")
    if not is_same_origin(target_url, restore_url):
        raise ValueError(f"tab restore target observedUrl must be same-origin: {source}")

    restore_target = {
        "selector": first_string(raw_target, "cssPath", "selector"),
        "observedUrl": restore_url,
        "pageContext": normalized["pageContext"],
        "role": compact_string(raw_target.get("role")).lower(),
        "tagName": compact_string(raw_target.get("tagName")).lower(),
        "text": first_string(raw_target, "text"),
        "ariaAttributes": {
            "selected": first_string(raw_target, "ariaSelected", "aria-selected", "selected")
        },
    }
    if (
        not restore_target["selector"]
        or restore_target["selector"] == normalized["selector"]
        or restore_target["observedUrl"] != normalized["observedUrl"]
        or restore_target["role"] != "tab"
        or not restore_target["tagName"]
        or restore_target["ariaAttributes"]["selected"] != "true"
    ):
        raise ValueError(f"invalid bounded tab restore target: {source}")

    restore_target["candidateKey"] = candidate_key(restore_target)
    normalized["tabRestore"] = {
        "strategy": "restorePreviousSelection",
        "tabGroupSelector": group_selector,
        "target": {
            "candidateKey": restore_target["candidateKey"],
            "selector": restore_target["selector"],
            "observedUrl": restore_target["observedUrl"],
            "pageContext": restore_target["pageContext"],
            "role": restore_target["role"],
            "tagName": restore_target["tagName"],
            "text": restore_target["text"],
            "ariaAttributes": restore_target["ariaAttributes"],
        },
    }


def normalize_candidate(
    candidate,
    source,
    page_context="",
    form_association="",
    observed_url="",
    target_url="",
):
    aria = aria_attributes(candidate)
    text = first_string(candidate, "text", "ariaLabel", "aria-label", "title", "placeholder", "name")
    selector = first_string(candidate, "cssPath", "selector")
    provenance_url = compact_string(observed_url or candidate.get("observedUrl"))
    if not is_absolute_http_url(provenance_url):
        raise ValueError(f"candidate observedUrl is required and must be an absolute HTTP(S) URL: {source}")
    if not is_same_origin(target_url, provenance_url):
        raise ValueError(f"candidate observedUrl must be same-origin with target URL: {source}")
    normalized = {
        "text": text,
        "selector": selector,
        "role": compact_string(candidate.get("role")).lower(),
        "type": compact_string(candidate.get("type")).lower(),
        "tagName": compact_string(candidate.get("tagName")).lower(),
        "href": compact_string(candidate.get("href")),
        "semanticRegion": compact_string(candidate.get("semanticRegion")) or "unknown",
        "pageContext": page_context_text(page_context or candidate.get("pageContext")),
        "observedUrl": provenance_url,
        "formAssociation": compact_string(form_association or candidate.get("formAssociation")),
        "surroundingText": first_string(candidate, "surroundingText", "parentText"),
        "className": compact_string(candidate.get("className")),
        "ariaAttributes": aria,
        "candidateSources": [source],
        "isVisible": candidate.get("isVisible", True),
    }
    if "fixtureId" in candidate:
        normalized["fixtureId"] = compact_string(candidate.get("fixtureId"))
    normalize_tab_restore(candidate, normalized, source, target_url)
    return normalized


def candidate_identity(candidate):
    selector = normalized_space(candidate.get("selector"))
    context = normalized_space(candidate.get("pageContext"))
    if selector:
        return {
            "kind": "selector",
            "pageContext": context,
            "selector": selector,
        }
    return {
        "kind": "fallback",
        "pageContext": context,
        "role": normalized_space(candidate.get("role")),
        "type": normalized_space(candidate.get("type")),
        "tagName": normalized_space(candidate.get("tagName")),
        "text": normalized_space(candidate.get("text")).casefold(),
    }


def candidate_key(candidate):
    identity = candidate_identity(candidate)
    canonical = json.dumps(identity, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    digest = hashlib.sha256(canonical.encode("utf-8")).hexdigest()[:24]
    return f"interaction:{identity['kind']}:{digest}"


def merge_candidate(existing, incoming):
    if existing.get("observedUrl") != incoming.get("observedUrl"):
        raise ValueError(
            "candidate provenance conflict for canonical identity "
            f"{existing.get('candidateKey', '')}: "
            f"{existing.get('observedUrl')!r} != {incoming.get('observedUrl')!r}"
        )
    existing_restore = existing.get("tabRestore")
    incoming_restore = incoming.get("tabRestore")
    existing_reason = existing.get("tabRestoreUnavailableReason")
    incoming_reason = incoming.get("tabRestoreUnavailableReason")
    if existing_restore is not None and incoming_restore is not None and existing_restore != incoming_restore:
        raise ValueError(
            "candidate tab restore evidence conflict for canonical identity "
            f"{existing.get('candidateKey', '')}"
        )
    if (
        (existing_restore is not None and incoming_reason)
        or (incoming_restore is not None and existing_reason)
        or (existing_reason and incoming_reason and existing_reason != incoming_reason)
    ):
        raise ValueError(
            "candidate tab restore evidence conflict for canonical identity "
            f"{existing.get('candidateKey', '')}"
        )
    if existing_restore is None and incoming_restore is not None:
        existing["tabRestore"] = incoming_restore
        existing.pop("tabRestoreUnavailableReason", None)
    elif not existing_reason and incoming_reason and existing_restore is None:
        existing["tabRestoreUnavailableReason"] = incoming_reason
    for source in incoming.get("candidateSources", []):
        if source not in existing["candidateSources"]:
            existing["candidateSources"].append(source)
    for key in (
        "text",
        "selector",
        "role",
        "type",
        "tagName",
        "href",
        "semanticRegion",
        "pageContext",
        "observedUrl",
        "formAssociation",
        "surroundingText",
        "className",
        "fixtureId",
    ):
        if not compact_string(existing.get(key)) and compact_string(incoming.get(key)):
            existing[key] = incoming[key]
    for key, value in incoming.get("ariaAttributes", {}).items():
        existing["ariaAttributes"].setdefault(key, value)


def collect_candidates(scout_result, menu_map):
    collected = []
    target_url = compact_string(menu_map.get("url") or scout_result.get("url"))
    root_observed_url = compact_string(scout_result.get("url"))
    if not is_absolute_http_url(target_url):
        raise ValueError("interaction candidate target URL must be an absolute HTTP(S) URL")
    if not is_absolute_http_url(root_observed_url):
        raise ValueError("scout_result.url must preserve the observed absolute HTTP(S) URL")

    def add(
        candidate,
        source,
        page_context="",
        form_association="",
        observed_url="",
        force=False,
    ):
        if isinstance(candidate, dict) and is_action_candidate(candidate, force=force):
            collected.append(
                normalize_candidate(
                    candidate,
                    source,
                    page_context,
                    form_association,
                    observed_url or candidate.get("observedUrl"),
                    target_url,
                )
            )

    elements = scout_result.get("elements")
    if isinstance(elements, list):
        for candidate in elements:
            add(candidate, "scout_result.elements", observed_url=root_observed_url)

    for list_name in ("nonPrimaryNavigationCandidates", "ctaCandidates"):
        candidates = menu_map.get(list_name)
        if isinstance(candidates, list):
            for candidate in candidates:
                add(candidate, f"menu_map.{list_name}", observed_url=candidate.get("observedUrl"))

    profiles = menu_map.get("pageProfiles")
    if not isinstance(profiles, list):
        profiles = scout_result.get("pageProfiles") if isinstance(scout_result.get("pageProfiles"), list) else []

    direct_fields = ("tabs", "buttons", "selects", "inputs", "checkboxes", "radios", "textareas")
    nested_form_fields = ("buttons", "submitButtons", "controls", "fields", "inputs", "selects", "textareas")
    for profile in profiles:
        if not isinstance(profile, dict):
            continue
        context = profile.get("menuPath")
        navigation = profile.get("navigation")
        observed_url = navigation.get("url") if isinstance(navigation, dict) else ""
        profile_data = profile.get("pageProfile")
        if not isinstance(profile_data, dict):
            continue
        for field_name in direct_fields:
            values = profile_data.get(field_name)
            if isinstance(values, list):
                for candidate in values:
                    add(
                        candidate,
                        f"menu_map.pageProfiles.{field_name}",
                        context,
                        observed_url=observed_url,
                        force=True,
                    )
        forms = profile_data.get("forms")
        if not isinstance(forms, list):
            continue
        for form_index, form in enumerate(forms):
            if not isinstance(form, dict):
                continue
            association = first_string(form, "cssPath", "selector", "id") or f"form[{form_index}]"
            for field_name in nested_form_fields:
                values = form.get(field_name)
                if isinstance(values, list):
                    for candidate in values:
                        add(
                            candidate,
                            f"menu_map.pageProfiles.forms.{field_name}",
                            context,
                            association,
                            observed_url,
                            force=True,
                        )

    deduplicated = []
    index = {}
    for candidate in collected:
        key = candidate_key(candidate)
        candidate["candidateKey"] = key
        if key in index:
            merge_candidate(deduplicated[index[key]], candidate)
        else:
            index[key] = len(deduplicated)
            deduplicated.append(candidate)
    return deduplicated


def evidence_base(candidate):
    evidence = [f"source:{source}" for source in candidate.get("candidateSources", [])]
    if candidate.get("selector"):
        evidence.append("stable-selector")
    if candidate.get("role"):
        evidence.append(f"role:{candidate['role']}")
    if candidate.get("type"):
        evidence.append(f"type:{candidate['type']}")
    if candidate.get("tagName"):
        evidence.append(f"tag:{candidate['tagName']}")
    for key, value in candidate.get("ariaAttributes", {}).items():
        evidence.append(f"aria-{key}:{value}")
    if candidate.get("formAssociation"):
        evidence.append("form-associated")
    if candidate.get("isVisible") is False:
        evidence.append("not-visible-at-collection")
    return evidence


def search_text(candidate):
    aria = candidate.get("ariaAttributes", {})
    return " ".join(
        part
        for part in (
            candidate.get("text"),
            aria.get("label"),
            candidate.get("surroundingText"),
            candidate.get("className"),
        )
        if compact_string(part)
    )


def public_fields(candidate):
    result = {
        "candidateKey": candidate.get("candidateKey", candidate_key(candidate)),
        "text": candidate.get("text", ""),
        "selector": candidate.get("selector", ""),
        "role": candidate.get("role", ""),
        "type": candidate.get("type", ""),
        "tagName": candidate.get("tagName", ""),
        "href": candidate.get("href", ""),
        "semanticRegion": candidate.get("semanticRegion", "unknown"),
        "pageContext": candidate.get("pageContext", ""),
        "observedUrl": candidate.get("observedUrl", ""),
        "formAssociation": candidate.get("formAssociation", ""),
        "surroundingText": candidate.get("surroundingText", ""),
        "ariaAttributes": candidate.get("ariaAttributes", {}),
        "candidateSource": candidate.get("candidateSources", [""])[0],
        "candidateSources": candidate.get("candidateSources", []),
    }
    if candidate.get("fixtureId"):
        result["fixtureId"] = candidate["fixtureId"]
    if candidate.get("tabRestore") is not None:
        result["tabRestore"] = candidate["tabRestore"]
    if candidate.get("tabRestoreUnavailableReason"):
        result["tabRestoreUnavailableReason"] = candidate["tabRestoreUnavailableReason"]
    return result


def unsafe_classification(candidate):
    candidate_type = candidate.get("type")
    tag_name = candidate.get("tagName")
    combined_text = search_text(candidate)
    evidence = evidence_base(candidate)

    if candidate_type == "submit":
        return {
            "actionKind": "submit",
            "riskLevel": "high",
            "confidence": "high",
            "reason": "The control has type=submit and can trigger form submission.",
            "evidence": evidence + ["unsafe-signal:type-submit"],
        }
    if candidate_type == "file":
        return {
            "actionKind": "upload",
            "riskLevel": "high",
            "confidence": "high",
            "reason": "The input has type=file and can upload local data.",
            "evidence": evidence + ["unsafe-signal:type-file"],
        }
    if tag_name == "input" and any(keyword_match(combined_text, keyword) for keyword in PERSONAL_INFORMATION_KEYWORDS):
        return {
            "actionKind": "personalInformation",
            "riskLevel": "high",
            "confidence": "medium",
            "reason": "The input context indicates personal or authentication information.",
            "evidence": evidence + ["unsafe-signal:personal-information-input"],
        }

    matched = first_keyword_match(combined_text, UNSAFE_KEYWORDS)
    if matched:
        action_kind, risk_level, keyword = matched
        strong_structure = bool(candidate.get("selector")) and (
            candidate.get("role") == "button" or tag_name in {"button", "input"} or bool(candidate.get("formAssociation"))
        )
        return {
            "actionKind": action_kind,
            "riskLevel": risk_level,
            "confidence": "high" if strong_structure else "medium",
            "reason": f"The actionable control matches the unsafe action signal {keyword!r}.",
            "evidence": evidence + [f"unsafe-keyword:{keyword}"],
        }
    return None


def safe_classification(candidate):
    selector = candidate.get("selector")
    role = candidate.get("role")
    tag_name = candidate.get("tagName")
    class_name = candidate.get("className", "").casefold()
    aria = candidate.get("ariaAttributes", {})
    combined_text = search_text(candidate)
    evidence = evidence_base(candidate)
    button_like = role == "button" or tag_name in {"button", "summary"}

    readonly = compact_string(aria.get("readonly")).lower() == "true"
    if selector and candidate.get("isVisible") is not False and tag_name == "select" and readonly:
        return {
            "interactionKind": "readOnlySelect",
            "confidence": "high",
            "reason": "The select is explicitly read-only and has a stable selector.",
            "evidence": evidence + ["safe-state:readonly"],
        }

    if not selector or candidate.get("isVisible") is False or candidate.get("formAssociation"):
        return None
    if role == "tab" and "selected" in aria:
        restore_evidence = []
        if aria.get("selected") == "false":
            if candidate.get("tabRestore") is not None:
                restore_evidence.append("tab-restore:ready")
            else:
                restore_evidence.append(
                    f"tab-restore-unavailable:{candidate.get('tabRestoreUnavailableReason', 'missingTabGroupEvidence')}"
                )
        return {
            "interactionKind": "tab",
            "confidence": "high",
            "reason": "The candidate has role=tab, state evidence, and a stable selector.",
            "evidence": evidence + ["safe-structure:tab"] + restore_evidence,
        }
    if "expanded" in aria and button_like:
        kind = "accordion" if "accordion" in class_name else "expandCollapse"
        return {
            "interactionKind": kind,
            "confidence": "high",
            "reason": "The button exposes aria-expanded state and can be verified reversibly.",
            "evidence": evidence + ["safe-state:aria-expanded"],
        }

    haspopup = compact_string(aria.get("haspopup")).lower()
    if haspopup and button_like:
        if haspopup == "dialog":
            kind = "modalOpen"
        elif haspopup in {"menu", "listbox"}:
            kind = "dropdown"
        else:
            kind = "popover"
        return {
            "interactionKind": kind,
            "confidence": "high" if aria.get("controls") else "medium",
            "reason": "The control exposes aria-haspopup state and a stable selector.",
            "evidence": evidence + [f"safe-state:aria-haspopup={haspopup}"],
        }

    close_match = any(keyword_match(combined_text, keyword) for keyword in ("close", "닫기"))
    open_match = any(keyword_match(combined_text, keyword) for keyword in ("open", "열기"))
    modal_structure = "modal" in class_name or "dialog" in class_name or bool(aria.get("controls"))
    if button_like and modal_structure and (close_match or open_match):
        return {
            "interactionKind": "modalClose" if close_match else "modalOpen",
            "confidence": "medium",
            "reason": "Button semantics, dialog structure, and open/close text agree.",
            "evidence": evidence + ["safe-structure:dialog-control"],
        }

    direction = None
    if any(keyword_match(combined_text, keyword) for keyword in ("previous", "prev", "이전")):
        direction = "carouselPrevious"
    elif any(keyword_match(combined_text, keyword) for keyword in ("next", "다음")):
        direction = "carouselNext"
    if button_like and direction and any(signal in class_name for signal in ("carousel", "slick", "swiper")):
        return {
            "interactionKind": direction,
            "confidence": "medium",
            "reason": "Button semantics and carousel structure identify a reversible navigation control.",
            "evidence": evidence + ["safe-structure:carousel-control"],
        }

    if role == "button" and "dropdown" in class_name:
        return {
            "interactionKind": "dropdown",
            "confidence": "medium",
            "reason": "Role, dropdown class structure, and selector identify a reversible menu control.",
            "evidence": evidence + ["safe-structure:dropdown"],
        }

    return None


def classify_candidate(candidate):
    unsafe = unsafe_classification(candidate)
    if unsafe:
        return {
            **public_fields(candidate),
            "classification": "unsafe",
            **unsafe,
            "suggestedAction": "Do not execute automatically; review as a manual or guarded test case.",
        }

    safe = safe_classification(candidate)
    if safe:
        suggested_action = "Review and approve before adding to a structured interaction plan."
        if (
            safe.get("interactionKind") == "tab"
            and candidate.get("ariaAttributes", {}).get("selected") == "false"
            and candidate.get("tabRestore") is None
        ):
            suggested_action = (
                "Safe candidate, but deterministic previous-selection restore evidence is unavailable; "
                "do not approve for executable tabSelection."
            )
        return {
            **public_fields(candidate),
            "classification": "safe",
            **safe,
            "suggestedAction": suggested_action,
        }

    evidence = evidence_base(candidate)
    if candidate.get("formAssociation"):
        reason = "The candidate is form-associated but has no decisive safe or unsafe action signal."
        confidence = "medium"
    elif candidate.get("isVisible") is False:
        reason = "The candidate was not visible at collection time, so executable behavior is uncertain."
        confidence = "low"
    elif not candidate.get("selector"):
        reason = "The candidate has no stable selector or locator evidence."
        confidence = "low"
    else:
        reason = "Available role, type, state, and context signals are insufficient for safe execution."
        confidence = "low"
    return {
        **public_fields(candidate),
        "classification": "unknown",
        "candidateSubtype": "interaction",
        "candidateKind": "interactionUnknown",
        "reason": reason,
        "confidence": confidence,
        "evidence": evidence or ["insufficient-structured-evidence"],
        "suggestedAction": "Keep out of automatic execution and review the missing behavior context.",
    }


def classify_interaction_candidates(scout_result, menu_map):
    safe = []
    unsafe = []
    unknown = []
    for candidate in collect_candidates(scout_result, menu_map):
        classified = classify_candidate(candidate)
        if classified["classification"] == "safe":
            safe.append(classified)
        elif classified["classification"] == "unsafe":
            unsafe.append(classified)
        else:
            unknown.append(classified)
    return {
        "safeInteractionCandidates": safe,
        "unsafeActionCandidates": unsafe,
        "unknownInteractionCandidates": unknown,
    }


def classified_items(result):
    for result_key in ("safeInteractionCandidates", "unsafeActionCandidates", "unknownInteractionCandidates"):
        yield from result[result_key]


def candidate_key_sequence(result):
    return [item.get("candidateKey") for item in classified_items(result)]


def validate_fixture(result, expected, repeated_result=None):
    errors = []
    mapping = {
        "safeTexts": ("safeInteractionCandidates", "safe"),
        "unsafeTexts": ("unsafeActionCandidates", "unsafe"),
        "unknownTexts": ("unknownInteractionCandidates", "unknown"),
    }
    actual_by_class = {
        classification: {item.get("text") for item in result[result_key]}
        for _, (result_key, classification) in mapping.items()
    }
    for expected_key, (_, classification) in mapping.items():
        for text in expected.get(expected_key, []):
            if text not in actual_by_class[classification]:
                errors.append(f"Expected {classification} candidate was not found: {text!r}")
    for text in expected.get("mustNotBeSafe", []):
        safe_items = result["safeInteractionCandidates"]
        if any(item.get("fixtureId") == text or item.get("text") == text for item in safe_items):
            errors.append(f"Unsafe/unknown candidate was incorrectly classified safe: {text!r}")

    actual_by_fixture_id = {
        item.get("fixtureId"): item
        for item in classified_items(result)
        if item.get("fixtureId")
    }
    for expected_candidate in expected.get("candidates", []):
        fixture_id = expected_candidate.get("fixtureId")
        actual = actual_by_fixture_id.get(fixture_id)
        if actual is None:
            errors.append(f"Expected fixture candidate was not found: {fixture_id!r}")
            continue
        for key in ("classification", "interactionKind", "actionKind", "riskLevel"):
            if key in expected_candidate and actual.get(key) != expected_candidate[key]:
                errors.append(
                    f"Fixture candidate {fixture_id!r} expected {key}={expected_candidate[key]!r}, "
                    f"got {actual.get(key)!r}."
                )
        key_prefix = expected_candidate.get("candidateKeyPrefix")
        if key_prefix and not actual.get("candidateKey", "").startswith(key_prefix):
            errors.append(
                f"Fixture candidate {fixture_id!r} expected candidateKey prefix {key_prefix!r}, "
                f"got {actual.get('candidateKey')!r}."
            )
        expected_key = expected_candidate.get("candidateKey")
        if expected_key and actual.get("candidateKey") != expected_key:
            errors.append(
                f"Fixture candidate {fixture_id!r} expected candidateKey {expected_key!r}, "
                f"got {actual.get('candidateKey')!r}."
            )
        expected_observed_url = expected_candidate.get("observedUrl")
        if expected_observed_url and actual.get("observedUrl") != expected_observed_url:
            errors.append(
                f"Fixture candidate {fixture_id!r} expected observedUrl {expected_observed_url!r}, "
                f"got {actual.get('observedUrl')!r}."
            )
        if "tabRestoreUnavailableReason" in expected_candidate:
            if actual.get("tabRestoreUnavailableReason") != expected_candidate["tabRestoreUnavailableReason"]:
                errors.append(
                    f"Fixture candidate {fixture_id!r} expected tabRestoreUnavailableReason "
                    f"{expected_candidate['tabRestoreUnavailableReason']!r}, "
                    f"got {actual.get('tabRestoreUnavailableReason')!r}."
                )
        if expected_candidate.get("tabRestoreStrategy"):
            restore = actual.get("tabRestore")
            restore_target = restore.get("target") if isinstance(restore, dict) else {}
            if not isinstance(restore, dict):
                errors.append(f"Fixture candidate {fixture_id!r} is missing tabRestore.")
            else:
                if restore.get("strategy") != expected_candidate.get("tabRestoreStrategy"):
                    errors.append(f"Fixture candidate {fixture_id!r} has unexpected restore strategy.")
                if restore.get("tabGroupSelector") != expected_candidate.get("tabRestoreGroupSelector"):
                    errors.append(f"Fixture candidate {fixture_id!r} has unexpected tab group selector.")
                if restore_target.get("selector") != expected_candidate.get("tabRestoreTargetSelector"):
                    errors.append(f"Fixture candidate {fixture_id!r} has unexpected restore target selector.")
                if not CANDIDATE_KEY_PATTERN.fullmatch(restore_target.get("candidateKey", "")):
                    errors.append(f"Fixture candidate {fixture_id!r} has invalid restore target candidateKey.")
        for source in expected_candidate.get("candidateSources", []):
            if source not in actual.get("candidateSources", []):
                errors.append(f"Fixture candidate {fixture_id!r} is missing candidate source {source!r}.")

    keys = candidate_key_sequence(result)
    if any(not key for key in keys):
        errors.append("Every classified candidate must have a candidateKey.")
    if len(keys) != len(set(keys)):
        errors.append("Classified candidateKey values must be unique.")
    if repeated_result is not None and keys != candidate_key_sequence(repeated_result):
        errors.append("candidateKey sequence changed across identical fixture classifications.")

    for result_key in ("safeInteractionCandidates", "unsafeActionCandidates", "unknownInteractionCandidates"):
        for index, item in enumerate(result[result_key]):
            for required_key in ("candidateKey", "reason", "confidence", "evidence", "suggestedAction"):
                if not item.get(required_key):
                    errors.append(f"{result_key}[{index}] is missing {required_key}.")
    return errors


def validate_failure_cases(cases):
    if not isinstance(cases, list):
        return ["failureCases must be an array"]
    errors = []
    for index, case in enumerate(cases):
        if not isinstance(case, dict):
            errors.append(f"failureCases[{index}] must be an object")
            continue
        try:
            classify_interaction_candidates(case.get("scoutResult"), case.get("menuMap"))
        except (TypeError, ValueError) as error:
            expected = case.get("expectedMessage", "")
            if expected not in str(error):
                errors.append(
                    f"{case.get('scenario')}: expected message containing {expected!r}, got {str(error)!r}"
                )
        else:
            errors.append(f"{case.get('scenario')}: expected classification failure")
    return errors


def main():
    args = parse_args()
    try:
        if args.fixture:
            fixture_path = resolve_path(args.fixture)
            fixture = load_json(fixture_path, "interaction fixture")
            scout_result = fixture.get("scoutResult")
            menu_map = fixture.get("menuMap")
            expected = fixture.get("expected")
            if not isinstance(scout_result, dict) or not isinstance(menu_map, dict) or not isinstance(expected, dict):
                raise ValueError("Fixture requires scoutResult, menuMap, and expected objects.")
        else:
            scout_result = load_json(resolve_path(args.scout_result), "scout_result")
            menu_map = load_json(resolve_path(args.menu_map), "menu_map")
            expected = None

        result = classify_interaction_candidates(scout_result, menu_map)
        if expected is not None:
            repeated_result = classify_interaction_candidates(scout_result, menu_map)
            errors = validate_fixture(result, expected, repeated_result)
            errors.extend(validate_failure_cases(fixture.get("failureCases", [])))
            if errors:
                for error in errors:
                    print(f"[E001] {error}", file=sys.stderr)
                return 1
    except (FileNotFoundError, OSError, ValueError) as error:
        print(f"Interaction candidate classification failed: {error}", file=sys.stderr)
        return 1

    print("Interaction Candidate Classification")
    print(f"- safe: {len(result['safeInteractionCandidates'])}")
    print(f"- unsafe: {len(result['unsafeActionCandidates'])}")
    print(f"- unknown: {len(result['unknownInteractionCandidates'])}")
    if args.fixture:
        print("fixture validation passed")
    else:
        print("classification completed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
