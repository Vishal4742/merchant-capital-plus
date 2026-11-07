VERDICT: PASS
Scope: independent code/security/UX inspection of batch 062 spec, parent UI edits, and sign-in return helper. This is not hosted-client or visual acceptance.

The spec cites existing MCP and authorization requirements and preserves six supported tools; no new payment capability is inferred. The sign-in return helper accepts only the local /merchant/ai/authorize path, reconstructs only its request parameter, discards extra redirect/fragment parameters, blocks protocol-relative/backslash/absolute targets and bounds request length. Consent validates its signed request before offering sign-in; a completed login returns through the helper. Page and consent require Owner role. Claude instructions explicitly select dynamic registration. Copying a prompt never marks a connection verified.

Verification: Node 26 sign-in-return.test.mjs passed 1/1 (including hostile redirect and oversized request cases). No HIGH or CRITICAL finding in reviewed UI changes.

FOLLOW-UP (MEDIUM): When listGrants fails, /merchant/ai still renders the Setup required / No assistant is connected headline and then a contradictory warning. Render unknown/unavailable for this read-error state instead of asserting no connections. This predates these edits but is inside the requested honest-state acceptance scope.

FOLLOW-UP (LOW): The first numbered guide step still emphasizes copying a prompt while direct endpoint setup is now primary above it. Change the step to adding the custom connector, leaving the prompt optional.

Open acceptance: real browser Privy journey (signed out, workspace setup, expired request), mobile screenshots, and hosted ChatGPT/Claude proof remain unverified.
