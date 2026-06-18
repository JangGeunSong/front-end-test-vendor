# Test Levels

## Purpose

This document defines the automation maturity levels for this Playwright AI test generation project.

The current generated test is not full test automation. It is a Level 1 Navigation Smoke Test MVP that checks whether GNB menu navigation can reach pages without obvious navigation failures.

## Current Status

Current generated tests focus on GNB menu access.

They verify:

- GNB hover and click flow
- URL or hash navigation
- Page access without obvious navigation errors

They do not yet verify:

- Page heading
- Representative page text
- Main content containers
- Tables
- Forms
- Input fields
- Search results
- Business rules
- Data-changing workflows

## Level Summary

| Level | Name | Purpose | Current Status |
| --- | --- | --- | --- |
| Level 1 | Navigation Smoke Test MVP | Verify menu navigation and basic page access | Current MVP |
| Level 2 | Page Identity Test | Verify that navigation reached the intended page | Future |
| Level 3 | Safe Interaction Test | Verify safe, non-data-changing interactions | Future |
| Level 4 | Business Scenario Test | Verify approved business flows from human-defined test cases | Future |

## Level 1 - Navigation Smoke Test MVP

### Scope

Level 1 verifies that generated GNB navigation tests can access menu targets.

It covers:

- GNB depth1 hover
- depth2 menu click
- depth3 child menu click
- URL or hash movement checks
- Basic page access without obvious errors

For Level 1, obvious navigation errors include:

- 404 page
- 500 error page
- blank page
- unauthorized or forbidden page
- expected URL or hash not reached
- visible error indicator text

### Completed

- Generated tests are stored under `tests/generated`.
- Generated GNB tests can use helpers from `utils/gnb.js`.
- Duplicate depth3 menu names can be resolved with parent-aware helper calls.
- Visual debug can be enabled with `HIGHLIGHT=true`.

### Not Covered

Level 1 is not full coverage testing.

It does not verify:

- Whether the destination page content is semantically correct
- Heading or title correctness
- Representative page text
- Table existence or table data
- Form existence or field labels
- Input/search/filter behavior
- Paging behavior
- Business workflow correctness
- Data create/update/delete/approval/send actions

## Level 2 - Page Identity Test

### Definition

Level 2 is not full test automation.

Level 2 is a page identity verification stage that checks whether a menu click reached the intended page.

The goal is to confirm page identity using stable page signals after navigation.

### Scope

Level 2 should verify one or more page identity signals:

- heading
- representative text
- main content container
- table presence
- form presence
- tab presence
- stable URL or hash pattern

### Required pageProfile Data

Future `scout.js` output can include a `pageProfile` object for each navigated page.

Candidate structure:

```json
{
  "pageProfile": {
    "url": "",
    "hash": "",
    "documentTitle": "",
    "headings": [],
    "representativeTexts": [],
    "mainContainers": [],
    "tables": [],
    "forms": [],
    "buttons": [],
    "tabs": [],
    "errorIndicators": []
  }
}
```

Candidate fields:

- `url`: current page URL
- `hash`: current URL hash
- `documentTitle`: browser document title
- `headings`: h1/h2/h3 or role heading candidates
- `representativeTexts`: stable text that identifies the page
- `mainContainers`: selectors for primary content regions
- `tables`: table selector, caption, headers, row count
- `forms`: form selector, labels, input/select/textarea candidates
- `buttons`: visible button candidates that may help identify the page
- `tabs`: tablist and tab text candidates
- `errorIndicators`: 404, 500, error, forbidden, unauthorized, empty page signals

Level 2 does not click buttons. However, stable buttons such as inquiry or search buttons can be useful page identity signals when they are specific to the destination page.

### representativeTexts Selection Criteria

`representativeTexts` should include only stable text that helps identify the destination page.

Include candidates such as:

- unique page title
- business area name
- page-specific guide text
- stable section title that appears only on the intended page

Exclude candidates such as:

- common layout text
- GNB text
- footer text
- repeated labels
- overly generic text

Common exclusion examples:

- login
- menu
- customer center
- search
- list
- confirm
- cancel

### Expected Assertions

Generated Level 2 tests may produce assertions such as:

```js
await expect(page.getByRole('heading', { name: 'Page Title' })).toBeVisible();
await expect(page.getByText('Representative page text')).toBeVisible();
await expect(page.locator('main')).toBeVisible();
```

### Limitations

- Level 2 does not validate business data correctness.
- Level 2 does not perform data-changing actions.
- Level 2 does not verify complete page behavior.
- Level 2 only confirms that the page appears to be the intended destination.

## Level 3 - Safe Interaction Test

### Definition

Level 3 is not full input testing.

Level 3 only targets safe interactions that do not change business data.

### Scope

Level 3 can cover:

- typing into search fields
- selecting filters
- clicking search or inquiry buttons
- switching tabs
- using pagination
- expanding or collapsing read-only sections
- changing page size where it does not modify data

### Safe Actions

Safe actions are interactions expected not to create, update, delete, approve, send, or persist business data.

Examples:

- search
- inquiry
- filter
- sort
- tab switch
- pagination
- date range selection for search
- checkbox or radio selection used only as a filter
- opening read-only detail views

### Risky Actions

Risky actions must not be executed automatically by generated tests.

Examples:

- save
- delete
- register
- create
- update
- modify
- approve
- reject
- send
- submit
- upload
- download if it triggers external transfer or irreversible side effects
- reset if it changes persisted data

### Required Interaction Data

Future safe interaction generation needs structured candidates:

```json
{
  "interactionProfile": {
    "inputs": [],
    "selects": [],
    "checkboxes": [],
    "radios": [],
    "buttons": [],
    "tabs": [],
    "pagination": [],
    "riskyActions": []
  }
}
```

### Limitations

- Level 3 does not verify business workflows.
- Level 3 does not execute risky actions.
- Level 3 requires action classification before generation.
- Ambiguous buttons should be left as TODO comments, not clicked.

## Level 4 - Business Scenario Test

### Scope

Level 4 verifies approved business scenarios based on human-defined test cases.

It requires:

- test account
- test data
- known preconditions
- expected business rules
- approved scenario steps
- cleanup or rollback strategy where needed

### Limitations

- Level 4 cannot be inferred safely from UI structure alone.
- Level 4 should not be generated solely from anonymous menu JSON.
- Human review and approval are required before execution.

## Generated Test Promotion Criteria

Generated tests remain in `tests/generated` until they are reviewed.

### Before Promoting To tests/smoke

A generated test can be promoted to `tests/smoke` only when:

- It performs no data-changing actions.
- It runs quickly enough for frequent checks.
- It has passed visual/debug confirmation.
- It verifies a critical navigation or basic availability path.
- It is stable across repeated runs.
- It does not depend on volatile production-like data.
- It does not require manual intervention.

### Before Promoting To tests/regression

A generated test can be promoted to `tests/regression` only when:

- Test data is clearly defined.
- Preconditions are clearly defined.
- The scenario has repeatable verification value.
- Expected results are explicit.
- Side effects are understood and controlled.
- The test can be rerun safely.
- The test covers behavior worth protecting against future regressions.
- A human has reviewed and accepted the scenario.

## Future Codex Work Candidates

- Add `pageProfile` collection to `scout.js`.
- Document `pageProfile` in `docs/JSON_SCHEMA.md`.
- Add Level 2 prompt rules to `agent_orchestrator.py`.
- Generate Page Identity assertions from `pageProfile`.
- Add safe interaction classification rules for Level 3.
- Add `interactionProfile` collection candidates.
- Prevent risky action execution by default.
- Add a generated-to-smoke/regression review checklist.
- Add generator options for selecting test level.
