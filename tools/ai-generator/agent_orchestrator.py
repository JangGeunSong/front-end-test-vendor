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
        "menuTree": target_menu_tree
    }


def build_menu_test_prompt(generation_input):
    return f"""
    너는 전문 QA 엔지니어이자 Playwright 테스트 아키텍트다.

    아래 JSON은 WEB 사이트의 GNB/nav 메뉴 구조다.
    menuTree는 depth2 메뉴와 depth3 하위 메뉴 관계를 나타낸다.
    각 depth2 메뉴에는 depth1Index가 포함되어 있으며, 이는 실제 화면에서 먼저 hover해야 하는 visible depth1 메뉴의 index이다.

    [menuTree JSON]
    {json.dumps(generation_input, indent=2, ensure_ascii=False)}

    [테스트 목표]
    Playwright 기반 GNB 메뉴 접근 Smoke Test 초안을 작성한다.

    [중요한 실행 규칙]
    1. hidden 상태의 depth2/depth3 메뉴를 직접 hover/click 하지 않는다.
    2. depth2 또는 depth3 메뉴 클릭 전에는 반드시 openDepth1ByIndex(page, depth1Index)를 호출한다.
    3. 메뉴 클릭은 clickVisibleMenuByText(page, menuName)를 사용한다.
    4. requiresHoverBeforeClick=true인 메뉴는 반드시 openDepth1ByIndex 호출 후 클릭한다.
    5. href가 있는 메뉴는 클릭 후 URL 또는 hash 변화를 expect(page).toHaveURL()로 검증한다.
    6. href가 없고 ngClick만 있는 메뉴는 클릭 후 TODO 주석으로 화면 변화 검증 필요성을 남긴다.
    7. 모든 동작은 test.step()으로 묶는다.
    8. 등록/수정/삭제 등 데이터 변경 동작은 생성하지 않는다.
    9. 출력은 마크다운 코드 블록 없이 순수 JavaScript 코드만 반환한다.

    [사용 가능한 helper]
    const {{ openDepth1ByIndex, clickVisibleMenuByText }} = require('../../utils/gnb');

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

def build_menu_map(target_url, menu_candidates, menu_tree):
    return {
        "url": target_url,
        "count": len(menu_candidates),
        "menus": menu_candidates,
        "menuTree": menu_tree
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
    menu_map = build_menu_map(target_url, menu_candidates, menu_tree)

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
    target_url = "https://yoursite.domain.url" # 실제 테스트 대상 URL
    run_generation_pipeline(target_url)
