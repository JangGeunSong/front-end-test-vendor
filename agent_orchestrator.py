import subprocess
import json
import os
from dotenv import load_dotenv
import google.generativeai as genai  # pip install google-generativeai

load_dotenv()

# 1. LLM 설정 (API 키는 환경변수나 별도 파일 권장)
genai.configure(api_key=os.environ.get("GEMINI_API_KEY"))
model = genai.GenerativeModel('gemini-3-flash-preview')

def run_scout(url):
    print(f"🔍 '{url}' 사이트 구조 분석 중...")

    # 현재 환경 변수 복사 및 UTF-8 설정 주입
    current_env = os.environ.copy()
    current_env["NODE_OPTIONS"] = "--input-type=commonjs" # 필요 시 설정
    
    # 수정 후 (shell=True 추가)
    result = subprocess.run(
        ['node', 'scout.js', url], 
        capture_output=True, 
        text=True,
        # 핵심 변경: 데이터를 UTF-8로 읽고, 깨지는 글자는 대체 문자로 처리하여 중단 방지
        encoding='utf-8', 
        errors='replace', 
        shell=True,
        env=current_env
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
    아래 JSON 데이터를 기반으로 '조회 및 상세 확인' 테스트 코드를 작성해라.

    [사이트 구조 데이터]
    {json.dumps(dom_data, indent=2, ensure_ascii=False)}

    [필수 규칙]
    1. 'isHoverTarget'이 true인 요소는 반드시 .hover() 후 하위 메뉴를 클릭해라.
    2. 모든 동작은 test.step()으로 묶어라.
    3. 결과 피드백(텍스트, URL 변화 등)을 expect()로 검증해라.
    4. **출력은 마크다운 코드 블록 없이 순수 Javascript 코드만 반환해라.**
    """

    # LLM 호출
    response = model.generate_content(prompt)
    generated_code = response.text.replace('```javascript', '').replace('```', '').strip()
    
    return generated_code

def save_test_spec(code, file_name="generated_test.spec.js"):
    if not os.path.exists('tests'):
        os.makedirs('tests')
        
    file_path = os.path.join('tests', file_name)
    with open(file_path, 'w', encoding='utf-8') as f:
        # 파일 상단에 필수 import 구문이 빠졌을 경우를 대비해 보강
        if "require('@playwright/test')" not in code:
            header = "const { test, expect } = require('@playwright/test');\n\n"
            code = header + code
        f.write(code)
    
    print(f"✅ 테스트 파일 생성 완료: {file_path}")

# --- 실행 파이프라인 ---
if __name__ == "__main__":
    target_url = "https://yoursite.domain.url" # 실제 테스트 대상 URL
    
    dom_map = run_scout(target_url)
    print(dom_map)
    # if dom_map:
    #     code = analyze_and_generate_code(dom_map)
    #     save_test_spec(code, "auto_scout_test.spec.js")