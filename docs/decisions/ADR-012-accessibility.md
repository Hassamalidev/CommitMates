# ADR-012: Accessibility audit before launch

Date: 2026-11-04 · Status: accepted

## Context

P7-T03 asks for a full axe pass across every page, a keyboard walkthrough, and screen-reader labels for companions and charts, with no serious or critical violation left (CLAUDE.md §9.10). Feature specs already ran axe on the pages they touched, but nothing proved that every page was covered, in both themes, or that the keyboard could reach everything with a visible focus indicator.

## Decision

`e2e/a11y.spec.ts` is the audit, and it runs with the rest of the e2e suite:

- **Route inventory.** The test reads every `page.tsx` under `apps/web/src/app` and fails if a route is missing from the audit, so a new page cannot skip it. All 47 routes are listed: public, tools, member, admin and onboarding pages.
- **Realistic state.** A member is seeded at a test university with enough verified classmates (the largest `unlock.*.minMembers` setting, read from the database) and alumni (`unlock.alumni.minAlumni`) to open every campus feature, plus a conversation, an event, an FYP idea, a showcased project and a cached Dev Card. The audit therefore checks the open features, not only their Unlock cards. Admin pages are checked as an admin. Onboarding is checked as an unverified member.
- **Every page, both themes, both viewports** (desktop and 360 px):
  - the response is 200 and not a redirect;
  - there is exactly one H1;
  - every data table has a caption and header cells;
  - every companion is either hidden from assistive technology or a labelled image;
  - axe finds no serious or critical violation (WCAG 2.0/2.1/2.2 A and AA rules).
- **Keyboard walkthrough** (desktop): 40 Tab presses per page. The first stop is the skip link. Every stop must be visible and show a 2px outline or a ring. Focus must never be held on one element.
- **Charts.** The Dev Card's language bar and heatmap each render a captioned table, and the heatmap is also a slider. The rhythm strip lists its busiest hours. Each chart keeps its unit tests with axe.

Findings:

1. **A loading button lost its name (axe `button-name`, critical).** While loading, `Button` hid its label with `visibility: hidden` to keep the width. That also removes the label from the accessibility tree, so a screen reader announced only "button, busy". This appeared on the Dev Card page while a member's analysis was running. The label is now transparent (`opacity: 0`) instead, which keeps both the width and the name. A unit test pins it, because jsdom applies no Tailwind CSS and the old test could not see the problem.
2. **Date inputs' calendar button (events page).** Chromium gives a date input four Tab stops. The last is the calendar button inside the input's closed user-agent shadow root, and there the input itself no longer matches `:focus`, so page CSS cannot style it. A screenshot confirmed the browser draws its own ring around that button, so the walkthrough accepts this one case. The day, month and year fields already match `:focus-visible` and show our 2px ring.
3. **FYP ideas return 404 while the board is locked.** This is by design: ideas belong to an open board. The audit opens the board instead of treating the 404 as a fault.

## Alternatives considered

- **Running axe in each feature spec only**, as before. Rejected: there was no proof of coverage, the light theme was rarely checked, and locked pages hid most of the open UI.
- **Restyling the calendar button with `::-webkit-calendar-picker-indicator`.** Focus state cannot be selected on that pseudo-element, and the native ring is already visible.

## Consequences

- The audit adds about seven minutes to a local e2e run with two workers. In CI it runs in parallel with the other specs.
- Automated checks cannot judge everything. A pass with a real screen reader (NVDA or VoiceOver) on the main flows is listed in `docs/HUMAN_TODO.md` before launch.

## Verification

`pnpm exec playwright test e2e/a11y.spec.ts` on 2026-11-04 against the production build: 14 tests pass (every page in both themes at desktop and 360 px, the keyboard walkthrough, the chart alternatives and the route inventory); axe-core through `@axe-core/playwright`.
