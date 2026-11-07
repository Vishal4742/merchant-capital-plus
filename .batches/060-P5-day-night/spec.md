# Spec: 060-P5-day-night

## Requirements (cite docs/SRS.md IDs)
- FR-UX-4: a labelled day/night control ("Switch to day mode" / "Switch to night mode"), keyboard operable with visible focus, readable contrast in both themes, no horizontal overflow at 360 px.
- NFR-12 / NFR-13: no flash of the other theme on load (the saved choice is applied by a few bytes of inline script before first paint), no new dependency, no new request.
- Tokens already define both themes (`[data-theme="light"|"dark"]`, else the device's prefers-color-scheme). The night scene keeps its night colours in both (the approved demo's rule).

## Acceptance criteria
- [ ] The toggle sits in the landing nav, the dashboard sidebar (signed-in screens), PlainPage (signed-out dashboard and capital pages) and the docs top bar.
- [ ] Clicking it flips <html data-theme>, the page restyles at once, and the choice survives a reload and other pages (localStorage `mcplus.theme`).
- [ ] With nothing saved, the site follows the device; a bad or unreadable stored value is ignored, and a throwing localStorage (private mode) breaks nothing.
- [ ] Pay pages (/l, /p, /checkout, /pay) show no toggle but honour the saved choice.
- [ ] 375 light and 1440 dark, before and after a toggle: no CSP violation, no console error, no h-scroll.
- [ ] npx tsc --noEmit, npm run lint, npm test, npm run build.

## Files to touch
- apps/web/lib/theme.ts (new: key + pre-paint script), components/ThemeToggle.tsx (new), app/layout.tsx
- apps/web/components/landing/Hero.tsx, components/dashboard/Shell.tsx, components/gateway/Frame.tsx, app/docs/page.tsx
- apps/web/test/theme.test.mjs (new)

## Ponytail ladder
- Needed: the human asked. Already in repo: the data-theme token blocks and landing.css overrides exist, so this is only the switch. Platform: localStorage + one inline script (CSP already allows inline scripts for Next's bootstrap). No next-themes dependency for ~30 lines.

## Out of scope
- A toggle on the customer pay sheets (they follow the device or the saved choice).
- A "system" third state: with nothing saved the site already follows the device.
