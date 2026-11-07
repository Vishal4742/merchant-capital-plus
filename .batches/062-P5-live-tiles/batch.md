# 062-P5-live-tiles
Phase: 5 (PHASES.md)   Round: build   Owner lane: claude-frontend
Mode: phase
Money: no (landing page; links to existing pay pages)
Request (verbatim, human in claude-frontend's chat, 2026-11-07 08:11, with a screenshot of the landing's 01-04 Accept tiles): "these things shouls be working ??"
Agent ids: none
Log:
- 08:14 branch p5-live-tiles from origin/main e08f356. Today the tiles are drawings: "Copy" is an aria-hidden span, pay.mc/l/cold-brew isn't an address, the QR is a random pattern, the snippet says "…/v1/button.js" with a made-up link. The real pieces exist: /qr/l/<slug> (lib/qr.ts), /v1/button.js (data-link), CopyButton, PUBLIC_ORIGIN. The live G5 links have QA titles (audit M2), so the demo link and page come from env: DEMO_LINK_SLUG, DEMO_PAGE_SLUG (the human creates a clean "Cold brew" link and a Bandra Beans page).
- 08:24 GREEN: landingDemo + tiles; tsc 0, lint 0, tiles/trim/capital-entry tests 7/7. Browser (b062-shots, built with DEMO_LINK_SLUG=jLYut8wVnM, DEMO_PAGE_SLUG=DemoPage01) at 375 light + 1440 dark: pill opens the link (200), Copy -> https://whiteflow.org/l/jLYut8wVnM, page tile -> /p/<slug>, QR /qr/l/<slug> 200 and loaded, snippet Copy -> the exact <script src=https://whiteflow.org/v1/button.js data-link=…>, h-scroll 0, console 0. The human sets the two env vars on the whiteflow web project (a read-only DB lookup of page slugs was refused by the permission classifier; not retried).
