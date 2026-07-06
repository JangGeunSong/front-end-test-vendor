# Structured Test Plan Schema

## Purpose

Structured test plan JSON is the contract for the next generation pipeline.

Current `ai:generate` still asks the LLM to produce a Playwright spec. This document does not change that behavior. It defines the future intermediate artifact that the LLM should produce before a deterministic renderer creates the Playwright spec.

The goal is to reduce free-form generated JavaScript and make test generation more stable.

## Example Data Policy

Examples in this document and `tools/ai-generator/generated/test_plan.example.json` are schema fixtures.

They must not contain real customer sites, real service names, real hash routes, real selectors, or real `ngClick` function names.

Use neutral sample data only:

- domain: `https://example.test`
- menu labels such as `Products`, `Support`, `Developer Guide`, `Resources`, `FAQ`
- routes such as `#/products/pricing`, `#/support/developer-guide`, `#/resources/faq`
- selectors such as `main[data-page='developer-guide']`
- generic handlers such as `selectTab('overview')`

Actual test plans are generated during `ai:generate` from the user-provided target URL and scout results. The example JSON is kept as a safe sample for schema documentation, LLM output examples, future renderer work, and future validator fixtures.

## Current Problem

When the LLM generates a full Playwright spec directly, the generated code can vary on each run.

Unstable areas include:

- URL/hash assertion shape
- heading exactness
- sibling pageProfile selector fallback
- selector shortening or synthesis
- helper function shape
- loop structure
- Page Identity fallback logic

The generated spec validator can catch many mistakes, but it cannot guarantee that every runtime failure is prevented. A structured plan gives the renderer and validator a smaller, clearer surface to enforce.

## Direction

Future pipeline direction:

```text
scout_result.json
  -> menu_map.json
  -> LLM structured test plan JSON
  -> deterministic renderer
  -> tests/generated/generated_menu_access.spec.js
```

Rules:

- The LLM should not write JavaScript helper code.
- The LLM should not write `page.goto`, regular expressions, loops, or Playwright assertions directly.
- The LLM should choose a template and fill structured fields.
- The renderer should own URL handling, helper imports, loop format, assertions, and visual debug hooks.
- The renderer should reject unsupported or ambiguous plans.

## Top-Level Structure

```json
{
  "version": "1.0",
  "targetUrl": "https://example.test",
  "source": {
    "menuMapPath": "tools/ai-generator/generated/menu_map.json",
    "scoutResultPath": "tools/ai-generator/generated/scout_result.json"
  },
  "tests": []
}
```

Top-level fields:

- `version`: schema contract version.
- `targetUrl`: URL used during scout/generation. The rendered spec may use this as its default `BASE_URL`.
- `source.menuMapPath`: source `menu_map.json` path used to build the plan.
- `source.scoutResultPath`: source `scout_result.json` path used to build the plan.
- `tests`: ordered list of test case plans.

## Test Case Structure

Common fields:

- `id`: stable machine-readable test id.
- `title`: human-readable test title.
- `template`: renderer template id from `docs/TEST_TEMPLATE_CATALOG.md`.
- `menuPath`: menu path represented by the test.
- `depth1Index`: zero-based top-level navigation index, or `null` if unknown.
- `click`: structured click instruction.
- `assertions`: URL and Page Identity assertion data.
- `todo`: optional TODO metadata for cases that should not create a strong identity assertion.

## Click Object

Depth2 click:

```json
{
  "type": "depth2",
  "text": "Products",
  "cssPath": "nav.primary li.products > a"
}
```

Depth3 click:

```json
{
  "type": "depth3",
  "parentText": "Support",
  "text": "Developer Guide",
  "id": "support-developer-guide",
  "ngClick": "",
  "cssPath": "nav.primary li.support-developer-guide > a"
}
```

Click rules:

- `click.type` must be `depth2` or `depth3`.
- Depth3 clicks must include `parentText`.
- If `menu_map` has `id`, `ngClick`, or `cssPath`, preserve those values literally.
- Do not calculate `cssPath` from `id`.
- Do not use a depth3 child text without parent context.

## Assertions Object

URL assertion:

```json
{
  "url": {
    "href": "#/products/pricing"
  }
}
```

Identity assertion:

```json
{
  "identity": {
    "type": "heading",
    "text": "Products",
    "exact": true
  }
}
```

Assertion rules:

- `assertions.url.href` should use the href from `menu_map` when available.
- The renderer owns URL escaping and `toHaveURL` format.
- Heading identity should use `exact: true` by default.
- CSS selectors must come from the pageProfile whose `menuPath` exactly matches the test case.
- Do not use sibling pageProfile selectors as fallback.
- Do not shorten, merge, or invent selectors.
- The LLM must not write Playwright locator code in this JSON.

## Template Summary

Supported initial template ids:

- `navigation.urlOnly`
- `navigation.headingIdentity`
- `navigation.contentIdentity`
- `navigation.tabIdentity`
- `navigation.todoIdentity`

Template details and required fields are defined in `docs/TEST_TEMPLATE_CATALOG.md`.

## Level 1/2 Relationship

This schema can represent the current Level 1/2 GNB generated test scope:

- Level 1 Navigation Smoke: `navigation.urlOnly`
- Level 2 heading identity: `navigation.headingIdentity`
- Level 2 main/content identity: `navigation.contentIdentity`
- Level 2 tab identity: `navigation.tabIdentity`
- URL-only with identity TODO: `navigation.todoIdentity`

Current implementation still generates Playwright spec directly. This schema is a preparation contract for the future deterministic renderer.

## Validation Expectations

Future validators should check:

- schema version support
- unique `tests[].id`
- supported `template`
- required fields per template
- selector source matches exact `menuPath`
- no sibling selector fallback
- no computed selector fields
- `depth1Index` is a number or `null`
- `click.type` and required click fields are valid
- `todo.reason` exists for `navigation.todoIdentity`

When `validate_test_plan.py` receives `--menu-map`, it also checks primary navigation coverage:

- every parent depth2 `primaryMenuTree` menuPath has a test case
- every child depth3 `primaryMenuTree` menuPath has a test case
- no test case uses a menuPath outside `primaryMenuTree`
- no duplicate `tests[].menuPath` exists

Coverage failures are errors because an incomplete LLM plan must not silently pass into renderer output.

## Validator Command

The draft validator checks the safe example fixture:

```bash
npm run ai:validate-plan
```

Equivalent Python command:

```bash
python tools/ai-generator/validate_test_plan.py
```

Validate a generated LLM plan against `menu_map.json` coverage:

```bash
npm run ai:validate-llm-plan
```

Current default input:

```text
tools/ai-generator/generated/test_plan.example.json
```

`navigation.tabIdentity` allows URL/hash to stay unchanged. If `navigationChange` is `"expected"` and `assertions.url.href` is missing, the validator reports a warning rather than an error. The future renderer can decide whether that case should become stricter.
