# Test Template Catalog

## Purpose

This catalog defines the test templates that an LLM may choose when creating structured test plan JSON.

The examples are neutral schema fixtures. They do not represent real scout results or a real customer site. Real plans are generated from the target URL and scout output during `ai:generate`.

The LLM should choose a template and fill fields. It should not generate Playwright JavaScript. A future deterministic renderer will translate these templates into Playwright spec code.

## Common Rules

- Every test must include `id`, `title`, `template`, `menuPath`, `depth1Index`, and `click`.
- `depth1Index` may be `null` only when the scout result could not infer the top-level hover target.
- Selector fields must use values collected from the exact matching pageProfile.
- Sibling pageProfile selector fallback is forbidden.
- Heading assertions should use exact matching by default.
- URL assertion formatting is owned by the renderer.
- Renderer code owns helper imports, `page.goto`, loops, regex escaping, `expect`, and visual debug highlights.
- Risky actions such as save, delete, register, update, approve, send, upload, and submit are not represented by these navigation templates.

## navigation.urlOnly

Use this template when the menu click can be verified by URL/hash movement only.

Required fields:

- `id`
- `title`
- `template`: `"navigation.urlOnly"`
- `menuPath`
- `depth1Index`
- `click`
- `assertions.url.href`

Example:

```json
{
  "id": "gnb-products-url",
  "title": "GNB: Products",
  "template": "navigation.urlOnly",
  "menuPath": ["Products"],
  "depth1Index": 0,
  "click": {
    "type": "depth2",
    "text": "Products"
  },
  "assertions": {
    "url": {
      "href": "#/products/pricing"
    }
  }
}
```

## navigation.headingIdentity

Use this template when URL/hash movement and a stable heading identify the destination page.

Required fields:

- all `navigation.urlOnly` fields
- `assertions.identity.type`: `"heading"`
- `assertions.identity.text`
- `assertions.identity.exact`

Example:

```json
{
  "id": "gnb-products-heading",
  "title": "GNB: Products",
  "template": "navigation.headingIdentity",
  "menuPath": ["Products"],
  "depth1Index": 0,
  "click": {
    "type": "depth2",
    "text": "Products"
  },
  "assertions": {
    "url": {
      "href": "#/products/pricing"
    },
    "identity": {
      "type": "heading",
      "text": "Products",
      "exact": true
    }
  }
}
```

## navigation.contentIdentity

Use this template when URL/hash movement plus a stable main/content container identifies the destination page.

Required fields:

- all `navigation.urlOnly` fields
- `assertions.identity.type`: `"content"`
- `assertions.identity.selector`
- `assertions.identity.sourceMenuPath`

Example selector:

```json
{
  "identity": {
    "type": "content",
    "selector": "main[data-page='developer-guide']",
    "sourceMenuPath": ["Support", "Developer Guide"]
  }
}
```

Selector rule:

- `assertions.identity.selector` must be a `cssPath` from the pageProfile whose `menuPath` equals `assertions.identity.sourceMenuPath`.
- `sourceMenuPath` must equal the test case `menuPath`.

## navigation.tabIdentity

Use this template for tab-like navigation where URL/hash may not change, but a stable tab or tab content signal identifies the selected state.

Required fields:

- `id`
- `title`
- `template`: `"navigation.tabIdentity"`
- `menuPath`
- `depth1Index`
- `click`
- `assertions.identity.type`: `"tab"`
- one of:
  - `assertions.identity.selector`
  - `assertions.identity.id`
  - `assertions.identity.text`
- `navigationChange`

`navigationChange` values:

- `"expected"`: URL/hash should change.
- `"none"`: URL/hash is expected to stay the same.
- `"unknown"`: renderer should avoid strong URL assumptions.

Optional:

- `assertions.url.href` when URL/hash is expected or available.

## navigation.todoIdentity

Use this template when URL/hash can be verified, but stable Page Identity evidence is not available.

Required fields:

- `id`
- `title`
- `template`: `"navigation.todoIdentity"`
- `menuPath`
- `depth1Index`
- `click`
- `assertions.url.href`
- `todo.reason`

Renderer behavior:

- Generate the navigation click.
- Generate URL/hash assertion when `assertions.url.href` exists.
- Emit a TODO comment instead of heading/content/tab identity assertion.

## Renderer Responsibilities

The deterministic renderer should own:

- CommonJS imports
- `BASE_URL` handling
- `test.beforeEach`
- `openDepth1ByIndex`
- `clickVisibleMenuByText`
- `clickVisibleSubMenuByText`
- URL escaping helper
- heading/content/tab assertion format
- `highlightPageIdentity`
- loop format for grouped children
- TODO comment format

The renderer should reject unsupported templates instead of inventing behavior.

