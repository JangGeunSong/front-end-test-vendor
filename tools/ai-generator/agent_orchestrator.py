import argparse
import hashlib
import copy
import subprocess
import json
import os
import re
import sys
import time
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
ROOT_DIR = BASE_DIR.parents[1]
SCOUT_PATH = BASE_DIR / "scout.js"
GENERATED_DIR = BASE_DIR / "generated"
# node 에서 바로 실행할 수 있도록 적용
TESTS_GENERATED_DIR = ROOT_DIR / "tests" / "generated"
BUILD_TEST_PLAN_PATH = BASE_DIR / "build_test_plan.py"
VALIDATE_TEST_PLAN_PATH = BASE_DIR / "validate_test_plan.py"
RENDER_TEST_PLAN_PATH = BASE_DIR / "render_test_plan.py"
MENU_MAP_PATH = GENERATED_DIR / "menu_map.json"
TEST_PLAN_GENERATED_PATH = GENERATED_DIR / "test_plan.generated.json"
TEST_PLAN_LLM_RAW_PATH = GENERATED_DIR / "test_plan.llm.raw.txt"
TEST_PLAN_LLM_ORIGINAL_PATH = GENERATED_DIR / "test_plan.llm.original.json"
TEST_PLAN_LLM_PATH = GENERATED_DIR / "test_plan.llm.json"
PLAN_RENDER_OUTPUT_PATH = TESTS_GENERATED_DIR / "generated_from_plan.spec.js"
PAGE_PROFILE_CACHE_PATH = GENERATED_DIR / "page_profile_cache.json"
VALID_NAVIGATION_CHANGES = {"expected", "none", "unknown"}

PRIMARY_MENU_REGIONS = {"header", "nav"}
NON_PRIMARY_REGIONS = {"main", "footer", "unknown"}
EXCLUDED_PRIMARY_TEXTS = {
    "상세보기",
    "더보기",
    "회사소개",
    "이용약관",
    "개인정보처리방침",
    "개인정보 처리방침",
    "privacy policy",
    "terms",
    "terms of use",
    "로그인",
    "login",
    "회원가입",
    "사이트맵",
    "sitemap",
}
CTA_TEXT_KEYWORDS = (
    "상세",
    "더보기",
    "more",
    "detail",
    "learn more",
    "view more",
    "문의",
    "신청",
    "download",
)
MENU_TRIGGER_TEXTS = {
    "menu",
    "메뉴",
    "hamburger",
}
BRAND_HOME_HINTS = (
    "logo",
    "brand",
    "home",
    "quick",
    "shortcut",
    "utility",
    "main-logo",
    "site-logo",
)

# 1. LLM 설정 (API 키는 환경변수나 별도 파일 권장)
def configure_llm():
    from dotenv import load_dotenv
    import google.generativeai as genai

    load_dotenv(ROOT_DIR / ".env")
    genai.configure(api_key=os.environ.get("GEMINI_API_KEY"))


def create_gemini_model():
    import google.generativeai as genai

    return genai.GenerativeModel('gemini-3-flash-preview')


def parse_args():
    parser = argparse.ArgumentParser(
        description="Generate Playwright tests from a target URL."
    )
    parser.add_argument(
        "--url",
        dest="url",
        help="Target URL to scout and generate tests for."
    )
    parser.add_argument(
        "--generation-mode",
        choices=("spec", "plan", "llm-plan"),
        default="spec",
        help="Generation mode. 'spec' keeps direct LLM Playwright spec generation. 'plan' runs deterministic structured plan shadow output. 'llm-plan' asks the LLM for structured test plan JSON and renders it."
    )
    parser.add_argument(
        "--no-profile-cache",
        action="store_true",
        help="Disable pageProfile cache and collect all primary navigation pageProfiles."
    )
    parser.add_argument(
        "--clear-profile-cache",
        action="store_true",
        help="Delete pageProfile cache before collection."
    )

    return parser.parse_args()


def resolve_target_url(args):
    target_url = args.url or os.environ.get("TARGET_URL")

    if target_url:
        return target_url

    print(
        "Target URL is required.\n"
        "Use one of:\n"
        "  npm run ai:generate -- --url https://target.example.com\n"
        "  TARGET_URL=https://target.example.com npm run ai:generate\n"
        "  PowerShell: $env:TARGET_URL=\"https://target.example.com\"; npm run ai:generate"
    )
    raise SystemExit(2)


def parse_scout_output(stdout):
    try:
        return json.loads(stdout)
    except json.JSONDecodeError:
        print("JSON 파싱 실패. 출력물을 확인하세요.")
        return None

def run_scout(url):
    print(f"'{url}' 사이트 구조 분석 중...")

    # 현재 환경 변수 복사 및 UTF-8 설정 주입
    current_env = os.environ.copy()
    
    print(SCOUT_PATH)
    
    # scout.js를 실행하여 DOM 구조 데이터를 JSON으로 수집
    result = subprocess.run(
        ['node', str(SCOUT_PATH), url], 
        capture_output=True, 
        text=True,
        # 핵심 변경: 데이터를 UTF-8로 읽고, 깨지는 글자는 대체 문자로 처리하여 중단 방지
        encoding='utf-8', 
        errors='replace',
        env=current_env,
        check=False
    )
    
    if result.returncode != 0:
        print("Scout 실행 실패:", result.stderr)
        return None
    
    return parse_scout_output(result.stdout)


def run_page_profile_scout(url, primary_menu_tree):
    print("Primary navigation pageProfiles 수집 중...")

    GENERATED_DIR.mkdir(parents=True, exist_ok=True)
    profile_tree_path = GENERATED_DIR / "primary_menu_tree_for_profiles.json"
    with open(profile_tree_path, "w", encoding="utf-8") as f:
        json.dump(primary_menu_tree, f, indent=2, ensure_ascii=False)

    current_env = os.environ.copy()

    result = subprocess.run(
        ['node', str(SCOUT_PATH), url, '--profile-tree', str(profile_tree_path)],
        capture_output=True,
        text=True,
        encoding='utf-8',
        errors='replace',
        env=current_env,
        check=False
    )

    try:
        profile_tree_path.unlink()
    except OSError:
        pass

    if result.returncode != 0:
        print("PageProfile scout 실행 실패:", result.stderr)
        return []

    profile_result = parse_scout_output(result.stdout)
    if not isinstance(profile_result, dict):
        return []

    return profile_result.get("pageProfiles", [])

def analyze_and_generate_code(dom_data):
    print("LLM이 시나리오를 분석하고 코드를 생성하고 있습니다...")
    
    prompt = f"""
    너는 전문 QA 엔지니어이자 Playwright 아키텍트다.

    아래 JSON은 WEB 화면에서 수집한 DOM 후보 목록이다.
    이 데이터만으로 업무 규칙을 완전히 알 수 없으므로,
    데이터 변경이 없는 안전한 테스트 초안만 작성하라.

    [사이트 구조 데이터]
    {json.dumps(dom_data, indent=2, ensure_ascii=False)}

    목표:
    - 페이지 접근 확인
    - 메뉴 hover/click 흐름 확인
    - 조회 화면 진입 확인
    - 상세 화면 접근 후보가 있으면 TODO로 작성
    - 등록/수정/삭제는 실행하지 말고 TODO 주석으로 남긴다.

    필수 규칙:
    1. isHoverTarget이 true인 요소는 click 전에 hover를 수행한다.
    2. 모든 동작은 test.step()으로 묶는다.
    3. locator는 getByRole, getByText, getByLabel, getByPlaceholder 순으로 우선 사용한다.
    4. 각 click 전에는 highlightAndClick 또는 highlightAndHover를 사용한다.
    5. 결과 검증은 URL 변화, heading, table, form, visible text 중 가능한 것을 사용한다.
    6. 출력은 순수 JavaScript 코드만 반환한다.
    """

    # LLM 호출
    generated_code = strip_markdown_code_block(generate_content_with_llm(prompt))
    
    return generated_code

def build_menu_generation_input(menu_map, generate_all=True, max_parent=3, max_children=3, include_expected_coverage=False):
    if generate_all:
        target_menu_tree = menu_map.get("primaryMenuTree", menu_map.get("menuTree", []))
    else:
        target_menu_tree = limit_menu_tree(
            menu_map.get("primaryMenuTree", menu_map.get("menuTree", [])),
            max_parent=max_parent,
            max_children=max_children
        )

    generation_input = {
        "url": menu_map.get("url"),
        "menuTree": target_menu_tree,
        "pageProfiles": build_page_profile_generation_input(
            menu_map.get("pageProfiles", []),
            target_menu_tree
        )
    }

    if include_expected_coverage:
        generation_input["expectedCoverage"] = build_expected_coverage(target_menu_tree)

    return generation_input


def build_expected_coverage(menu_tree):
    menu_paths = []
    parent_count = 0
    child_count = 0

    for parent in menu_tree:
        parent_text = parent.get("text", "")

        if not parent_text:
            continue

        menu_paths.append([parent_text])
        parent_count += 1

        for child in parent.get("children", []):
            child_text = child.get("text", "")

            if not child_text:
                continue

            menu_paths.append([parent_text, child_text])
            child_count += 1

    return {
        "parentCount": parent_count,
        "childCount": child_count,
        "total": parent_count + child_count,
        "menuPaths": menu_paths,
    }


def build_page_profile_generation_input(page_profiles, menu_tree):
    target_paths = collect_menu_paths(menu_tree)
    filtered_profiles = []

    for profile in page_profiles:
        menu_path = profile.get("menuPath", [])

        if target_paths and tuple(menu_path) not in target_paths:
            continue

        filtered_profiles.append(slim_page_profile(profile))

    return filtered_profiles


def collect_menu_paths(menu_tree):
    paths = set()

    for parent in menu_tree:
        parent_text = parent.get("text", "")

        if parent_text:
            paths.add((parent_text,))

        for child in parent.get("children", []):
            child_text = child.get("text", "")

            if parent_text and child_text:
                paths.add((parent_text, child_text))
            elif child_text:
                paths.add((child_text,))

    return paths


def slim_page_profile(profile):
    page_profile = profile.get("pageProfile", {})

    return {
        "menuPath": profile.get("menuPath", []),
        "menu": profile.get("menu", {}),
        "navigation": profile.get("navigation", {}),
        "pageProfile": {
            "headings": simplify_text_candidates(
                page_profile.get("headings", []),
                max_count=5,
                include_fields=("text", "level", "cssPath")
            ),
            "representativeTexts": page_profile.get("representativeTexts", [])[:5],
            "mainContainers": simplify_text_candidates(
                page_profile.get("mainContainers", []),
                max_count=3,
                include_fields=("cssPath", "text", "childElementCount")
            ),
            "tables": simplify_text_candidates(
                page_profile.get("tables", []),
                max_count=3,
                include_fields=("cssPath", "caption", "headers", "rowCount")
            ),
            "forms": simplify_text_candidates(
                page_profile.get("forms", []),
                max_count=3,
                include_fields=("cssPath", "labels", "controls")
            ),
            "tabs": simplify_text_candidates(
                page_profile.get("tabs", []),
                max_count=5,
                include_fields=("text", "cssPath", "selected")
            ),
            "errorIndicators": simplify_text_candidates(
                page_profile.get("errorIndicators", []),
                max_count=5,
                include_fields=("type", "text", "cssPath")
            )
        }
    }


def simplify_text_candidates(items, max_count=5, include_fields=()):
    simplified = []

    for item in items[:max_count]:
        if isinstance(item, dict):
            simplified.append({
                field: item.get(field)
                for field in include_fields
                if item.get(field) not in (None, "", [])
            })
        elif item not in (None, "", []):
            simplified.append(item)

    return simplified


def build_menu_test_prompt(generation_input):
    target_url_literal = json.dumps(generation_input.get("url", ""), ensure_ascii=False)

    return f"""
    너는 전문 QA 엔지니어이자 Playwright 테스트 아키텍트다.

    아래 JSON은 WEB 사이트의 GNB/nav 메뉴 구조와 Level 2 Page Identity 후보 데이터다.
    menuTree는 depth2 메뉴와 depth3 하위 메뉴 관계를 나타낸다.
    각 depth2 메뉴에는 scout.js가 DOM hierarchy로 추론한 depth1Index가 포함될 수 있으며, 이는 실제 hover/open 해야 하는 top-level navigation item index이다.
    navigationGroupIndex는 수집 그룹 식별자일 뿐 openDepth1ByIndex 인자로 사용하지 않는다.
    hoverTargetCssPath/openTriggerCssPath는 사람이 확인할 수 있는 보조 정보이며, 별도 helper가 없는 한 cssPath 기반 open 코드를 임의 생성하지 않는다.
    depth1Index가 null이면 자동 추론에 실패한 것이므로 openDepth1ByIndex(page, null)를 호출하지 말고 TODO 주석으로 hover target 확인 필요성을 남긴다.
    pageProfiles는 scout.js가 각 메뉴 후보를 클릭한 뒤 수집한 페이지 식별 후보이며, 전수 테스트 데이터가 아니라 의도한 페이지 도달 여부를 판단하기 위한 보조 신호다.

    [menuTree + pageProfiles JSON]
    {json.dumps(generation_input, indent=2, ensure_ascii=False)}

    [테스트 목표]
    Playwright 기반 GNB 메뉴 접근 Smoke Test 초안을 작성한다.
    기존 Level 1 GNB hover/click, URL/hash assertion 흐름을 우선 유지하고, Level 2 Page Identity assertion은 안정적인 후보가 있을 때만 보수적으로 추가한다.

    [중요한 실행 규칙]
    1. hidden 상태의 depth2/depth3 메뉴를 직접 hover/click 하지 않는다.
    2. depth2 또는 depth3 메뉴 클릭 전에는 depth1Index가 number일 때만 openDepth1ByIndex(page, depth1Index)를 호출한다. navigationGroupIndex를 대신 사용하지 않는다.
    2-1. depth1Index가 null 또는 undefined이면 openDepth1ByIndex를 호출하지 말고 TODO 주석으로 hover target 확인 필요성을 남긴다.
    3. depth2 메뉴 클릭은 clickVisibleMenuByText(page, menuName)를 사용한다.
    3-1. depth3 child 메뉴 클릭은 반드시 clickVisibleSubMenuByText(page, parentDepth2Name, childName, options)를 사용한다.
    3-2. depth3 child 메뉴에는 같은 text가 여러 depth2 parent 아래에 있을 수 있으므로 clickVisibleMenuByText(page, childName)를 단독으로 사용하지 않는다.
    3-3. child JSON에 id, ngClick, cssPath가 있으면 options에 반드시 포함한다. cssPath가 있으면 절대 생략하지 않는다.
         예: clickVisibleSubMenuByText(page, 'Parent Menu', 'Child Menu', {{ cssPath: 'li#child-menu > a' }})
         예: {{ id: child.id, ngClick: child.ngClick, cssPath: child.cssPath }}
    4. requiresHoverBeforeClick=true인 메뉴는 depth1Index가 number일 때 openDepth1ByIndex 호출 후 클릭한다. depth1Index가 없으면 TODO를 남긴다.
    5. href가 있는 메뉴는 클릭 후 URL 또는 hash 변화를 expect(page).toHaveURL()로 검증한다.
    6. href가 없고 ngClick만 있는 메뉴도 pageProfiles에 해당 menuPath가 있으면 안정적인 heading 또는 mainContainer 정도만 보수적으로 검증한다.
    7. 모든 동작은 test.step()으로 묶는다.
    8. 저장/삭제/등록/수정/승인/발송/업로드 등 데이터 변경 동작은 생성하지 않는다.
    9. 출력은 마크다운 코드 블록 없이 순수 JavaScript 코드만 반환한다.

    [menuTree 커버리지 규칙]
    1. menuTree에 포함된 모든 depth2 메뉴에 대해 반드시 test.step을 생성한다.
    2. 각 depth2.children에 포함된 모든 depth3 메뉴에 대해 반드시 test.step을 생성한다.
    3. Page Identity 후보가 약하거나 불안정해도 메뉴 step 자체를 생략하지 않는다.
    3-1. loop 기반 생성은 허용한다. 단, 각 parent test 내부에서 배열명은 반드시 `children`으로 작성한다.
         예: const children = [ ... ];
    3-2. children 배열의 각 child는 text, href 또는 ngClick, id, cssPath를 menu_map 값 그대로 literal field로 포함한다.
         허용 예: {{ text: 'Child Menu', id: 'child_1', ngClick: "openTab('child')", cssPath: "a#child_1" }}
         금지 예: cssPath: `a#\\\\3${{tab.id.replace('_', ' _')}}`
    3-3. loop는 반드시 `for (const child of children)` 형식을 사용한다.
    3-4. depth3 loop의 test.step 제목은 반드시 `Depth 3: ${{child.text}}` 형식을 포함한다.
    3-5. clickVisibleSubMenuByText options에서는 계산식이 아니라 child.cssPath를 사용한다.
         허용 예: clickVisibleSubMenuByText(page, 'Parent Menu', child.text, {{ id: child.id, ngClick: child.ngClick, cssPath: child.cssPath }})
    4. 각 메뉴 step은 최소한 다음을 수행한다:
       - depth1Index가 number이면 openDepth1ByIndex(page, depth1Index)
       - 해당 depth2 또는 depth3 메뉴 클릭
       - href가 있으면 URL/hash assertion
       - href가 없거나 URL/hash가 동일하면 TODO 주석으로 추가 검증 필요성을 기록
    5. depth3 child step은 parent depth2 단위 test 안에 모두 포함한다.
    6. 불안정한 Level 2 assertion을 제거해야 할 때도 click step과 URL/hash 또는 TODO는 유지한다.

    [Level 2 Page Identity assertion 규칙]
    1. pageProfiles는 menuPath로 menuTree 항목과 연결한다.
    1-1. depth3 child Page Identity assertion은 반드시 해당 child의 menuPath와 완전히 일치하는 pageProfile만 근거로 사용한다. sibling child의 pageProfile selector를 fallback으로 사용하지 않는다.
    1-2. ['Parent', 'Child A'] assertion에는 ['Parent', 'Child A'] pageProfile만 사용하고, ['Parent', 'Child B'] 또는 ['Parent', 'Child C'] selector를 사용하지 않는다.
    1-3. loop 내부에서 child별 Page Identity assertion이 다르면 반드시 if (child.text === '...') 또는 else if 분기 안에서 해당 child pageProfile의 selector만 사용한다.
    1-4. 모든 child pageProfile에서 같은 cssPath가 확인되는 경우에만 loop 내부 공통 Page Identity assertion을 생성한다. 공통인지 불확실하면 공통 fallback assertion을 생성하지 말고 child별 TODO를 남긴다.
    2. assertion 우선순위는 반드시 다음 순서를 따른다:
       URL/hash > heading > mainContainer > representativeTexts.
    3. Level 2 assertion은 테스트 실패를 쉽게 만들 수 있으므로 적게 생성한다. 후보가 불안정하면 assertion을 만들지 말고 TODO 주석으로 남긴다.
    4. pageProfile에 안정적인 heading 후보가 있으면 heading assertion을 추가한다.
    5. heading 후보가 없거나 ngClick 기반 tab 메뉴처럼 URL/hash가 동일하면 공격적인 content assertion 대신 TODO 주석을 남긴다.
    6. mainContainers는 selector가 구체적이고 안정적일 때만 보조 visible assertion을 생성한다. 불안정하면 TODO 주석만 남긴다.
    7. representativeTexts는 heading이 부족할 때만 보조 신호로 제한적으로 사용한다. 대표 텍스트 단독 assertion은 되도록 생성하지 않는다.
    8. 다음 representativeTexts는 assertion으로 사용하지 않는다:
       - 운영 데이터, 목록 데이터, 공지 제목, FAQ 질문, 제품명, 모델명, 제조사 홈, 요금제 숫자
       - 너무 긴 텍스트
       - 대괄호가 포함된 공지 제목
       - FAQ 문장 또는 질문형 문장
       - 숫자/모델명 중심 텍스트
       - 로그인, 메뉴, 고객센터, 검색, 목록, 확인, 취소
    9. buttons는 page identity assertion으로 사용하지 않는다. 상세보기, 확대, 이전, 다음, Previous, Next, 조회, 검색 등 버튼 text assertion을 생성하지 않는다.
    10. tables/forms/tabs는 강한 assertion으로 자동 생성하지 않는다. 안정적인 selector가 명확하고 페이지 식별에 꼭 필요할 때만 제한적으로 사용한다.
    11. page.locator('table'), page.locator('form'), page.locator('[role="tab"]') 같은 일반 selector assertion은 생성하지 않는다.
    12. ngClick 기반 tab 메뉴처럼 URL/hash가 동일한 경우에는 heading 또는 mainContainer 정도만 검증하고, 버튼/목록 콘텐츠/제품명/모델명/공지/FAQ를 강하게 검증하지 않는다.
    13. errorIndicators가 있으면 오류 화면 후보로 보고, broad text regex를 만들지 말고 수집된 type/text를 근거로 TODO 또는 제한적인 negative assertion만 생성한다.
    14. pageProfiles가 없거나 후보가 약하면 기존 Level 1 URL/hash assertion과 TODO 주석을 유지한다.

    [selector 사용 규칙]
    1. heading assertion은 getByRole('heading', {{ name }})를 사용해도 된다.
    2. mainContainer, table, tab, content 영역 assertion 또는 highlight locator는 반드시 pageProfiles에 수집된 cssPath를 그대로 사용한다.
    3. pageProfiles에 없는 selector를 새로 만들거나 축약하지 않는다.
    3-1. `page.locator('selector1, selector2')`처럼 여러 pageProfile selector를 합성하지 않는다. 하나를 고르기 어렵다면 TODO를 남긴다.
    3-2. Page Identity용 page.locator selector는 반드시 pageProfiles에 수집된 cssPath 하나와 완전히 동일해야 한다.
    3-3. 수집된 cssPath에서 뒤쪽 segment를 제거해 상위 parent selector로 축약하지 않는다.
    3-4. 여러 메뉴에 공통으로 쓸 content selector를 임의 생성하지 않는다. 여러 sibling 메뉴가 비슷한 content layout을 공유해 안정적인 content cssPath를 하나 고르기 어렵다면 assertion과 highlight를 만들지 말고 TODO 주석만 남긴다.
    3-5. if contentArea visible else noticeArea 같은 sibling pageProfile selector fallback chain을 생성하지 않는다. 해당 child menuPath에서 수집된 selector가 아니면 사용하지 않는다.
    4. 수집된 cssPath가 `div#developGuide01-01 > div.listContent > div.content:nth-of-type(2)`라면 그대로 사용한다.
       `div#developGuide01-01` 같은 parent selector를 임의 생성하지 않는다.
    5. 수집된 cssPath가 너무 길거나 불안정해 보이면 assertion을 만들지 말고 TODO 주석을 남긴다.
    6. table은 `page.locator('table')` 같은 일반 selector를 사용하지 않는다. 수집된 table cssPath가 있을 때만 사용한다.
    7. heading이 부모 메뉴명만 있어 child 페이지를 식별하지 못하는 경우에는 수집된 mainContainers[1] 또는 content cssPath를 그대로 사용해 visible assertion과 highlightPageIdentity를 생성한다.
    8. buttons, 제품명, 모델명, 공지 제목, FAQ 질문은 selector 또는 text assertion으로 사용하지 않는다.

    [Visual debug highlight 규칙]
    1. Page Identity assertion을 생성한 경우, assertion 대상 locator를 highlightPageIdentity(page, locator, label)로 강조한다.
    2. highlightPageIdentity는 HIGHLIGHT=true일 때만 동작하므로 일반 실행에는 영향이 없다.
    3. 우선 heading locator를 강조한다.
    4. heading이 없거나 heading이 부모 depth2 메뉴명과 동일해서 depth3 ngClick/tab 페이지를 식별하지 못하는 경우에는 mainContainer 또는 안정적인 tab locator를 강조한다.
    5. URL/hash가 동일한 ngClick tab 메뉴에서도 안정적인 heading 또는 mainContainer가 있으면 Page Identity highlight를 생성한다.
    6. mainContainer visible assertion을 생성한 경우에는 같은 locator로 highlightPageIdentity를 반드시 호출한다.
    7. tab locator는 안정적인 selector가 pageProfiles에 있고 제품명/모델명/버튼/목록 콘텐츠가 아닐 때만 사용한다.
    8. label에는 menuPath 전체를 포함한다. 예: 'Parent Menu > Child Menu: content area'
    9. buttons, table, 공지 제목, FAQ 질문, 제품명/모델명, 상세보기 버튼은 assertion 또는 Page Identity highlight 대상으로 사용하지 않는다.
    10. 예:
       const identityHeading = page.getByRole('heading', {{ name: 'Page Title' }});
       await expect(identityHeading).toBeVisible();
       await highlightPageIdentity(page, identityHeading, 'Parent Menu > Child Menu: Page Title');
    11. mainContainer 예:
       const identityArea = page.locator('div#content > div.mainContent').first();
       await expect(identityArea).toBeVisible();
       await highlightPageIdentity(page, identityArea, 'Parent Menu > Child Menu: content area');

    [사용 가능한 helper]
    const {{ openDepth1ByIndex, clickVisibleMenuByText, clickVisibleSubMenuByText }} = require('../../utils/gnb');
    const {{ highlightPageIdentity }} = require('../../utils/highlight');

    [Generated BASE_URL rule]
    - The generated spec is a target-specific test artifact and may include the target URL scanned during this generation.
    - Do not use a fixed service-domain default from tool code.
    - Generate a standalone runnable default URL using the current generation input:
      const BASE_URL = process.env.BASE_URL || {target_url_literal};
    - test.beforeEach should navigate to BASE_URL.
    - Do not generate env-only URL code such as `const BASE_URL = process.env.BASE_URL || process.env.TARGET_URL;`.
    - To test another URL, the user should run ai:generate again for that URL instead of reusing this generated spec.

    [기본 코드 조건]
    - CommonJS 형식으로 작성한다.
    - const {{ test, expect }} = require('@playwright/test'); 를 포함한다.
    - test.beforeEach에서 page.goto(BASE_URL)를 사용한다.
    - await page.waitForSelector('header.header.pc'); 를 포함한다.

    [코드 스타일]
    - 테스트명은 한글로 작성해도 된다.
    - parent depth2 메뉴 단위로 test를 나눈다.
    - 각 child depth3 메뉴는 test.step으로 나눈다.
    """


def build_structured_test_plan_prompt(generation_input):
    return f"""
    You are a QA test planning agent.

    Your task is to create a structured test plan JSON object for a deterministic Playwright renderer.
    Do not write Playwright JavaScript.
    Do not write helper functions, regex code, locator code, loops, imports, or comments outside JSON.

    Return JSON object only.
    Do not wrap the response in markdown.
    Do not use ```json code fences.

    [Input]
    The following JSON contains the target URL, primary navigation menu tree, and Level 2 pageProfile candidates.
    Use only this data.
    expectedCoverage is the authoritative checklist for tests[] coverage.

    {json.dumps(generation_input, indent=2, ensure_ascii=False)}

    [Top-level schema]
    {{
      "version": "1.0",
      "targetUrl": "<target URL from input.url>",
      "source": {{
        "menuMapPath": "tools/ai-generator/generated/menu_map.json",
        "scoutResultPath": "tools/ai-generator/generated/scout_result.json"
      }},
      "tests": []
    }}

    [Supported templates]
    Use only these template values:
    - navigation.urlOnly
    - navigation.headingIdentity
    - navigation.contentIdentity
    - navigation.tabIdentity
    - navigation.todoIdentity

    [Required common test fields]
    Each tests[] item must include:
    - id: stable unique string
    - title: human-readable string
    - template: one supported template
    - menuPath: array of strings
    - depth1Index: number or null
    - click: object
    - assertions: object

    [Click schema]
    For depth2:
    {{
      "type": "depth2",
      "text": "<menu text>",
      "id": "<optional id>",
      "ngClick": "<optional ngClick>",
      "cssPath": "<optional cssPath from menu_map>"
    }}

    For depth3:
    {{
      "type": "depth3",
      "parentText": "<parent depth2 text>",
      "text": "<child text>",
      "id": "<optional id>",
      "ngClick": "<optional ngClick>",
      "cssPath": "<optional cssPath from menu_map>"
    }}

    Preserve id, ngClick, and cssPath literally from menuTree when they exist.
    Never calculate cssPath from id.
    Never omit parentText for depth3.

    [Template rules]
    navigation.urlOnly:
    - Requires assertions.url.href.
    - Use this when URL/hash is the only stable signal.

    navigation.headingIdentity:
    - Requires assertions.url.href.
    - Requires assertions.identity.type = "heading".
    - Requires assertions.identity.text.
    - Requires assertions.identity.exact boolean.
    - Use exact: true by default.
    - Use only when a stable visible heading matches the current menuPath leaf.

    navigation.contentIdentity:
    - Requires assertions.url.href.
    - Requires assertions.identity.type = "content".
    - Requires assertions.identity.selector.
    - Requires assertions.identity.sourceMenuPath.
    - selector must be a cssPath from the pageProfile whose menuPath exactly matches this test menuPath.
    - sourceMenuPath must exactly equal menuPath.
    - Use this when heading does not exactly match the menuPath leaf but the exact matching pageProfile has a reliable mainContainer/content cssPath.
    - Do not downgrade to navigation.todoIdentity merely because exact heading identity is unavailable.
    - If the exact matching pageProfile has a specific content/mainContainer cssPath comparable to the deterministic builder output, prefer navigation.contentIdentity over navigation.todoIdentity.

    navigation.tabIdentity:
    - Requires assertions.identity.type = "tab".
    - navigationChange is required.
    - navigationChange must be exactly one of these string literals:
      - "expected"
      - "none"
      - "unknown"
    - Do not use booleans.
    - Do not use null.
    - Do not use "true", "false", "yes", "no", "same", "changed", "no-change", "none expected", or any other value.
    - If URL/hash changes after click, use "expected".
    - If URL/hash does not change because the menu is tab-like/ngClick, use "none".
    - If uncertain, use "unknown".
    - Requires at least one of assertions.identity.selector, assertions.identity.id, assertions.identity.text.
    - Use this only for real tab-like navigation: click.ngClick exists, href is empty, href is unchanged from the parent route, or URL/hash may not change.
    - Do not use navigation.tabIdentity for a normal href navigation only because the pageProfile contains tab elements.
    - If click.href exists, click.ngClick is empty, and the exact matching pageProfile has a reliable content/mainContainer cssPath, choose navigation.contentIdentity instead of navigation.tabIdentity.
    - For depth2 parent tests, prefer navigation.headingIdentity when the heading exactly matches the parent text, even if tab elements exist on the page.
    - If a URL/hash is available from menuTree href or exact matching pageProfile navigation.hash, include assertions.url.href even when navigationChange is "none".

    navigation.todoIdentity:
    - Requires assertions.url.href when available.
    - Requires todo.reason.
    - Use this only after checking headingIdentity, tabIdentity, and contentIdentity evidence.
    - Exact heading absence alone is not enough reason to choose todoIdentity.
    - Use this only when the exact matching pageProfile has no reliable heading, tab selector/id, or specific content/mainContainer cssPath.

    [Template selection priority]
    For each expectedCoverage menuPath, choose the strongest safe template in this order:
    1. navigation.headingIdentity when a stable visible heading exactly matches the menuPath leaf.
    2. navigation.tabIdentity when the menu itself is tab-like/ngClick/no-url-change and the exact matching pageProfile has a tab selector, tab id, or stable tab text.
    3. navigation.contentIdentity when exact heading is unavailable but the exact matching pageProfile has a reliable content/mainContainer cssPath.
    4. navigation.todoIdentity only when none of the above identity evidence exists.
    For normal href navigation with URL/hash changes, prefer navigation.contentIdentity over navigation.tabIdentity when no exact heading is available.
    If click.href exists, click.ngClick is empty, and reliable content/mainContainer cssPath exists, navigation.contentIdentity is the required choice.
    Do not classify a menu as tabIdentity merely because tabs exist somewhere in its pageProfile.
    Do not choose navigation.todoIdentity only because heading exact match is missing.
    Do not invent selectors to avoid todoIdentity.
    Do not use sibling pageProfile selectors to avoid todoIdentity.
    For contentIdentity, the selector must be one cssPath collected in the exact matching pageProfile and sourceMenuPath must exactly equal menuPath.
    Avoid overly broad selectors, but do not reject a specific content/mainContainer cssPath just because it is not a heading.

    [Coverage rules]
    - Create tests for every depth2 parent in menuTree.
    - Create tests for every depth3 child in each parent.children.
    - expectedCoverage.menuPaths contains every menuPath that must appear in tests[].
    - You must include every expectedCoverage.menuPaths item exactly once in tests[].
    - Do not omit any expectedCoverage.menuPaths item.
    - Do not summarize menu groups.
    - Do not generate only important-looking menus.
    - Do not stop after a subset of menu paths.
    - tests.length must exactly equal expectedCoverage.total.
    - Every tests[].menuPath must exactly match one item in expectedCoverage.menuPaths.
    - Do not create tests[].menuPath values that are not present in expectedCoverage.menuPaths.
    - Do not create duplicate tests for the same menuPath.
    - Do not skip a menu because Page Identity evidence is weak.
    - Use navigation.todoIdentity when uncertain.
    - If stable identity evidence is missing for a menuPath, still create a test for that menuPath using navigation.todoIdentity.
    - Do not invent selectors just to satisfy coverage.
    - Coverage is mandatory even when pageProfiles are weak, missing, or ambiguous.

    [Coverage self-check]
    Before producing the final JSON, internally verify all of the following:
    - tests.length === expectedCoverage.total
    - Every expectedCoverage.menuPaths item has exactly one matching tests[].menuPath.
    - Every tests[].menuPath is present in expectedCoverage.menuPaths.
    - There are no duplicate tests[].menuPath values.
    Do not print this self-check. The final response must still be JSON only.

    [URL/hash rules]
    - assertions.url.href should use menuTree href when available.
    - If menuTree href is empty, use the exact matching pageProfile navigation.hash when available.
    - Include assertions.url.href for navigation.tabIdentity whenever a href or hash is available; do not omit href only because navigationChange is "none".
    - Do not invent routes.

    [Selector and identity rules]
    - Selectors may only come from the exact matching menuPath pageProfile.
    - Sibling pageProfile selector fallback is forbidden.
    - Do not shorten, merge, synthesize, or generalize cssPath selectors.
    - Do not use selector lists such as "selector1, selector2".
    - Do not use button text, product/model names, notice titles, FAQ questions, list data, or operational data as strong identity assertions.
    - If exact heading evidence is missing, check exact pageProfile tab and content/mainContainer cssPath evidence before using navigation.todoIdentity.
    - If heading/mainContainer/tab evidence is ambiguous or missing, use navigation.todoIdentity.

    [Safety rules]
    - This plan is for Level 1 Navigation Smoke and Level 2 Page Identity only.
    - Do not create save, delete, register, update, approve, send, upload, submit, or any data-changing action.
    - Do not create Level 3 input or form interaction plans.

    [Output]
    Return a single valid JSON object matching the schema.
    """


def generate_content_with_llm(prompt):
    model = create_gemini_model()
    response = model.generate_content(prompt)
    return response.text


def strip_markdown_code_block(text):
    return text.replace("```javascript", "").replace("```", "").strip()


def strip_json_code_block(text):
    cleaned = str(text or "").strip()
    match = re.fullmatch(r"```(?:json)?\s*(.*?)\s*```", cleaned, flags=re.DOTALL | re.IGNORECASE)

    if match:
        return match.group(1).strip()

    return cleaned


def parse_llm_test_plan(raw_text):
    cleaned = strip_json_code_block(raw_text)

    try:
        return json.loads(cleaned)
    except json.JSONDecodeError as error:
        print(f"LLM structured plan JSON parse failed. Raw response: {TEST_PLAN_LLM_RAW_PATH}")
        raise RuntimeError(f"LLM structured plan JSON parse failed: {error}") from error


def infer_navigation_change(test_case):
    click = test_case.get("click") if isinstance(test_case, dict) else {}
    assertions = test_case.get("assertions") if isinstance(test_case, dict) else {}
    url_assertion = assertions.get("url") if isinstance(assertions, dict) else {}

    if isinstance(click, dict) and click.get("ngClick"):
        return "none"

    if isinstance(url_assertion, dict) and url_assertion.get("href"):
        return "expected"

    return "unknown"


def normalize_llm_test_plan(plan):
    normalized = copy.deepcopy(plan)

    if not isinstance(normalized, dict):
        return normalized

    tests = normalized.get("tests", [])
    if not isinstance(tests, list):
        return normalized

    for index, test_case in enumerate(tests):
        if not isinstance(test_case, dict):
            continue

        if test_case.get("template") != "navigation.tabIdentity":
            continue

        current_value = test_case.get("navigationChange")
        if current_value in VALID_NAVIGATION_CHANGES:
            continue

        repaired_value = infer_navigation_change(test_case)
        print(
            f"Repaired navigationChange for $.tests[{index}]: "
            f"{json.dumps(current_value, ensure_ascii=False)} -> {json.dumps(repaired_value)}"
        )
        test_case["navigationChange"] = repaired_value

    return normalized


def analyze_and_generate_menu_test(menu_map, generate_all=True, max_parent=3, max_children=3):
    print("LLM이 menuTree 기반 GNB 메뉴 접근 테스트를 생성하고 있습니다...")

    generation_input = build_menu_generation_input(
        menu_map,
        generate_all=generate_all,
        max_parent=max_parent,
        max_children=max_children
    )
    prompt = build_menu_test_prompt(generation_input)
    generated_code = strip_markdown_code_block(generate_content_with_llm(prompt))

    return generated_code


def generate_structured_test_plan_with_llm(menu_map):
    print("LLM이 structured test plan JSON을 생성하고 있습니다...")

    generation_input = build_menu_generation_input(
        menu_map,
        generate_all=True,
        include_expected_coverage=True,
    )
    prompt = build_structured_test_plan_prompt(generation_input)

    try:
        raw_response = generate_content_with_llm(prompt)
    except Exception as error:
        raise RuntimeError(f"LLM structured test plan generation failed: {error}") from error

    save_text(raw_response, TEST_PLAN_LLM_RAW_PATH)

    parsed_plan = parse_llm_test_plan(raw_response)
    save_json_to_path(parsed_plan, TEST_PLAN_LLM_ORIGINAL_PATH)

    normalized_plan = normalize_llm_test_plan(parsed_plan)
    save_json_to_path(normalized_plan, TEST_PLAN_LLM_PATH)

    return normalized_plan


def limit_menu_tree(menu_tree, max_parent=3, max_children=3):
    limited = []

    for parent in menu_tree[:max_parent]:
        copied = {
            **parent,
            "children": parent.get("children", [])[:max_children]
        }
        limited.append(copied)

    return limited

def ensure_playwright_header(code):
    if "require('@playwright/test')" not in code:
        header = "const { test, expect } = require('@playwright/test');\n\n"
        return header + code
    return code


def save_test_spec(code, file_name="generated_test.spec.js"):
    GENERATED_DIR.mkdir(parents=True, exist_ok=True)

    file_path = GENERATED_DIR / file_name
    with open(file_path, 'w', encoding='utf-8') as f:
        f.write(ensure_playwright_header(code))

    print(f"테스트 파일 생성 완료: {file_path}")


def save_generated_test_spec(code, file_name="generated_menu_access.spec.js"):
    TESTS_GENERATED_DIR.mkdir(parents=True, exist_ok=True)

    file_path = TESTS_GENERATED_DIR / file_name
    with open(file_path, "w", encoding="utf-8") as f:
        f.write(ensure_playwright_header(code))

    print(f"실행용 테스트 파일 생성 완료: {file_path}")


def save_json(data, file_name="scout_result.json"):
    GENERATED_DIR.mkdir(parents=True, exist_ok=True)
    
    file_path = GENERATED_DIR / file_name
    with open(file_path, "w", encoding='utf-8') as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
        
    print(f"JSON 저장 완료: {file_path}")


def save_json_to_path(data, file_path):
    file_path.parent.mkdir(parents=True, exist_ok=True)
    with open(file_path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
        f.write("\n")

    print(f"JSON 저장 완료: {file_path}")


def save_text(text, file_path):
    file_path.parent.mkdir(parents=True, exist_ok=True)
    file_path.write_text(str(text or ""), encoding="utf-8")
    print(f"Raw response 저장 완료: {file_path}")

# 의미있는 페이지 이동 버튼들만 선택하여 처리할 수 있는 형태의 MAP으로 재 구성
def extract_menu_candidate(dom_data):
    if isinstance(dom_data, dict):
        elements = dom_data.get("elements", [])
    else:
        elements = dom_data

    menus = []
    
    for item in elements:
        if not item.get("isGnbCandidate"):
            continue
        
        if not item.get("testHint", {}).get("isNavigationCandidate"):
            continue
        
        menus.append({
            "index": item.get("index"),
            "tagName": item.get("tagName", ""),
            "text": item.get("text", ""),
            "href": item.get("href", ""),
            "id": item.get("id", ""),
            "className": item.get("className", ""),
            "title": item.get("title", ""),
            "role": item.get("role", ""),
            "ngClick": item.get("ngClick", ""),
            "menuDepth": item.get("menuDepth"),
            "inferredMenuDepth": item.get("inferredMenuDepth"),
            "depth1Index": item.get("depth1Index"),
            "hoverTargetCssPath": item.get("hoverTargetCssPath", ""),
            "openTriggerCssPath": item.get("openTriggerCssPath", ""),
            "navigationGroupIndex": item.get("navigationGroupIndex"),
            "semanticRegion": item.get("semanticRegion", "unknown"),
            "confidence": item.get("confidence", "unknown"),
            "discoveryReason": item.get("discoveryReason", []),
            "isVisible": item.get("isVisible"),
            "requiresHoverBeforeClick": item.get("isGnbCandidate") and not item.get("isVisible"),
            "parentText": item.get("parentText", ""),
            "cssPath": item.get("cssPath", ""),
            "locatorCandidates": item.get("locatorCandidates", [])
        })
        
    return menus


def normalize_text(value):
    return " ".join(str(value or "").split()).strip()


def lower_text(value):
    return normalize_text(value).lower()


def is_text_too_long_for_primary(text):
    normalized = normalize_text(text)
    return len(normalized) > 40 or len(normalized.split()) > 8


def has_keyword(value, keywords):
    normalized = lower_text(value)
    return any(keyword in normalized for keyword in keywords)


def same_navigation_group(left, right):
    left_group = left.get("navigationGroupIndex")
    right_group = right.get("navigationGroupIndex")

    if left_group is not None and right_group is not None:
        return left_group == right_group

    left_depth1 = left.get("depth1Index")
    right_depth1 = right.get("depth1Index")

    if left_depth1 is not None and right_depth1 is not None:
        return left_depth1 == right_depth1

    return False


def is_footer_or_policy_text(text):
    normalized = lower_text(text)
    return normalized in EXCLUDED_PRIMARY_TEXTS or has_keyword(
        normalized,
        (
            "개인정보",
            "privacy",
            "이용약관",
            "terms",
            "copyright",
            "고객센터",
        )
    )


def is_likely_brand_home_candidate(menu):
    combined = " ".join([
        str(menu.get("id", "")),
        str(menu.get("className", "")),
        str(menu.get("title", "")),
        str(menu.get("cssPath", "")),
        str(menu.get("href", "")),
    ])

    if has_keyword(combined, BRAND_HOME_HINTS):
        return True

    href = lower_text(menu.get("href", ""))
    return href in {"/", "/#", "index.html", "./"}


def is_navigation_trigger(menu):
    tag_name = lower_text(menu.get("tagName", ""))
    role = lower_text(menu.get("role", ""))
    text = lower_text(menu.get("text", ""))

    return (
        menu.get("semanticRegion") in PRIMARY_MENU_REGIONS and
        not menu.get("href") and
        (tag_name == "button" or role == "button") and
        (text in MENU_TRIGGER_TEXTS or has_keyword(menu.get("className", ""), ("menu", "hamburger", "trigger", "toggle")))
    )


def has_group_child_text(menu, candidates):
    parent_text = normalize_text(menu.get("parentText", ""))
    own_text = normalize_text(menu.get("text", ""))

    if not parent_text or parent_text == own_text:
        return False

    for candidate in candidates:
        child_text = normalize_text(candidate.get("text", ""))
        if (
            child_text and
            child_text != own_text and
            same_navigation_group(menu, candidate) and
            child_text in parent_text
        ):
            return True

    return False


def classify_candidate_kind(menu, all_candidates):
    if is_navigation_trigger(menu):
        return "navigationTrigger"

    if is_likely_brand_home_candidate(menu):
        return "logoHome"

    if is_footer_link(menu):
        return "footerLink"

    if is_content_cta(menu):
        return "contentCta"

    if menu.get("semanticRegion") == "main" and menu.get("href"):
        return "quickLink"

    if menu.get("semanticRegion") not in PRIMARY_MENU_REGIONS:
        return "unknown"

    if is_footer_or_policy_text(menu.get("text", "")):
        return "utilityLink"

    if is_text_too_long_for_primary(menu.get("text", "")):
        return "unknown"

    if has_group_child_text(menu, all_candidates):
        return "primaryNavigation"

    if menu.get("menuDepth") in (2, 3) and (
        menu.get("depth1Index") is not None or menu.get("navigationGroupIndex") is not None
    ):
        return "primaryNavigationItem"

    return "unknown"


def is_primary_navigation_candidate(menu):
    if menu.get("candidateKind") not in ("primaryNavigation", "primaryNavigationItem"):
        return False

    if menu.get("semanticRegion") not in PRIMARY_MENU_REGIONS:
        return False

    if menu.get("menuDepth") not in (2, 3):
        return False

    if menu.get("depth1Index") is None and menu.get("navigationGroupIndex") is None:
        return False

    text = menu.get("text", "")
    if not normalize_text(text):
        return False

    if is_text_too_long_for_primary(text):
        return False

    if is_footer_or_policy_text(text):
        return False

    if is_likely_brand_home_candidate(menu):
        return False

    return True


def is_footer_link(menu):
    return menu.get("semanticRegion") == "footer"


def is_content_cta(menu):
    if menu.get("semanticRegion") != "main":
        return False

    role = lower_text(menu.get("role", ""))
    tag_name = lower_text(menu.get("tagName", ""))
    text = lower_text(menu.get("text", ""))

    return (
        role == "button" or
        tag_name == "button" or
        has_keyword(text, CTA_TEXT_KEYWORDS)
    )


def is_link_candidate(menu):
    return (
        menu.get("semanticRegion") in NON_PRIMARY_REGIONS and
        bool(menu.get("href"))
    )


def project_menu_candidates(menu_candidates):
    primary_menus = []
    link_candidates = []
    cta_candidates = []
    footer_links = []
    non_primary = []

    for menu in menu_candidates:
        candidate_kind = classify_candidate_kind(menu, menu_candidates)
        menu["candidateKind"] = candidate_kind
        menu["navigationRole"] = candidate_kind

        if is_primary_navigation_candidate(menu):
            primary_menus.append(menu)
            continue

        excluded = {
            **menu,
            "excludeReason": get_non_primary_reason(menu)
        }
        non_primary.append(excluded)

        if is_footer_link(menu):
            footer_links.append(excluded)

        if is_content_cta(menu):
            cta_candidates.append(excluded)

        if is_link_candidate(menu):
            link_candidates.append(excluded)

    return {
        "primaryMenus": primary_menus,
        "linkCandidates": link_candidates,
        "ctaCandidates": cta_candidates,
        "footerLinks": footer_links,
        "nonPrimaryNavigationCandidates": non_primary,
        "unresolvedPrimaryNavigationCandidates": [],
    }


def get_non_primary_reason(menu):
    candidate_kind = menu.get("candidateKind")
    if candidate_kind and candidate_kind not in ("primaryNavigation", "primaryNavigationItem"):
        return f"candidate-kind:{candidate_kind}"
    if menu.get("semanticRegion") not in PRIMARY_MENU_REGIONS:
        return f"non-primary-region:{menu.get('semanticRegion', 'unknown')}"
    if menu.get("menuDepth") not in (2, 3):
        return "missing-or-unsupported-menu-depth"
    if menu.get("depth1Index") is None and menu.get("navigationGroupIndex") is None:
        return "missing-navigation-group"
    if is_text_too_long_for_primary(menu.get("text", "")):
        return "long-or-description-like-text"
    if is_footer_or_policy_text(menu.get("text", "")):
        return "footer-or-policy-like-text"
    if is_likely_brand_home_candidate(menu):
        return "brand-or-home-like-link"
    return "not-primary-navigation"


def build_primary_menu_tree(primary_menus):
    parents = [
        menu for menu in primary_menus
        if menu.get("candidateKind") == "primaryNavigation"
    ]
    children = [
        menu for menu in primary_menus
        if menu.get("candidateKind") == "primaryNavigationItem"
    ]

    parents = sorted(parents, key=lambda item: item.get("index") if item.get("index") is not None else 10**9)
    children = sorted(children, key=lambda item: item.get("index") if item.get("index") is not None else 10**9)

    tree = []
    assigned_child_indexes = set()

    for parent_index, parent in enumerate(parents):
        next_parent = find_next_parent_in_group(parent, parents[parent_index + 1:])
        parent_node = {
            **parent,
            "menuDepth": 2,
            "depth1Index": parent.get("depth1Index"),
            "children": []
        }

        for child in children:
            child_index = child.get("index")

            if child_index in assigned_child_indexes:
                continue

            if not belongs_to_parent_group(child, parent):
                continue

            if not is_child_after_parent(child, parent):
                continue

            if next_parent is not None and not is_child_before_next_parent(child, next_parent):
                continue

            if normalize_text(child.get("text", "")) == normalize_text(parent.get("text", "")):
                continue

            child_depth1_index = child.get("depth1Index")
            if child_depth1_index is None:
                child_depth1_index = parent.get("depth1Index")

            parent_node["children"].append({
                **child,
                "menuDepth": 3,
                "depth1Index": child_depth1_index
            })
            assigned_child_indexes.add(child_index)

        if parent_node["children"]:
            tree.append(parent_node)

    unresolved_children = [
        child for child in children
        if child.get("index") not in assigned_child_indexes
    ]

    return tree, unresolved_children


def find_next_parent_in_group(parent, following_parents):
    for candidate in following_parents:
        if belongs_to_parent_group(candidate, parent) and is_child_after_parent(candidate, parent):
            return candidate

    return None


def is_child_after_parent(child, parent):
    child_index = child.get("index")
    parent_index = parent.get("index")

    if child_index is None or parent_index is None:
        return True

    return child_index > parent_index


def is_child_before_next_parent(child, next_parent):
    child_index = child.get("index")
    next_parent_index = next_parent.get("index")

    if child_index is None or next_parent_index is None:
        return True

    return child_index < next_parent_index

# AI가 테스트 케이스를 더 잘 만들 수 있도록 같은 depth 에 묶인 매뉴들은 parents를 체크해서 tree 구조로 생성하도록 작성
def build_menu_tree(menu_candidates):
    tree = []
    current_depth2 = None

    for menu in menu_candidates:
        depth = menu.get("menuDepth")

        if depth == 2:
            current_depth2 = {
                **menu,
                "depth1Index": menu.get("depth1Index"),
                "children": []
            }
            tree.append(current_depth2)

        elif depth == 3:
            if current_depth2 is not None and belongs_to_parent_group(menu, current_depth2):
                child_depth1_index = menu.get("depth1Index")
                if child_depth1_index is None:
                    child_depth1_index = current_depth2.get("depth1Index")

                current_depth2["children"].append({
                    **menu,
                    "depth1Index": child_depth1_index
                })
            else:
                tree.append({
                    **menu,
                    "depth1Index": None,
                    "children": []
                })

        else:
            tree.append({
                **menu,
                "depth1Index": None,
                "children": []
            })

    return tree


def belongs_to_parent_group(child, parent):
    child_group = child.get("navigationGroupIndex")
    parent_group = parent.get("navigationGroupIndex")

    if child_group is not None and parent_group is not None:
        return child_group == parent_group

    child_depth1 = child.get("depth1Index")
    parent_depth1 = parent.get("depth1Index")

    if child_depth1 is not None and parent_depth1 is not None:
        return child_depth1 == parent_depth1

    return False

def extract_page_profiles(dom_data):
    if isinstance(dom_data, dict):
        return dom_data.get("pageProfiles", [])

    return []


def build_menu_map(target_url, menu_candidates, primary_menu_tree, projections, page_profiles=None):
    return {
        "url": target_url,
        "count": len(menu_candidates),
        "menus": menu_candidates,
        "menuTree": primary_menu_tree,
        "primaryMenuTree": primary_menu_tree,
        "primaryMenus": projections.get("primaryMenus", []),
        "linkCandidates": projections.get("linkCandidates", []),
        "ctaCandidates": projections.get("ctaCandidates", []),
        "footerLinks": projections.get("footerLinks", []),
        "nonPrimaryNavigationCandidates": projections.get("nonPrimaryNavigationCandidates", []),
        "excludedNavigationCandidates": projections.get("nonPrimaryNavigationCandidates", []),
        "unresolvedPrimaryNavigationCandidates": projections.get("unresolvedPrimaryNavigationCandidates", []),
        "pageProfiles": page_profiles or []
    }


def print_generation_summary(dom_map, menu_map):
    element_count = len(dom_map) if isinstance(dom_map, list) else dom_map.get('count', 0)
    print(f"수집 요소 수: {element_count}")
    print(f"메뉴 후보 수: {len(menu_map.get('menus', []))}")
    print(f"Primary navigation parent 수: {len(menu_map.get('primaryMenuTree', []))}")
    print(f"Primary navigation child 수: {count_tree_children(menu_map.get('primaryMenuTree', []))}")
    print(f"Footer link 후보 수: {len(menu_map.get('footerLinks', []))}")
    print(f"CTA 후보 수: {len(menu_map.get('ctaCandidates', []))}")
    print(f"Non-primary navigation 후보 수: {len(menu_map.get('nonPrimaryNavigationCandidates', []))}")
    print(f"Unresolved primary navigation 후보 수: {len(menu_map.get('unresolvedPrimaryNavigationCandidates', []))}")


def count_tree_children(menu_tree):
    return sum(len(item.get("children", [])) for item in menu_tree)


def make_page_profile_cache_key(target_url, menu_path, menu):
    key_data = {
        "targetUrl": target_url,
        "menuPath": menu_path,
        "href": menu.get("href", ""),
        "ngClick": menu.get("ngClick", ""),
        "cssPath": menu.get("cssPath", ""),
    }
    serialized = json.dumps(key_data, ensure_ascii=False, sort_keys=True)

    return hashlib.sha1(serialized.encode("utf-8")).hexdigest(), key_data


def collect_page_profile_targets(primary_menu_tree, target_url):
    targets = []

    for parent in primary_menu_tree:
        parent_text = parent.get("text", "")
        if not parent_text:
            continue

        parent_path = [parent_text]
        parent_cache_key, parent_key_data = make_page_profile_cache_key(target_url, parent_path, parent)
        targets.append({
            "menuPath": parent_path,
            "menu": parent,
            "parentText": None,
            "cacheKey": parent_cache_key,
            "keyData": parent_key_data,
        })

        for child in parent.get("children", []):
            child_text = child.get("text", "")
            if not child_text:
                continue

            child_path = [parent_text, child_text]
            child_cache_key, child_key_data = make_page_profile_cache_key(target_url, child_path, child)
            targets.append({
                "menuPath": child_path,
                "menu": child,
                "parentText": parent_text,
                "cacheKey": child_cache_key,
                "keyData": child_key_data,
            })

    return targets


def load_page_profile_cache(clear_cache=False):
    if clear_cache and PAGE_PROFILE_CACHE_PATH.exists():
        PAGE_PROFILE_CACHE_PATH.unlink()
        print(f"pageProfile cache cleared: {PAGE_PROFILE_CACHE_PATH}")

    if not PAGE_PROFILE_CACHE_PATH.exists():
        return {"version": 1, "entries": {}}

    try:
        with open(PAGE_PROFILE_CACHE_PATH, "r", encoding="utf-8") as f:
            cache = json.load(f)
    except (OSError, json.JSONDecodeError) as error:
        print(f"Warning: pageProfile cache load failed, using empty cache: {error}")
        return {"version": 1, "entries": {}}

    if not isinstance(cache, dict) or not isinstance(cache.get("entries"), dict):
        print("Warning: pageProfile cache shape is invalid, using empty cache.")
        return {"version": 1, "entries": {}}

    return cache


def save_page_profile_cache(cache):
    cache["version"] = 1
    cache["updatedAt"] = time.strftime("%Y-%m-%dT%H:%M:%S%z")
    save_json_to_path(cache, PAGE_PROFILE_CACHE_PATH)


def profile_cache_entry_matches(entry, target):
    if not isinstance(entry, dict):
        return False

    if entry.get("keyData") != target.get("keyData"):
        return False

    profile = entry.get("profile")
    return isinstance(profile, dict) and bool(profile.get("pageProfile"))


def build_profile_collection_tree(primary_menu_tree, missed_targets):
    missed_paths = {tuple(target.get("menuPath", [])) for target in missed_targets}
    collection_tree = []

    for parent in primary_menu_tree:
        parent_text = parent.get("text", "")
        if not parent_text:
            continue

        parent_path = (parent_text,)
        missed_children = [
            child
            for child in parent.get("children", [])
            if (parent_text, child.get("text", "")) in missed_paths
        ]

        if parent_path in missed_paths or missed_children:
            collection_tree.append({
                **parent,
                "children": missed_children,
            })

    return collection_tree


def collect_page_profiles_with_cache(target_url, primary_menu_tree, use_cache=True, clear_cache=False):
    started_at = time.perf_counter()
    targets = collect_page_profile_targets(primary_menu_tree, target_url)

    if not use_cache and clear_cache and PAGE_PROFILE_CACHE_PATH.exists():
        PAGE_PROFILE_CACHE_PATH.unlink()
        print(f"pageProfile cache cleared: {PAGE_PROFILE_CACHE_PATH}")

    cache = load_page_profile_cache(clear_cache=clear_cache) if use_cache else {"version": 1, "entries": {}}
    entries = cache.setdefault("entries", {})
    profile_by_cache_key = {}
    missed_targets = []

    for target in targets:
        entry = entries.get(target["cacheKey"])

        if use_cache and profile_cache_entry_matches(entry, target):
            profile_by_cache_key[target["cacheKey"]] = entry["profile"]
        else:
            missed_targets.append(target)

    collection_tree = build_profile_collection_tree(primary_menu_tree, missed_targets)
    collected_profiles = []

    if missed_targets:
        collected_profiles = run_page_profile_scout(target_url, collection_tree)

    collected_by_path = {
        tuple(profile.get("menuPath", [])): profile
        for profile in collected_profiles
        if isinstance(profile, dict)
    }

    collected_count = 0
    for target in missed_targets:
        profile = collected_by_path.get(tuple(target["menuPath"]))

        if not profile:
            continue

        profile_by_cache_key[target["cacheKey"]] = profile
        collected_count += 1

        if use_cache:
            entries[target["cacheKey"]] = {
                "keyData": target["keyData"],
                "profile": profile,
                "updatedAt": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
            }

    page_profiles = [
        profile_by_cache_key[target["cacheKey"]]
        for target in targets
        if target["cacheKey"] in profile_by_cache_key
    ]

    elapsed_seconds = time.perf_counter() - started_at
    print(f"pageProfile targets: {len(targets)}")
    print(f"cache hits: {len(targets) - len(missed_targets)}")
    print(f"cache misses: {len(missed_targets)}")
    print(f"collected: {collected_count}")
    print(f"elapsed seconds: {elapsed_seconds:.1f}")

    if use_cache:
        save_page_profile_cache(cache)

    return page_profiles


def build_and_save_menu_map(target_url, use_profile_cache=True, clear_profile_cache=False):
    print("running scout")
    dom_map = run_scout(target_url)
    print(dom_map)
    if not dom_map:
        raise RuntimeError("scout failed")

    menu_candidates = extract_menu_candidate(dom_map)
    projections = project_menu_candidates(menu_candidates)
    primary_menu_tree, unresolved_primary = build_primary_menu_tree(projections.get("primaryMenus", []))
    projections["unresolvedPrimaryNavigationCandidates"] = unresolved_primary
    page_profiles = collect_page_profiles_with_cache(
        target_url,
        primary_menu_tree,
        use_cache=use_profile_cache,
        clear_cache=clear_profile_cache,
    )
    dom_map["pageProfiles"] = page_profiles

    menu_map = build_menu_map(
        target_url,
        menu_candidates,
        primary_menu_tree,
        projections,
        page_profiles
    )

    save_json(dom_map, "scout_result.json")
    save_json(menu_map, "menu_map.json")
    print_generation_summary(dom_map, menu_map)

    return menu_map


def run_generation_pipeline(target_url, use_profile_cache=True, clear_profile_cache=False):
    configure_llm()
    menu_map = build_and_save_menu_map(
        target_url,
        use_profile_cache=use_profile_cache,
        clear_profile_cache=clear_profile_cache,
    )

    # code = analyze_and_generate_code(dom_map)
    # code = analyze_and_generate_menu_test(menu_map)

    # 디버깅 용으로 최소한만 만들어야 할때
    # code = analyze_and_generate_menu_test(menu_map, generate_all=False, max_parent=1, max_children=2)
    # 전체 테스트케이스 생성을 수행할 때
    code = analyze_and_generate_menu_test(menu_map, generate_all=True)
    save_generated_test_spec(code, "generated_menu_access.spec.js")


def run_subprocess_stage(stage_name, command):
    print(stage_name)
    result = subprocess.run(command, cwd=ROOT_DIR, check=False)

    if result.returncode != 0:
        raise RuntimeError(f"{stage_name} failed")


def run_plan_generation_pipeline(target_url, use_profile_cache=True, clear_profile_cache=False):
    build_and_save_menu_map(
        target_url,
        use_profile_cache=use_profile_cache,
        clear_profile_cache=clear_profile_cache,
    )

    run_subprocess_stage(
        "building structured test plan",
        [
            sys.executable,
            str(BUILD_TEST_PLAN_PATH),
            "--input",
            str(MENU_MAP_PATH),
            "--output",
            str(TEST_PLAN_GENERATED_PATH),
        ]
    )
    run_subprocess_stage(
        "validating structured test plan",
        [
            sys.executable,
            str(VALIDATE_TEST_PLAN_PATH),
            "--input",
            str(TEST_PLAN_GENERATED_PATH),
        ]
    )
    run_subprocess_stage(
        "rendering Playwright spec from test plan",
        [
            sys.executable,
            str(RENDER_TEST_PLAN_PATH),
            "--input",
            str(TEST_PLAN_GENERATED_PATH),
            "--output",
            str(PLAN_RENDER_OUTPUT_PATH),
        ]
    )
    print(f"rendered output: {PLAN_RENDER_OUTPUT_PATH}")


def run_llm_plan_generation_pipeline(target_url, use_profile_cache=True, clear_profile_cache=False):
    configure_llm()
    menu_map = build_and_save_menu_map(
        target_url,
        use_profile_cache=use_profile_cache,
        clear_profile_cache=clear_profile_cache,
    )

    print("generating structured test plan with LLM")
    generate_structured_test_plan_with_llm(menu_map)
    print(f"raw response: {TEST_PLAN_LLM_RAW_PATH}")
    print(f"parsed plan: {TEST_PLAN_LLM_PATH}")

    run_subprocess_stage(
        "validating LLM structured test plan",
        [
            sys.executable,
            str(VALIDATE_TEST_PLAN_PATH),
            "--input",
            str(TEST_PLAN_LLM_PATH),
            "--menu-map",
            str(MENU_MAP_PATH),
        ]
    )
    run_subprocess_stage(
        "rendering Playwright spec from LLM test plan",
        [
            sys.executable,
            str(RENDER_TEST_PLAN_PATH),
            "--input",
            str(TEST_PLAN_LLM_PATH),
            "--output",
            str(PLAN_RENDER_OUTPUT_PATH),
        ]
    )
    print(f"rendered output: {PLAN_RENDER_OUTPUT_PATH}")


if __name__ == "__main__":
    args = parse_args()
    target_url = resolve_target_url(args)
    use_profile_cache = not args.no_profile_cache
    print(f"generation mode: {args.generation_mode}")
    print(f"pageProfile cache: {'enabled' if use_profile_cache else 'disabled'}")

    try:
        if args.generation_mode == "llm-plan":
            run_llm_plan_generation_pipeline(
                target_url,
                use_profile_cache=use_profile_cache,
                clear_profile_cache=args.clear_profile_cache,
            )
        elif args.generation_mode == "plan":
            run_plan_generation_pipeline(
                target_url,
                use_profile_cache=use_profile_cache,
                clear_profile_cache=args.clear_profile_cache,
            )
        else:
            run_generation_pipeline(
                target_url,
                use_profile_cache=use_profile_cache,
                clear_profile_cache=args.clear_profile_cache,
            )
    except RuntimeError as error:
        print(f"ERROR: {error}")
        raise SystemExit(1) from error
