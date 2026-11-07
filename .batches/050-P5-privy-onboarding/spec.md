# Spec: 050-P5-privy-onboarding (Privy onboarding for merchants and users)

## Problem & Context
Merchants and users visiting the WhiteFlow / Merchant Capital+ dashboard without an installed desktop browser wallet (MetaMask) are blocked from onboarding and signing in. The existing sign-in path requires an injected EIP-1193 provider (`window.ethereum`).

Per user direction, Privy (App ID `cmw57ezwm009e0gl6anp269do` and App secret) is integrated to provide seamless onboarding:
1. Email onboarding with embedded EVM wallet provisioning on Whitechain Testnet (Chain ID 1874).
2. Broad wallet connection support (WalletConnect QR, MetaMask, Coinbase, Rainbow, mobile wallets).
3. SIWE authentication and backend token verification using the Privy App ID and App Secret.
4. CSP updates on merchant routes to permit Privy's auth endpoints and iframe.

## Requirements (SRS)
- **FR-PAY-15**: Merchant wallet sign-in with verified address and session cookie.
- **FR-BIZ-6**: Testnet workspace onboarding and authentication with revocable session.
- **FR-AUTH-1**: Authenticated session establishment and principal identification.
- **FR-AUTH-2**: Session cookie issuance and secure validation.
- **DEP-3**: Privy integration for wallet and email authentication on Whitechain Testnet (1874).
- **NFR-8**: Privacy disclosures and appropriate CSP containment.

## Changes
1. **Environment**:
   - `NEXT_PUBLIC_PRIVY_APP_ID`: `cmw57ezwm009e0gl6anp269do`
   - `PRIVY_APP_ID`: `cmw57ezwm009e0gl6anp269do`
   - `PRIVY_APP_SECRET`: `privy_app_secret_...` in `.env` (git-ignored, never committed, never logged).
   - `.env.example`: Document `PRIVY_APP_ID` and `PRIVY_APP_SECRET`.
2. **CSP Configuration (`apps/web/next.config.ts`)**:
   - Update `merchantPolicy` / `/merchant/:path*` CSP to permit Privy's authentication origin (`https://auth.privy.io`) and WalletConnect relay/verify origins when Privy is enabled.
3. **Privy Configuration & Onboarding (`apps/web/lib/privy-config.ts`, `apps/web/lib/privy-session.ts`)**:
   - Configure Privy for onboarding appearance, support embedded wallet creation for users without wallets.
4. **Merchant Onboarding UI (`apps/web/components/merchant/SignIn.tsx`, `apps/web/components/merchant/PrivySignIn.tsx`)**:
   - Provide a 1-click "Sign in with Privy (Email or Wallet)" flow alongside native injected wallet SIWE.
   - When opened via Privy, the merchant signs in, their connected or embedded wallet is retrieved, and SIWE is completed to issue the authenticated `mc_session` session cookie.
5. **Backend Verification Route (`apps/web/app/api/auth/privy/route.ts`)**:
   - Server endpoint to verify Privy auth token using `PRIVY_APP_ID` and `PRIVY_APP_SECRET` against Privy REST API `https://auth.privy.io/api/v1/users/me` if signing in directly via token, issuing the `mc_session` session cookie.
6. **Tests**:
   - Update `test/csp-routes.test.mjs` and add `test/privy-onboarding.test.mjs` to verify Privy onboarding configuration, CSP, and auth routes.

