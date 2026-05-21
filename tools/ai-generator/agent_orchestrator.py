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

load_dotenv(ROOT_DIR / ".env")

# 1. LLM 설정 (API 키는 환경변수나 별도 파일 권장)
genai.configure(api_key=os.environ.get("GEMINI_API_KEY"))
model = genai.GenerativeModel('gemini-3-flash-preview')

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
    
    try:
        # scout.js에서 console.log로 출력한 데이터만 파싱
        return json.loads(result.stdout)
    except json.JSONDecodeError:
        print("❌ JSON 파싱 실패. 출력물을 확인하세요.")
        return None

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
    response = model.generate_content(prompt)
    generated_code = response.text.replace('```javascript', '').replace('```', '').strip()
    
    return generated_code

def save_test_spec(code, file_name="generated_test.spec.js"):
    GENERATED_DIR.mkdir(parents=True, exist_ok=True)
    
    file_path = GENERATED_DIR / file_name
    with open(file_path, 'w', encoding='utf-8') as f:
        # 파일 상단에 필수 import 구문이 빠졌을 경우를 대비해 보강
        if "require('@playwright/test')" not in code:
            header = "const { test, expect } = require('@playwright/test');\n\n"
            code = header + code
        f.write(code)
    
    print(f"✅ 테스트 파일 생성 완료: {file_path}")

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
                "children": []
            }
            tree.append(current_depth2)
        
        elif depth == 3:
            if current_depth2 is not None:
                current_depth2["children"].append(menu)
            else:
                tree.append({
                    **menu,
                    "children": []
                })
        
        else:
            tree.append({
                **menu,
                "children": []
            })
    
    return tree

# --- 실행 파이프라인 ---
if __name__ == "__main__":
    target_url = "https://yoursite.domain.url" # 실제 테스트 대상 URL    
    dom_map = run_scout(target_url)
    print(dom_map)
    if dom_map:
        save_json(dom_map, "scout_result.json")
        
        menu_candidates = extract_menu_candidate(dom_map)
        menu_tree = build_menu_tree(menu_candidates)
        
        save_json(
            {
                "url": target_url,
                "count": len(menu_candidates),
                "menus": menu_candidates,
                "menuTree": menu_tree
            },
            "menu_map.json"
        )
        
        print(f"수집 요소 수: {len(dom_map) if isinstance(dom_map, list) else dom_map.get('count', 0)}")
        print(f"메뉴 후보 수: {len(menu_candidates)}")
    #     code = analyze_and_generate_code(dom_map)
    #     save_test_spec(code, "auto_scout_test.spec.js")