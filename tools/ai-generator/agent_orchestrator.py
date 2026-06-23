import subprocess
import json
import os
from pathlib import Path
from dotenv import load_dotenv
import google.generativeai as genai  # pip install google-generativeai

BASE_DIR = Path(__file__).resolve().parent
ROOT_DIR = BASE_DIR.parents[1]
SCOUT_PATH = BASE_DIR / "scout.js"
GENERATED_DIR = BASE_DIR / "generated"
# node 에서 바로 실행할 수 있도록 적용
TESTS_GENERATED_DIR = ROOT_DIR / "tests" / "generated"

# Depth 1 짜리 네비게이션 바 메뉴 목록
DEPTH1_INDEX_MAP = {
    "KT IoT 소개": 0,
    "사업 분야": 0,
    "요금제": 0,

    "모듈/모뎀": 1,
    "단말": 1,

    "개발 지원": 2,
    "검증 지원": 2,
    "KT IoT 사업협력센터": 2,

    "공유": 3,
}

# 1. LLM 설정 (API 키는 환경변수나 별도 파일 권장)
def configure_llm():
    load_dotenv(ROOT_DIR / ".env")
    genai.configure(api_key=os.environ.get("GEMINI_API_KEY"))


def create_gemini_model():
    return genai.GenerativeModel('gemini-3-flash-preview')


def parse_scout_output(stdout):
    try:
        return json.loads(stdout)
    except json.JSONDecodeError:
        print("❌ JSON 파싱 실패. 출력물을 확인하세요.")
        return None

def run_scout(url):
    print(f"🔍 '{url}' 사이트 구조 분석 중...")

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
        print("❌ Scout 실행 실패:", result.stderr)
        return None
    
    return parse_scout_output(result.stdout)

def analyze_and_generate_code(dom_data):
    print("🤖 LLM이 시나리오를 분석하고 코드를 생성하고 있습니다...")
    
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

def build_menu_generation_input(menu_map, generate_all=True, max_parent=3, max_children=3):
    if generate_all:
        target_menu_tree = menu_map.get("menuTree", [])
    else:
        target_menu_tree = limit_menu_tree(
            menu_map.get("menuTree", []),
            max_parent=max_parent,
            max_children=max_children
        )

    return {
        "url": menu_map.get("url"),
        "menuTree": target_menu_tree,
        "pageProfiles": build_page_profile_generation_input(
            menu_map.get("pageProfiles", []),
            target_menu_tree
        )
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
    return f"""
    너는 전문 QA 엔지니어이자 Playwright 테스트 아키텍트다.

    아래 JSON은 WEB 사이트의 GNB/nav 메뉴 구조와 Level 2 Page Identity 후보 데이터다.
    menuTree는 depth2 메뉴와 depth3 하위 메뉴 관계를 나타낸다.
    각 depth2 메뉴에는 depth1Index가 포함되어 있으며, 이는 실제 화면에서 먼저 hover해야 하는 visible depth1 메뉴의 index이다.
    pageProfiles는 scout.js가 각 메뉴 후보를 클릭한 뒤 수집한 페이지 식별 후보이며, 전수 테스트 데이터가 아니라 의도한 페이지 도달 여부를 판단하기 위한 보조 신호다.

    [menuTree + pageProfiles JSON]
    {json.dumps(generation_input, indent=2, ensure_ascii=False)}

    [테스트 목표]
    Playwright 기반 GNB 메뉴 접근 Smoke Test 초안을 작성한다.
    기존 Level 1 GNB hover/click, URL/hash assertion 흐름을 우선 유지하고, Level 2 Page Identity assertion은 안정적인 후보가 있을 때만 보수적으로 추가한다.

    [중요한 실행 규칙]
    1. hidden 상태의 depth2/depth3 메뉴를 직접 hover/click 하지 않는다.
    2. depth2 또는 depth3 메뉴 클릭 전에는 반드시 openDepth1ByIndex(page, depth1Index)를 호출한다.
    3. depth2 메뉴 클릭은 clickVisibleMenuByText(page, menuName)를 사용한다.
    3-1. depth3 child 메뉴 클릭은 반드시 clickVisibleSubMenuByText(page, parentDepth2Name, childName, options)를 사용한다.
    3-2. depth3 child 메뉴에는 같은 text가 여러 depth2 parent 아래에 있을 수 있으므로 clickVisibleMenuByText(page, childName)를 단독으로 사용하지 않는다.
    3-3. child JSON에 id, ngClick, cssPath가 있으면 options에 포함한다. 예: {{ id: child.id, ngClick: child.ngClick, cssPath: child.cssPath }}
    4. requiresHoverBeforeClick=true인 메뉴는 반드시 openDepth1ByIndex 호출 후 클릭한다.
    5. href가 있는 메뉴는 클릭 후 URL 또는 hash 변화를 expect(page).toHaveURL()로 검증한다.
    6. href가 없고 ngClick만 있는 메뉴도 pageProfiles에 해당 menuPath가 있으면 안정적인 heading 또는 mainContainer 정도만 보수적으로 검증한다.
    7. 모든 동작은 test.step()으로 묶는다.
    8. 저장/삭제/등록/수정/승인/발송/업로드 등 데이터 변경 동작은 생성하지 않는다.
    9. 출력은 마크다운 코드 블록 없이 순수 JavaScript 코드만 반환한다.

    [menuTree 커버리지 규칙]
    1. menuTree에 포함된 모든 depth2 메뉴에 대해 반드시 test.step을 생성한다.
    2. 각 depth2.children에 포함된 모든 depth3 메뉴에 대해 반드시 test.step을 생성한다.
    3. Page Identity 후보가 약하거나 불안정해도 메뉴 step 자체를 생략하지 않는다.
    4. 각 메뉴 step은 최소한 다음을 수행한다:
       - openDepth1ByIndex(page, depth1Index)
       - 해당 depth2 또는 depth3 메뉴 클릭
       - href가 있으면 URL/hash assertion
       - href가 없거나 URL/hash가 동일하면 TODO 주석으로 추가 검증 필요성을 기록
    5. depth3 child step은 parent depth2 단위 test 안에 모두 포함한다.
    6. 불안정한 Level 2 assertion을 제거해야 할 때도 click step과 URL/hash 또는 TODO는 유지한다.

    [Level 2 Page Identity assertion 규칙]
    1. pageProfiles는 menuPath로 menuTree 항목과 연결한다.
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

    [사용 가능한 helper]
    const {{ openDepth1ByIndex, clickVisibleMenuByText, clickVisibleSubMenuByText }} = require('../../utils/gnb');

    [기본 코드 조건]
    - CommonJS 형식으로 작성한다.
    - const {{ test, expect }} = require('@playwright/test'); 를 포함한다.
    - test.beforeEach에서 page.goto(process.env.BASE_URL || 'https://example.com')를 사용한다.
    - await page.waitForSelector('header.header.pc'); 를 포함한다.

    [코드 스타일]
    - 테스트명은 한글로 작성해도 된다.
    - parent depth2 메뉴 단위로 test를 나눈다.
    - 각 child depth3 메뉴는 test.step으로 나눈다.
    """


def generate_content_with_llm(prompt):
    model = create_gemini_model()
    response = model.generate_content(prompt)
    return response.text


def strip_markdown_code_block(text):
    return text.replace("```javascript", "").replace("```", "").strip()


def analyze_and_generate_menu_test(menu_map, generate_all=True, max_parent=3, max_children=3):
    print("🤖 LLM이 menuTree 기반 GNB 메뉴 접근 테스트를 생성하고 있습니다...")

    generation_input = build_menu_generation_input(
        menu_map,
        generate_all=generate_all,
        max_parent=max_parent,
        max_children=max_children
    )
    prompt = build_menu_test_prompt(generation_input)
    generated_code = strip_markdown_code_block(generate_content_with_llm(prompt))

    return generated_code


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

    print(f"✅ 테스트 파일 생성 완료: {file_path}")


def save_generated_test_spec(code, file_name="generated_menu_access.spec.js"):
    TESTS_GENERATED_DIR.mkdir(parents=True, exist_ok=True)

    file_path = TESTS_GENERATED_DIR / file_name
    with open(file_path, "w", encoding="utf-8") as f:
        f.write(ensure_playwright_header(code))

    print(f"✅ 실행용 테스트 파일 생성 완료: {file_path}")


def save_json(data, file_name="scout_result.json"):
    GENERATED_DIR.mkdir(parents=True, exist_ok=True)
    
    file_path = GENERATED_DIR / file_name
    with open(file_path, "w", encoding='utf-8') as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
        
    print(f"✅ JSON 저장 완료: {file_path}")

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
            "text": item.get("text", ""),
            "href": item.get("href", ""),
            "id": item.get("id", ""),
            "ngClick": item.get("ngClick", ""),
            "menuDepth": item.get("menuDepth"),
            "isVisible": item.get("isVisible"),
            "requiresHoverBeforeClick": item.get("isGnbCandidate") and not item.get("isVisible"),
            "parentText": item.get("parentText", ""),
            "cssPath": item.get("cssPath", ""),
            "locatorCandidates": item.get("locatorCandidates", [])
        })
        
    return menus

# AI가 테스트 케이스를 더 잘 만들 수 있도록 같은 depth 에 묶인 매뉴들은 parents를 체크해서 tree 구조로 생성하도록 작성
def build_menu_tree(menu_candidates):
    tree = []
    current_depth2 = None

    for menu in menu_candidates:
        depth = menu.get("menuDepth")

        if depth == 2:
            current_depth2 = {
                **menu,
                "depth1Index": DEPTH1_INDEX_MAP.get(menu.get("text")),
                "children": []
            }
            tree.append(current_depth2)

        elif depth == 3:
            if current_depth2 is not None:
                current_depth2["children"].append(menu)
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

def extract_page_profiles(dom_data):
    if isinstance(dom_data, dict):
        return dom_data.get("pageProfiles", [])

    return []


def build_menu_map(target_url, menu_candidates, menu_tree, page_profiles=None):
    return {
        "url": target_url,
        "count": len(menu_candidates),
        "menus": menu_candidates,
        "menuTree": menu_tree,
        "pageProfiles": page_profiles or []
    }


def print_generation_summary(dom_map, menu_candidates):
    element_count = len(dom_map) if isinstance(dom_map, list) else dom_map.get('count', 0)
    print(f"수집 요소 수: {element_count}")
    print(f"메뉴 후보 수: {len(menu_candidates)}")


def run_generation_pipeline(target_url):
    configure_llm()

    dom_map = run_scout(target_url)
    print(dom_map)
    if not dom_map:
        return

    save_json(dom_map, "scout_result.json")

    menu_candidates = extract_menu_candidate(dom_map)
    menu_tree = build_menu_tree(menu_candidates)
    page_profiles = extract_page_profiles(dom_map)
    menu_map = build_menu_map(target_url, menu_candidates, menu_tree, page_profiles)

    save_json(menu_map, "menu_map.json")
    print_generation_summary(dom_map, menu_candidates)

    # code = analyze_and_generate_code(dom_map)
    # code = analyze_and_generate_menu_test(menu_map)

    # 디버깅 용으로 최소한만 만들어야 할때
    # code = analyze_and_generate_menu_test(menu_map, generate_all=False, max_parent=1, max_children=2)
    # 전체 테스트케이스 생성을 수행할 때
    code = analyze_and_generate_menu_test(menu_map, generate_all=True)
    save_generated_test_spec(code, "generated_menu_access.spec.js")


if __name__ == "__main__":
    target_url = "https://iotbiz.kt.co.kr" # 실제 테스트 대상 URL
    run_generation_pipeline(target_url)
