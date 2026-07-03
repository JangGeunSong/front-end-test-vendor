# Structured Plan Orchestration Migration

## Purpose

This document describes how `agent_orchestrator.py` can move from direct LLM-generated Playwright JavaScript to a structured test plan JSON plus deterministic renderer pipeline.

This is a migration design only. Current `ai:generate` behavior and `tests/generated/generated_menu_access.spec.js` generation remain unchanged.

## Current Structure

Current generation flow:

```text
target URL
  -> tools/ai-generator/scout.js
  -> tools/ai-generator/generated/scout_result.json
  -> tools/ai-generator/generated/menu_map.json
  -> LLM
  -> tests/generated/generated_menu_access.spec.js
  -> tools/ai-generator/validate_generated_spec.py
  -> Playwright execution
```

Current issue:

- The LLM writes the full Playwright spec.
- URL assertion format can vary.
- Heading exactness can vary.
- Selector fallback rules can drift.
- Helper function shape can change.
- Loop structure can change.
- Runtime failures can still slip through even when the generated spec validator is expanded.

The current path works, but it has a large free-form JavaScript surface.

## Target Structure

Target generation flow:

```text
target URL
  -> tools/ai-generator/scout.js
  -> tools/ai-generator/generated/scout_result.json
  -> tools/ai-generator/generated/menu_map.json
  -> LLM structured test plan JSON
  -> tools/ai-generator/validate_test_plan.py
  -> tools/ai-generator/render_test_plan.py
  -> tests/generated/generated_menu_access.spec.js
  -> tools/ai-generator/validate_generated_spec.py
  -> Playwright execution
```

Core rule:

- The LLM does not write JavaScript.
- The LLM chooses templates and fills structured fields.
- The deterministic renderer owns Playwright code shape.
- URL helpers, click helpers, assertions, loop structure, and TODO format are fixed by code.

## Available Foundation

Current structured plan assets:

- `docs/TEST_PLAN_SCHEMA.md`
- `docs/TEST_TEMPLATE_CATALOG.md`
- `tools/ai-generator/generated/test_plan.example.json`
- `tools/ai-generator/validate_test_plan.py`
- `tools/ai-generator/render_test_plan.py`
- `tools/ai-generator/build_test_plan.py`

Current plan scripts:

- `npm run ai:build-plan`
- `npm run ai:validate-generated-plan`
- `npm run ai:render-generated-plan`
- `npm run ai:plan`

Current experimental output files:

- `tools/ai-generator/generated/test_plan.generated.json`
- `tests/generated/generated_from_plan.spec.js`

The deterministic `menu_map.json -> test_plan.generated.json -> generated_from_plan.spec.js` path has been verified separately from the existing `ai:generate` path.

## Migration Phases

### Phase 0 - Current State

Status:

- `ai:generate` asks the LLM to generate a Playwright JS spec directly.
- Structured plan generation is a separate experimental path.
- Existing generated spec remains `tests/generated/generated_menu_access.spec.js`.
- Plan renderer output remains `tests/generated/generated_from_plan.spec.js`.

Purpose:

- Keep the stable path intact.
- Use structured plan tools for comparison and confidence building.

### Phase 1 - Deterministic Builder Shadow Mode

Flow:

```text
ai:generate or existing menu_map.json
  -> build_test_plan.py
  -> test_plan.generated.json
  -> validate_test_plan.py
  -> render_test_plan.py
  -> generated_from_plan.spec.js
```

Behavior:

- `build_test_plan.py` creates a deterministic plan from `primaryMenuTree` and `pageProfiles`.
- Existing `generated_menu_access.spec.js` remains the primary generated test artifact.
- `generated_from_plan.spec.js` is used for shadow comparison.

Validation:

- `npm run ai:plan`
- `npx playwright test tests/generated/generated_from_plan.spec.js`
- Compare coverage and failures against existing generated spec.

### Phase 2 - LLM Plan Generation Shadow Mode

Flow:

```text
menu_map.json + pageProfiles
  -> LLM structured plan prompt
  -> test_plan.llm.json
  -> validate_test_plan.py
  -> render_test_plan.py
  -> generated_from_plan.spec.js
```

Behavior:

- Add a plan-generation prompt to `agent_orchestrator.py`.
- The LLM outputs JSON only.
- Store LLM output as `tools/ai-generator/generated/test_plan.llm.json`.
- Validate it before rendering.
- Keep direct JS generation as fallback.
- Keep rendered output separate as `generated_from_plan.spec.js`.

Failure fallback:

- If JSON parse fails, keep direct JS generation path.
- If plan validation fails, keep direct JS generation path.
- If renderer fails, keep direct JS generation path.

### Phase 3 - Opt-In Plan Mode

Add a CLI option:

```bash
python tools/ai-generator/agent_orchestrator.py --url https://target.example.com --generation-mode spec
python tools/ai-generator/agent_orchestrator.py --url https://target.example.com --generation-mode plan
```

Mode behavior:

- `spec`: current default direct JS generation.
- `plan`: LLM plan JSON -> validator -> renderer.

Initial output:

- Keep plan mode output as `tests/generated/generated_from_plan.spec.js`.
- Do not overwrite `generated_menu_access.spec.js` until the plan path is stable.

### Phase 4 - Plan Mode Default

Precondition:

- Plan mode validator passes reliably.
- Renderer output passes Playwright execution reliably.
- Visual/debug behavior is acceptable.
- Existing generated spec validator remains compatible with renderer output.

Behavior:

- Change default generation mode to `plan`.
- Renderer writes `tests/generated/generated_menu_access.spec.js`.
- Direct JS generation becomes a legacy fallback or is removed after review.

## Failure And Fallback Policy

Failure points:

- LLM plan JSON parse failure
- `validate_test_plan.py` failure
- `render_test_plan.py` failure
- `validate_generated_spec.py` failure
- Playwright execution failure

Policy:

- Print which stage failed.
- Preserve failed artifacts for inspection.
- Do not silently fall back without logging.
- During shadow and opt-in phases, keep direct JS generation available.
- Do not promote plan mode to default until failures are explainable and repeatable.

Suggested artifact preservation:

- Raw LLM response if parsing fails
- `test_plan.llm.json` if validation fails
- renderer error output if rendering fails
- generated spec if spec validation fails
- Playwright report and trace if execution fails

## Artifact Paths

Recommended paths:

- deterministic builder plan: `tools/ai-generator/generated/test_plan.generated.json`
- LLM plan output: `tools/ai-generator/generated/test_plan.llm.json`
- plan renderer shadow spec: `tests/generated/generated_from_plan.spec.js`
- final generated spec after default switch: `tests/generated/generated_menu_access.spec.js`

## Validation Strategy

Plan path commands:

```bash
npm run ai:plan
npm run ai:validate-generated-plan
npm run ai:render-generated-plan
npx playwright test tests/generated/generated_from_plan.spec.js
```

Existing stable path commands:

```bash
npm run ai:validate
npm run test:generated
```

During migration, both paths should remain runnable.

## Principles

- `scout.js` continues broad rendered DOM discovery.
- Generated spec scope starts with primary navigation.
- LLM output is structured JSON, not JavaScript.
- LLM must not write helper code, regex code, locator code, or Playwright loops.
- Selectors must come from exact `menuPath` pageProfiles.
- Sibling pageProfile fallback is forbidden.
- If identity evidence is weak, choose `navigation.todoIdentity`.
- Renderer output must be deterministic.
- Keep the existing stable direct-spec path until plan mode is proven.

## Next Implementation Candidates

Recommended next changes:

- Add `--generation-mode spec|plan` to `agent_orchestrator.py`.
- Keep default as `spec`.
- Add plan-generation prompt that asks the LLM for structured JSON only.
- Save LLM output to `tools/ai-generator/generated/test_plan.llm.json`.
- Run `validate_test_plan.py` from the orchestrator.
- Run `render_test_plan.py` from the orchestrator.
- Keep initial plan-mode output at `tests/generated/generated_from_plan.spec.js`.
- Add clear stage logging and artifact preservation on failure.

