# SkillSwap — DBMS & FSD project

**MySQL, Express, React, Node.js.** There is no Python runtime or Python code in this application. MySQL uses InnoDB transactions, foreign keys, unique constraints, generated columns and row locks. React is built by Vite; Express serves the frontend and API.

PunithHub is a separate existing application. Its optional gateway forwards authenticated requests to the private Node service; SkillSwap itself still owns all its business logic and MySQL data.

## Run locally

1. Install dependencies: `npm ci`.
2. For a new installation, run `powershell -ExecutionPolicy Bypass -File scripts/setup-local.ps1`. The hidden prompt provisions a separate MySQL database and app user. Never paste credentials into chat or source control.
3. Apply upgrades: `npm run db:migrate`.
4. Build: `npm run build`.
5. Start: `npm start` → `http://127.0.0.1:8790` in local demo mode.
6. Optional fictional fixtures: `node scripts/seed-demo.js`. The six demo profiles are explicitly marked `is_demo`; this command refuses production mode. Do not remove these fixtures until the owner requests the final deployment cleanup.

The existing hub can be started separately using the workspace helper `work/start-hub.mjs` from the repository root. The Node application does not start Python.

## Implemented flows

- OTP and CAPTCHA login. Local preview displays a test code; production requires Brevo/reCAPTCHA configuration. The hub-mounted version uses the verified shared hub identity and fresh project grant.
- Mandatory first-visit profile: name, private age, college, stream, year, interests, goals and preferred format. The backend gates community features until completed.
- Recommendations rank active, available offers by interests/goals, stream, college and learning format, showing the matching reasons. Age does not determine recommendations and is not public.
- Member-visible profiles, PNG/JPEG photo and up to ten shared PDF documents; each file ≤2 MB. Email and age stay private. Files are stored in MySQL, require authentication, and documents download as attachments. Members can remove their own files.
- Skill offers and non-overlapping one-hour slots; request/accept/cancel; both-party completion; one review; disputes and administrator resolution.
- Three initial credits once. Acceptance reserves one credit; settlement transfers it once. Zero available credits blocks booking. Balances stay nonnegative. Spending all starter credits without completed teaching opens a 72-hour educational video challenge. Timely submission pauses suspension pending admin review; overdue challenges suspend SkillSwap features only. Login, profile, challenge submission and existing session resolution remain accessible. Admins can approve, waive or extend by 72 hours. Videos are private to the owner and admins, MP4/WebM, maximum 12 MB.
- Administration: user suspension/restoration, offers, bulk skills for up to 100 existing members, disputes, stalled sessions, ledger reconciliation and audit activity.
- Separate hub master controls, project-specific admin portals and CSV/Excel activity exports. Skills and learning content exist in SkillSwap, not in the unrelated image/transcript apps.

## Credit/database invariants

`wallets.balance >= wallets.held_balance >= 0`. Session acceptance locks participants in stable ID order, then slot and wallet. A generated unique occupied-slot column prevents double booking; a generated pending-request column prevents duplicate requests. A unique transfer per session prevents double settlement. Grants and transfers are reconciled against wallet balances. No payment/monetary credits exist.

`sql/001-schema.sql` contains accounts, offers, availability, sessions, confirmations, holds/transfers, reviews/disputes, authentication and audit tables. `002-community.sql` adds first-visit profile attributes and private member media storage. Migration state is recorded in `schema_migrations`.

## Verification

- `npm test`: real MySQL transactional/concurrency tests, using isolated fixtures.
- `node tests/http.integration.js`: real local HTTP OTP, onboarding, profiles/media, offers, booking, review and admin checks. Requires local demo server.
- `node tests/gateway.integration.js`: local hub grant, signed identity, CSRF, onboarding and revocation checks. Requires hub and Node service.

No production deployment has been performed. Production still requires Node-capable hosting, private MySQL, HTTPS, real email/CAPTCHA configuration, backups and final test-data cleanup. Existing `.env` is private and must never be distributed.

GitHub import is owned by PunithHub, not SkillSwap. See the hub's `GITHUB_IMPORT.md` for the supported self-service contract.
