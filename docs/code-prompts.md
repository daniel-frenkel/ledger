# Prompts for Claude Code — Ledger

How this works: paste **Prompt 0** at the start of every Code session (it's the standing context). Then paste one task prompt. When Code finishes, copy its final report back to me and I'll write the next one. Don't let Code and me drift — if Code proposes a design change, bring it to me before it's built.

Migration ledger (contiguous, immutable once on main): 0000–0003 landed through Prompt 7 Part 1 · 0004 locating assistant (Prompt 7 Part 4, PR #20) · 0005 training stack (Prompt 13, PR #21) · 0006 counts_for + IMS + measures table (Prompt 14, PR #22) · 0007 account deletion, system role, tombstone (Prompt 4, PR #23) · 0008 audit/MFA/BAA (Prompt 10) · 0009 research readiness (Prompt 8) · 0010 reference assistant threads (Prompt 9). Landed: 0000–0007. Queue: 15 (rename) → 11 (GCP; project courageloop-prod, us-west1, BAA accepted 11 Sep 2026) → 2 (revised) → 8 → 9 — Prompt 10 landed as 0008. Prompt 12 is unused. Decided, not built: individually deleted entries get the same 30-day grace and purge job, children first; measures taken under an active clinician link survive a client purge (care record), measures with no link purge with the account — draw that line in Prompt 8.

---

## Prompt 0 — Session preamble (paste first, every time)

```
You are working in the repo at C:\Github\ledger (GitHub: daniel-frenkel/ledger, private). It is a pnpm monorepo for "Ledger", a prediction-ledger app for behavioral experiments built for a counseling practice. Read these before doing anything, in this order:

1. README.md
2. docs/NEXT-STEPS.md
3. docs/data-path.md
4. docs/proposal-01-layout-and-schema.md (the "Status" paragraph at the top lists what changed after approval)
5. docs/theory-mapping.md — skim; §4 and §8 matter most for product decisions

Standing rules. These are not negotiable and you do not need to ask about them:

- The app is not a therapist and never claims to be. Predictive processing is a framework, not a validated treatment. Keep that language wherever it already appears.
- No PHI in logs, ever. Free text from users never reaches a log line, an error message, a Sentry event, or a test fixture that gets printed. The test in packages/api/test/phi-logs.test.ts must keep passing.
- Every query is scoped by user_id and role at the API layer AND by row-level security. Never connect to Postgres as a role that bypasses RLS from the running API. Never weaken a policy in packages/api/src/db/migrations/0001_rls.sql; add a new migration if something must change.
- Migrations that are on main are immutable. Never edit 0000_schema.sql, 0001_rls.sql, or 0002_exit_forecast.sql. Schema changes = new migration via `pnpm db:generate`, renamed to a descriptive tag, journal updated.
- The Anthropic API is called only from packages/api/src/services/ai.ts, never from the client, and never to compute a number shown to a user.
- The crisis rules in packages/shared/src/crisis/index.ts are hard-coded and deterministic. Do not add a model, do not change a rule without adding the sentence you're changing it for to packages/shared/test/crisis.test.ts (both the must-match and must-not-match lists).
- No streaks, badges, progress bars, or engagement mechanics anywhere in the client. The vocabulary constants in packages/shared/src/vocabulary/index.ts are the words the app uses; don't introduce theory terms ("prior", "furnace", "precision", "floor") into client-facing copy.
- Do not add any third-party service, SDK, or hosted dependency not already in package.json without stopping and asking. Ordinary npm libraries are fine; anything that phones home is not.
- Work on a branch named for the task. Never commit to main. Never commit .env. Commit messages: what and why, no fluff.
- Before you say you're done: `pnpm -r typecheck`, `pnpm -r test`, and (if a Postgres is available) `pnpm --filter @ledger/api test:rls` all pass. If you can't run something, say so explicitly.

When you finish, end with a report in this exact shape so it can be relayed:

DONE: <one line>
CHANGED: <files or areas>
TESTS: <counts, and anything skipped and why>
DECISIONS: <anything you chose that wasn't specified>
OPEN: <anything blocked, uncertain, or that needs a human>
```

---

## Prompt 1 — Get milestone 1 running locally

Use this once Daniel has done steps 1–4 of NEXT-STEPS.md (merged the branch, created the Supabase project and the `ledger_api` role, and has the values for `.env`). Code can do the rest.

```
Task: get milestone 1 running on this machine and on my phone, following docs/NEXT-STEPS.md steps 5 through 13. I have already done steps 1–4.

Concretely:

1. Create .env from .env.example. I will paste the Supabase values when you ask for them — ask for them all at once, in a single list, and tell me exactly which dashboard page each one comes from. Generate FIELD_ENCRYPTION_KEY yourself and print it once so I can back it up. Do not print any other secret back to me after I paste it.
2. `corepack enable`, `pnpm install`, `pnpm --filter @ledger/shared build`, `pnpm db:migrate`. If install fails on React Native peer versions, run `npx expo install --fix` in apps/client and commit the lockfile change on a branch called fix/local-setup.
3. Run `pnpm test:rls` against the real database once and report the result. Then `pnpm --filter @ledger/api test`.
4. Start the API (`pnpm dev:api`) and confirm http://localhost:8080/health returns ok.
5. Walk me through `eas login` and `eas init` — you cannot do the login for me, so tell me the exact commands and wait. Put the project id in .env.
6. Find this PC's LAN IPv4 (ipconfig) and set EXPO_PUBLIC_API_URL to it on port 8080. Tell me if Windows Firewall needs a rule and what to click.
7. Start `pnpm dev:client` and tell me to scan the QR with Expo Go. If Metro fails to bundle, fix the cause — the most likely one is expo-notifications in Expo Go; if so, comment out that plugin line in apps/client/app.config.ts with a note, and tell me reminders are off until a dev build.
8. Stay with me through the airplane-mode test in step 12. If the sign-in code email never arrives, check the Supabase Auth → Email provider settings and the Magic Link template for {{ .Token }} and tell me what to change.

If anything in the repo is actually broken (not environment — broken), fix it on the branch, add a test if it's testable, and put it in the report.

Report in the standard shape.
```

---

## Prompt 2 — Deploy the API to Render

Use after milestone 1 works on the phone. Requires: a Render account (free tier is fine to start).

```
Task: deploy packages/api to Render as a Docker web service, so the phone can sync without my PC running.

Constraints: nothing Render-specific goes into the repo — the Dockerfile at packages/api/Dockerfile must stay portable to Cloud Run. Configuration lives in Render's environment settings, not in code. If you think a render.yaml would help, put it in a folder called deploy/render/ and keep everything in it optional.

Steps:
1. Read packages/api/Dockerfile and the root package.json. Verify the Docker build works locally if Docker is installed here (`docker build -f packages/api/Dockerfile .` from the repo root). If Docker is not installed, say so and skip; do not install it.
2. Tell me exactly what to click in Render: new Web Service → connect the GitHub repo → Docker runtime → Dockerfile path packages/api/Dockerfile → root directory is the repo root. Give me the full list of environment variables to set there, copied from .env.example with a one-line note on each, and say which ones must differ from my local .env (DATABASE_URL should be the Supabase *pooler* URL in production; NODE_ENV=production; AUTH_TEST_MODE must be absent).
3. Migrations: the container does not run them. Tell me the one-line command to run `pnpm db:migrate` from my PC against the production DATABASE_MIGRATE_URL, and add a `db:migrate:prod` script to the root package.json that requires an explicit env var so it can't be run by accident.
4. After I deploy, verify https://<my-service>.onrender.com/health from here and report the response.
5. Update EXPO_PUBLIC_API_URL in .env to the Render URL and confirm sync from the phone works with the PC's API stopped.
6. Note in docs/data-path.md, under "Open items", that Render's free tier is not covered by a BAA and this is for my own use only until that's addressed.

Report in the standard shape.
```

---

## Prompt 3 — Clinician app, first real screen

Use when Daniel wants to see his own ledger from a browser. Everything here is read-only against data the client has consented to share; the first user is Daniel linking to himself is NOT allowed by the schema (links_not_self), so this needs a second account.

```
Task: replace the placeholder in apps/clinician with the first real screen: a clinician signs in with Supabase Auth (email OTP, same as the phone), sees the list of clients who have an active link to them, and can open one client to see their ledger.

Read packages/shared/src/calibration/index.ts first — every number on the screen comes from summarizeLedger(); do not compute anything in the web app.

Data path: the web app calls the API, never Supabase directly. Add to packages/api:
- GET /v1/clinician/clients — links where I am the clinician and status is active; return client id, consented_at, and the share_* flags. No names exist in the system; show the client id short form.
- GET /v1/clinician/clients/:clientId/ledger — runs inside withUser as the clinician, reads predictions (or predictions_summary if share_predictions is false — in that case situation/expectedOutcome/actualOutcome are omitted and the response says so), priors, reinterpretations (only if share_predictions), body states (only if share_body_states), and returns summarizeLedger() output plus the raw rows the share flags permit. RLS will enforce the flags; the route should ALSO check them so the API never relies on the DB alone.
- Tests for both routes in packages/api/test/, including: no link → 404; pending link → 404; active link with share_predictions=false → no prose fields present in the response; revoked link → 404.

Web app:
- Sign-in page (email OTP).
- /clients list.
- /clients/[id]: the overall sentence, then one card per prior with the sentence, mean confidence on misses, the furnace profile as plain rows (never misses / abandonment rate / reinterpretation rate / own-part counts / exits named-taken-not taken / body survivals with and without kit), and the safe_to_test toggle wired to PATCH /v1/clinician/priors/:id (add that route; it may set safe_to_test only; the DB trigger enforces this too — test it).
- One Recharts chart: the calibration curve from summary.buckets (mean confidence on x, observed rate on y, the diagonal as reference). Nothing else charted yet.
- No PHI in the browser console, URL, or localStorage. Session token in memory/cookie as Supabase's Next.js helpers recommend.

The clinician view labels can use clinical words the client app avoids ("prior", "furnace profile") — this is the one surface where that's appropriate.

Report in the standard shape.
```

---

## Prompt 4 — Account deletion (required before anyone else uses this)

```
Task: implement account deletion end to end. docs/data-path.md describes the intended behavior under "Deletion (planned)"; make the doc true.

- DELETE /v1/me: inside withUser, soft-delete every row belonging to the user (set deleted_at) across all client tables, revoke every link where they are client or clinician, then delete the Supabase Auth user via the Admin API. This is the ONE place the service-role key is used at runtime; put it in a new env var SUPABASE_SERVICE_ROLE_KEY, document it in .env.example, and make the route refuse to run if the key is absent rather than half-deleting.
- A node-cron job that hard-deletes rows soft-deleted more than 30 days ago. Runs as the migration-level role? No — it must run as ledger_api under a system context; add an RLS policy in a NEW migration that permits DELETE on soft-deleted rows only, for a request.role of 'system', and only the job sets that role.
- Client: Settings → "Delete my account" with a typed confirmation, then wipe local storage and sign out.
- Tests: the RLS suite gets a case that a client cannot hard-delete their own live rows; the API suite gets the full flow with the Supabase Admin call mocked.
- Update docs/data-path.md → Deletion section to describe what now exists.

Report in the standard shape.
```

---

## What I will NOT hand to Code without discussing first

These are design decisions, not implementation, and should come back to me:

- Anything that changes what the client sees on the mismatch screen, the ledger sentence, or the crisis card.
- Any new field on `predictions` or `priors`.
- Any change to the crisis rules beyond adding test sentences.
- Turning on the Anthropic "why" endpoint in the client.
- Anything a clinician can *write* to a client's data beyond `safe_to_test` and clinician-origin priors.

---

## Prompt 5 — Clinician app: the Library and the floor locator (light mode)

Before you paste this, put `docs/design/floor-locator.html` (the file from this conversation) into the repo on main, or on the branch Code creates. It's the design reference Code ports from.

```
Task: build the reference side of the clinician web app — the Library (the model, the eight floors, the thirteen protocols, the references) and the Formulate floor locator — in apps/clinician. Light theme only. No client data on any of these pages.

Read first, in this order:
1. docs/theory-mapping.md — the only source for theory content and citations.
2. packages/shared/src/vocabulary/index.ts — FLOORS, PRIOR_CATEGORIES, EXIT_MOVES, FRAMING are already defined; reuse, don't duplicate.
3. docs/design/floor-locator.html — a working prototype of the locator. Its FLOORS object (lives / reach / proto / falsify per floor), its nine OBS entries with weight maps, its three gates, and its contextual warnings are the content. Its CSS tokens and typefaces are the design system for the whole clinician app.

Content rules — these matter more than the code:
- Every sentence of theory on these pages comes from docs/theory-mapping.md or docs/design/floor-locator.html. Do not write theory. Do not paraphrase into something the sources don't say. If a page needs content the sources don't contain, render a visible "Awaiting author" block and list it in OPEN.
- Do not invent citations. Build content/references.ts containing only the works cited in docs/theory-mapping.md, each with a stable key. Every content block that leans on a source cites by key. Add a test that every key referenced in content exists in references.ts, and that references.ts contains nothing that isn't in theory-mapping.md.
- The thirteen protocols are: Panic, Social anxiety, PTSD, OCD, Worry (GAD), Depression, Insomnia, Health anxiety, Chronic pain, Addiction, Prolonged grief, The self-story, Rank-reactive mood instability. Build each as a scaffold only: slug, title, target floor(s) from the locator's FLOORS.proto mapping, and empty sections headed Gates / Floor / Experiments in order / What counts as disconfirmation / Measure to track / Sources. Every empty section renders "Awaiting author." Protocol bodies are clinical content that only Daniel writes.
- The "framework, not a validated treatment" language from FRAMING appears on the model page and on the protocols index, verbatim, not softened.
- Clinician-facing pages may use the theory vocabulary (prior, precision, furnace, floor). That rule is inverted from the client app and applies only here.

Structure:
- Content lives as typed data in apps/clinician/content/*.ts (model.ts, floors.ts, protocols.ts, observations.ts, references.ts), exported with zod schemas. Pages render from data; no prose in JSX. This is so the content is testable now and readable by the assistant later.
- Routes: /library, /library/model, /library/floors, /library/floors/[n] (1–8), /library/protocols, /library/protocols/[slug], /formulate.
- /library/floors/[n] shows: what lives here, what reaches it, which protocols route here, what would falsify the placement, and the one contextual warning from the locator that applies to that floor. Floor 8 gets the substrate/advocacy warning and no protocol chips.
- /formulate ports docs/design/floor-locator.html faithfully: the SVG building with floors 1–7 stacked and floor 8 as ground; the three gates that block locating until all are checked; the nine observations with their exact weights; the same scoring (top floor lit; any floor at ≥60% of max also lit); the same warnings, including the floor-3-vs-6/7 caution; keyboard-accessible floors and ground; the footer disclaimer verbatim. Stateless this pass — nothing is saved, no client is loaded, the "Client 4a91 / Re-aim 1 of 2" header becomes a static placeholder labelled as such. Persistence and the re-aim counter come with the schema work, not now.

Design:
- Light theme, forced. color-scheme: light on the root; no prefers-color-scheme media queries; no dark tokens anywhere. Tokens exactly as in the reference file: --paper #F2F4F3, --paper-2 #E9EDEA, --ink #191D1B, --slate #4A5551, --rule #CDD4D0, --rule-soft #DFE4E1, --brass #7E5F17, --brass-soft #F0E7CF, --iron #9E3325, --iron-soft #F3E0DC.
- Typefaces: Newsreader (display), IBM Plex Sans (body), IBM Plex Mono (labels/data), loaded via next/font/google with real fallbacks. No other fonts.
- Match the reference's proportions: 74rem shell, sticky building only at ≥62rem, 17rem max building width below that. The overlap bug from the first cut of the prototype was the building being sticky in the single-column layout — don't reintroduce it.
- No charts on these pages. No analytics, no third-party scripts, no fonts from anywhere but Google Fonts.

Auth: the Library and /formulate carry no client data, so they do not need sign-in in this pass and must not import anything from the API client. When Prompt 3 lands they sit inside the signed-in shell; structure the layout so that's a wrapper change, not a rewrite.

Tests, in apps/clinician:
- floors.ts has entries 1–8 with every field non-empty; floor 8 has no protocol routes.
- Every observation's weight map references only floors 1–8; the nine observations and their weights match docs/design/floor-locator.html exactly (parse the reference file in the test, or copy the numbers into the test with a comment saying they were checked against it).
- Every protocol slug in protocols.ts is one of the thirteen; every FLOORS.proto name in the locator resolves to a protocol slug.
- Citation keys resolve (above).
- next build succeeds; pnpm -r typecheck passes.

Branch: feature/clinician-library. Report in the standard shape, and list under OPEN every "Awaiting author" block you rendered, with the page it's on.
```

---

## Prompt 6 — Fill the Library from the source documents

The 86 "Awaiting author" blocks from Prompt 5 were never missing — the documents exist in Daniel's vault. 53 files are now on disk under `docs/theory/` (untracked): 13 protocol documents, 8 floor notes, 4 formulation tools, the Clinician's Guide, the citation verification ledger, and 26 figures. This prompt ports them.

```
Task: replace every "Awaiting author" block in the clinician Library with the source documents now in docs/theory/, and add the pages those documents call for. Branch: feature/library-content, off feature/clinician-library (or main if #10 has merged).

Read first: docs/theory/ in full — protocols/ (13), floors/ (8), tools/ (4), clinicians-guide.md, citation-verification-ledger.md, figures/ (26 PNGs). Commit all of it on the branch before porting. These are Obsidian markdown: YAML frontmatter, [[wikilinks]], ![[image.png]] embeds, and callouts.

The content rule from Prompt 5 still holds and now has teeth: these documents are the text. Render them; do not summarize, restructure, soften, or "improve" them. Where a document's structure differs from the scaffold you built, the document wins.

1. Rendering pipeline. Add a build-time markdown pipeline (unified/remark/rehype are fine — ordinary libraries, nothing hosted) in apps/clinician/lib/markdown/ that: parses frontmatter; converts [[Target]] and [[Target|label]] to internal links when Target resolves to a document in docs/theory/ or a #heading in the same document, and to plain text otherwise; converts ![[name.png]] to <img> served from apps/clinician/public/theory/ (copy the 26 figures there; alt text from the frontmatter or the nearest heading); renders Obsidian callouts as aside blocks; drops nothing. Add a test that every wikilink in every source file either resolves or is listed in an expected-unresolved fixture, so a new dangling link fails the build.

2. Protocols. Delete the six-section scaffold from Prompt 5 — it was a placeholder, and the real protocols are phase-structured (Phase 0 gates → Phase 8 relapse, with "The formulation in one line" and "Pin targets"). /library/protocols/[slug] renders the document in full with a sticky in-page table of contents from its H2s. The protocols index shows each protocol's "The formulation in one line" as its summary and its target floors from the modality/locator mapping. Slugs are the filenames in docs/theory/protocols/.

3. Rank-reactive mood instability. Its source is a clinical note, not a phase-structured protocol, and it says so. Render it at its slug with the label "Clinical note" instead of "Protocol", keep its "Verification block — flagged for the standard citation pass" section visible, and route it from floor 4 (rank/mattering) — it belongs in the floor-4 protocol list, which resolves OPEN item 3 from your last report.

4. Floors. "The floor note" on /library/floors/[n] renders the full document from docs/theory/floors/ for all eight floors. Keep the existing lives/reach/falsify/warning block above it, from the locator data.

5. Tools. New route /library/tools with four pages from docs/theory/tools/: the Decision Aid, the Decision Map, the Formulation Router, and the Case Formulation one-pager. /formulate gains a line under the disclaimer: "Built from the Decision Aid" linking to it. The Decision Aid is the locator's source; if its text and the locator's nine observations disagree anywhere, report the disagreement under OPEN — do not change the locator.

6. The model page. /library/model currently renders from docs/theory-mapping.md, which is a design memo. Replace its body with docs/theory/clinicians-guide.md, which is the author's own primer. Keep the FRAMING caveat verbatim at the top.

7. Citations. references.ts expands to every work cited across docs/theory/. Cross-reference each against docs/theory/citation-verification-ledger.md: a reference the ledger verified at P1/P2/P3 renders normally with its tier; a reference the ledger does not cover renders with a visible "record not yet verified" mark. The test from Prompt 5 changes from "only what theory-mapping cites" to "every cited key exists in references.ts, and every references.ts entry carries a ledger tier or the unverified mark." Do not verify citations yourself; do not add DOIs or URLs the sources don't contain.

8. Tests, in addition to the above: every protocol slug has a source file and vice versa; all 26 figures are referenced by at least one document and every embed resolves; every floor 1–8 has a note; next build prerenders every route.

Report in the standard shape. Under OPEN, list: every wikilink that did not resolve; every disagreement between the Decision Aid and the locator; every citation rendered as unverified, with a count.
```

---

## Prompt 7 — Invites, formulations, and the locating assistant

`docs/proposal-02-links-and-formulations.md` is on disk, untracked. This is a schema change and the first PHI-to-third-party hop; the proposal is the spec and the prompt below is deliberately short because the proposal is not.

```
Task: implement docs/proposal-02-links-and-formulations.md. Read it in full first, then docs/data-path.md and packages/api/src/db/migrations/0001_rls.sql. Commit the proposal on the branch. Branch: feature/links-and-formulations.

Build order — stop and report after each part before starting the next, so mistakes in the trust model are caught before anything sits on top of them:

Part 1 — Migration 0003 and RLS. link_invites, formulations, assistant_runs; redeem_invite() SECURITY DEFINER in the app_link_allows() pattern; extend links_consent_guard so share_* are client-only and clinicians can write only status='revoked' on their own links; formulations append-only with the active-link trigger; RLS for all three tables. Do not edit 0000–0002. Run test:rls as the restricted role and add cases: clinician cannot read another clinician's invites; client cannot read link_invites at all; redemption of a used, expired, revoked, or self token all fail identically; clinician cannot set share flags; clinician cannot update or delete a formulation; clinician cannot read formulations for a client whose link is revoked. Report.

Part 2 — Routes and the join page. POST /v1/invites (create, returns the token once), GET /v1/invites (own, unredeemed), DELETE /v1/invites/:id (revoke), POST /v1/invites/redeem, POST /v1/formulations, GET /v1/clients/:clientId/formulations. Rate limits as specified. Token only ever in the URL fragment; add a test that no request log line and no error body contains a token or a token hash. apps/web /join page as specified in §4, one failure message for every failure. Report.

Part 3 — Scoring to shared, and the locator writes. Move the locator's OBS weights and scoring into packages/shared/src/floors/ with the existing FLOORS data; the clinician app imports it instead of holding its own copy, and the Prompt 5 test that checks weights against docs/design/floor-locator.html now checks the shared module. /formulate gains a client picker (active links only), the gate attestation, the required "what would falsify this" field, and "Write this formulation" posts to /v1/formulations. "Re-aim N of 2" and the on-trial state come from version. Report.

Part 4 — The assistant, shipped off. ai.ts gains locate(); strict structured output with exactly the three fields in §3 and nothing else; every evidence span validated as a substring of the note in code, observations without a valid span dropped; scoreFloors() from shared; gate questions from the fixed set. ASSISTANT_ENABLED defaults false and the route returns 503 with the specified message when false or when the key is absent. assistant_runs stores the hash and ids only. Add to the PHI-in-logs test: a locate() call with a distinctive note string, assert the string appears nowhere in logs, errors, or the assistant_runs row. Scaffold docs/theory/eval/locate-notes.md with three rows clearly marked PLACEHOLDER and the eval:locate script that reads it. Update docs/data-path.md: hop 8, the BAA open item, the no-directory note, the client-outlives-clinician line, and the formulations-not-visible-to-client decision. Report.

Rules that are easy to break here: the model never emits a floor, a number, or free text; the clinician never writes a share flag; the assistant never clears a gate; the note never appears in a log; a formulation is never updated in place.

Report in the standard shape after each part.
```

---

## Prompt 8 — Research readiness

Runs after Prompt 7 Part 1 has landed (so `formulations` exists for the FK). `docs/proposal-03-research-readiness.md` is on disk, untracked.

```
Task: implement docs/proposal-03-research-readiness.md. Read it, then docs/proposal-02 and the 0003 migration. Commit the proposal on the branch. Branch: feature/research-readiness.

Part 1 — Migration 0009 and RLS. (Note: the measures table and instrument enum already landed in 0006 with Prompt 14; extend, don't recreate.) app_version and received_at (immutable trigger) on every table the proposal names; measures, phase_events, usage_events, exports tables; research consent columns on users with column-level grant to the user only; enums exactly as listed. RLS: measures per §2, phase_events clinician-written through an active link, usage_events user-write/system-read. Tests as the restricted role: clinician cannot write research consent; clinician cannot read usage_events; client cannot write phase_events; nothing can update measures or phase_events; received_at cannot be changed. A test that usage_events has exactly the five listed columns. Report.

Part 2 — Clients set app_version and get the consent screen. apps/web and the clinician app stamp app_version from the build on every write. Client Settings → Research: text from docs/research/consent-text.md, one toggle, default off, stores research_consent_version. Withdrawal sets withdrawn_at and leaves consent_at as history. The clinician app shows nothing about research consent anywhere; add a test that no clinician route returns those columns. usage_events written for the seven kinds from the client. Report.

Part 3 — Measures and phases in the clinician app. On a client's page: "Record a measure" (instrument from the enum, total, optional subscales validated by the shared per-instrument schema, date) and, on the protocol page for that client, "Mark phase." Both append-only. Report.

Part 4 — The export. pnpm research:export as specified in §6: system role, consented-only, HMAC pseudonyms with a per-run secret printed once, per-participant date shift, allowlist in packages/api/src/research/allowlist.ts, CSV per table plus generated codebook.md, exports log row. Tests: allowlist contains no _enc column and no label/text column; output contains no column outside the allowlist; a withdrawn participant is absent; intervals within a participant survive the date shift exactly; two runs produce different pseudonyms. --dry-run prints the columns and the participant count and writes nothing. Report.

Part 5 — Documents. Write docs/research/hypotheses.md, consent-text.md, and reliability-study.md from §7 — as drafts marked for faculty and IRB review, dated, and with no claims beyond what the proposal states. Update docs/data-path.md. Report.

Report in the standard shape after each part.
```

---

## Prompt 9 — Reference assistant, metering, and Stripe

After Prompt 7 Part 4 has landed. `docs/proposal-04-assistant-and-billing.md` and `docs/theory/paper.md` are on disk, untracked. Stripe is approved under the condition in §5 — email and payment only, nothing clinical, ever.

```
Task: implement docs/proposal-04-assistant-and-billing.md. Read it, then proposal 02 and packages/api/src/services/ai.ts. Commit the proposal and docs/theory/paper.md on the branch. Branch: feature/assistant-and-billing.

Part 1 — Corpus build and ask(). Build step that assembles docs/theory/ + paper.md into the system prefix with a section index; report the token count against the 170k budget and apply the trim order from §1 if needed. ai.ts gains ask() with prompt caching, the structured output from §2, citation validation against the index with one retry then rejection, the out-of-corpus template, and the refusal fixture in docs/theory/eval/ask-questions.md (scaffold it with ten questions: six in-corpus with expected sources, two out-of-corpus, two refusals — mark all as author-review). PHI-in-logs test gains an ask() case. Also carried from Prompt 13: the clinician's training stack (modality + tier only, clinician-owned non-PHI) goes into ask()'s context with the same rule locate() already carries — never suggest a modality the stack lacks as something for them to run; where the reached floor is outside the stack, point at referral and supervision language from the corpus. Add one eval question to ask-questions.md that exercises it. Report with the token count.

Part 2 — Threads and the panel. Migration 0010: assistant_threads, assistant_messages, the assistant_runs columns from §4, subscriptions. RLS per §3 and §5. The clinician app's persistent assistant panel: preloads the current page's document as context, shows attachments in the transcript, shows the meter (runs used / allowance / period end), and the placeholder text about identifying details. Delete thread works and the 30-day job hard-deletes. Report.

Part 3 — Metering and caps. Token counts and cost_micros on every run from the versioned price table in env; the three caps with their plain messages; entitlement check in the order given in §5. Tests: a run over the daily cap writes no row and returns 503; the global cap trips; the kill switch beats everything. Report.

Part 4 — Stripe. stripe as an ordinary npm dependency (approved). Checkout, Portal, and the signature-verified idempotent webhook as the sole writer to subscriptions. Customer created with email only — add a test that the Stripe customer-create and usage-record calls carry no field but email, ids, and counts. 402 path with no run written. Lapsed clinician loses the assistant; linked clients unaffected — test it end to end through withUser as the client. docs/data-path.md: hop 9, "Stripe holds no PHI." Report.

Rules that are easy to break here: a citation that doesn't resolve is a failed response, not a warning; the assistant never sees a note or ledger prose; nothing clinical ever appears in a Stripe field; the webhook is the only writer to subscriptions; a client is never blocked by a clinician's billing state.

Report in the standard shape after each part.
```

---

## Prompt 2 (revised) — Deploy to Google Cloud Run, not Render

Replaces the original Prompt 2. Reason: the beta will hold real client data, and Google's BAA covers Cloud Run; Render's ordinary tiers are not covered. `docs/go-live-gate.md` is on disk.

```
Task: deploy packages/api to Google Cloud Run and apps/web as a static site, per docs/go-live-gate.md A3, A6, B5, B9. The Dockerfile stays portable; nothing GCP-specific enters the repo except an optional deploy/gcp/ folder.

1. Verify the Docker build locally if Docker exists; otherwise say so.
2. Give Daniel the exact console and gcloud steps: project, Artifact Registry, Cloud Run service from the image, min instances 0, the environment variables from .env.example with each one's source. FIELD_ENCRYPTION_KEY, DATABASE_URL, and the Supabase secrets go in Secret Manager and are mounted, never set as plain env. Say which values differ from local (pooler URL, NODE_ENV=production, no AUTH_TEST_MODE, ALLOW_DESTRUCTIVE_TESTS absent).
3. Add db:migrate:prod to the root package.json requiring an explicit env var, as before.
4. apps/web: build and host as static files (Firebase Hosting or Cloud Storage + Cloud CDN — your call, say why). Confirm the built app calls the API origin directly and nothing proxies through the static host; write that confirmation into docs/data-path.md under A6.
5. Set the production CORS origin in server.ts to the static site's exact origin — no wildcard, no regex.
6. After deploy: /health from here; then run the PHI-in-logs test's distinctive string through a real request and show it is absent from Cloud Logging (B9). Put the evidence (log query and empty result) in the report.
7. docs/data-path.md: replace the Render hop with Cloud Run, note Secret Manager, and mark A3/B5/B9 done with the date.

Report in the standard shape.
```

## Prompt 10 — Audit log, clinician MFA, and the clinician BAA gate

After Prompt 7 Part 1. Implements go-live-gate B1, B2, and the technical side of A1.

```
Task: implement docs/go-live-gate.md items B1, B2, and the enforcement of A1. Branch: feature/audit-mfa-baa. Migration 0008.

B1 — access_log per the gate: written inside withUser for every clinician read of client rows (predictions, predictions_summary, priors, body_states, reinterpretations, formulations, measures, phase_events) and for every research export. Append-only; only the system role reads; no content column, ever — a test asserts the column list. A second test: a clinician reading a client's ledger produces exactly one row per table touched with the right row_count.

B2 — TOTP for clinicians via Supabase Auth MFA. Enrollment screen in the clinician app; the API refuses POST /v1/invites and every clinician read of client data unless the JWT's AAL is aal2. Clients are untouched. Test: a clinician token at aal1 gets 403 on invite creation with a message that says to enroll MFA.

A1 — on users: baa_accepted_version text null, baa_accepted_at timestamptz null, writable only by the user for their own row. Clinician app shows the BAA text from docs/legal/clinician-baa.md (scaffold the file with a clear "DRAFT — replace with counsel's template" header and nothing else) on first sign-in and records acceptance. POST /v1/invites refuses with 403 when baa_accepted_version is null. Test it.

Update docs/data-path.md for all three. Report in the standard shape.
```

---

## Prompt 11 — Move production off Supabase: Cloud SQL and Identity Platform

Runs before the revised Prompt 2. Reason: Supabase's HIPAA add-on is ~$599/month; Google's BAA is free and covers Cloud SQL and Cloud Run. Supabase remains the dev/CI database. `docs/go-live-gate.md` A2 has the decision.

**Account facts, settled 11 Sept 2026 — use these literally, do not invent placeholders:**
- Organization: `courageloop.com`, id `611109317176`
- Project: `courageloop-prod` (this exact id; no digits appended)
- Billing account: `0195B9-B97371-6F379D`, paid (not trial)
- Google Cloud HIPAA BAA: accepted 11 Sept 2026 by daniel@courageloop.com, scoped to `courageloop-prod`
- Region for everything: `us-west1`
- Admin identity: daniel@courageloop.com (Workspace; also the org admin)

**Org policy warning.** This organization has Google's secure-by-default policies enforced, including `constraints/iam.allowedPolicyMemberDomains` (domain-restricted sharing). It stays enforced at the org level — that is deliberate. It blocks IAM grants to principals outside courageloop.com, which will block an `allUsers` grant on a public Cloud Run service. Do not relax it org-wide. When Prompt 2 needs public ingress, add the narrowest possible exception scoped to `courageloop-prod` only, and say so in the report. Also note: `constraints/iam.disableServiceAccountKeyCreation` is enforced, so use Workload Identity / the runtime service account rather than downloaded key files.

```
Task: make production run on Cloud SQL for PostgreSQL and Google Cloud Identity Platform in project courageloop-prod (region us-west1), with Supabase remaining the local/CI database, per docs/go-live-gate.md A2. Branch: feature/gcp-data-and-auth. No schema change; no new migration. I have created the project, attached paid billing, and accepted the HIPAA BAA; nothing else in the project exists yet, so you are specifying it from empty.

Database. Nothing in the schema, RLS, or migrations is Supabase-specific — prove it: create packages/api/src/db/rls/000_roles.sql's ledger_api role on a Cloud SQL instance, run pnpm db:migrate against it, run test:rls against it once with ALLOW_DESTRUCTIVE_TESTS scoped to its hostname, and report the 24. Connection from Cloud Run via the Cloud SQL connector or Unix socket — config only, documented in .env.example with the production form of DATABASE_URL and DATABASE_MIGRATE_URL. Give Daniel the exact console steps for the instance, written so they can be followed without judgement calls: instance id, PostgreSQL version, the smallest tier that is sane for this workload, automated backups on, point-in-time recovery on, private IP in us-west1 (note whether this needs a VPC and Private Service Access configured first, and give those steps too if so), deletion protection on, and the password handling — the ledger_api and migration passwords go in Secret Manager, never in a file. State the expected monthly cost of the choices you name.

Auth. Replace Supabase Auth with Identity Platform on both clients. The API keeps verifying JWTs by JWKS — point SUPABASE_JWKS_URL (rename to AUTH_JWKS_URL, keep the old name as a deprecated alias for one release) at Identity Platform's keys and validate issuer and audience. Sign-in stays email-only for clients: use Identity Platform's email sign-in; if it cannot deliver a six-digit code (it does email links), implement the link flow and make sure the link lands on /auth/callback in apps/web and carries nothing but the token. TOTP MFA for clinicians through Identity Platform's MFA, satisfying go-live-gate B2 — Prompt 10's aal2 check becomes a check on the Identity Platform MFA claim. The users table's id remains the auth provider's uid; document that existing Supabase-era test users will not carry over and that's fine because no real user exists yet.

Email. Identity Platform sends its own sign-in emails by default; confirm whether that path is covered under the BAA. If it is not, configure a custom SMTP provider that signs a BAA (go-live-gate A4) and remove every trace of the Gmail SMTP test setup.

Keep Supabase working for local and CI: the code path must be identical, with only env values differing. A test that boots the API with the Identity Platform JWKS config and verifies a token from a fixture key.

docs/data-path.md: replace the Supabase hops with Cloud SQL and Identity Platform; note Supabase as dev-only; mark A2 with the date. docs/NEXT-STEPS.md: the production section.

Report in the standard shape, with the test:rls result on Cloud SQL, the monthly cost estimate, and a single ordered checklist of every console action Daniel must take, each one a click path he can follow without deciding anything.
```

---

## Prompt 12 — Beta mode: no PHI anywhere

Runs after Prompt 6 and before Prompt 7. `docs/proposal-05-beta-without-phi.md` is on disk. This reshapes what Prompt 7 builds; read §3 there.

```
Task: implement docs/proposal-05-beta-without-phi.md. Branch: feature/beta-mode. No migration except the formulations shape noted below.

Part 1 — Client app local-only. Build flag SYNC_ENABLED (default false for now): when false, apps/web has no sign-in, no outbox, no API client in the bundle (tree-shaken, verify in the build output), and no network request after the shell loads — add a test that intercepts fetch and asserts zero calls during a full write → resolve → ledger sequence. Export/import: one file, AES-256-GCM with a key derived from a user passphrase by scrypt or argon2id (ordinary library), containing all IndexedDB stores; import replaces or merges with a clear choice; wrong passphrase is a plain message. Tests: round-trip equality; a tampered file is rejected. Settings copy per §1, including the lost-passphrase warning. The crisis gate is unchanged — re-run its test.

Part 2 — Clinician app without clients. CLIENT_LINKING_ENABLED=false: invite, link, client-list, measures, phase, and research routes return 404; the clinician app shows none of them. Formulations get a case_label column (text, ≤ 40 chars) and lose the note for beta: note_enc becomes nullable, and the API refuses a non-null note when CLIENT_LINKING_ENABLED is false. client_id and link_id become nullable and must be null in beta. A deterministic label check in packages/shared/src/labels/ rejects anything matching a name-like pattern (two capitalised words), an email, a phone number, or a date, with must-reject and must-accept fixtures. Placeholder text and the one-sentence rule from §2 on the label field. The re-aim counter works per (clinician_id, case_label).

Part 3 — Terms and copy. docs/legal/privacy-client.md and docs/legal/beta-terms-clinician.md drafted from §4, each headed "DRAFT — counsel review required". Client app: privacy text reachable from Settings. Clinician app: beta terms accepted on first sign-in, version recorded on the user row (reuse the baa_accepted_* columns from Prompt 10 if present, else add beta_terms_accepted_version/at). docs/data-path.md: a "Beta" section stating that no client data exists server-side and listing what does (clinician email, formulations by case label).

Report in the standard shape.
```

---

## Prompt 13 — The training stack and the scope gate

After Prompt 7 Part 3 (formulations exist). `docs/theory/tools/training-stack.md` is on disk, untracked — the tiers, the reading rules, and the three brandless layers, with one worked example stack. No PHI anywhere in this feature.

```
Task: build "Your stack" in the clinician app and hook it into Formulate as a scope gate. Branch: feature/training-stack. Migration 0005.

Read first: docs/theory/tools/training-stack.md (the tiers and rules), docs/theory/modalities.md (home floors per modality — the coverage source), and the Formulate result panel.

Data. clinician_stacks (clinician_id, modality_slug, tier enum: literacy | fluent | deep | master (four tiers, matching the doc; "Working literacy / Conversant" is one tier), updated_at; PK on clinician_id + modality_slug) and stack_goals (clinician_id, modality_slug, target_tier, target_by date null, done_at null; no note column). Modality slugs come from the modalities content module; a slug not in it is rejected. RLS: the clinician reads and writes their own rows; nothing else reads them; clients cannot see the tables exist. Tests for all of that as the restricted role.

Coverage. In packages/shared/src/stack/: coverage(stack, modalities) → for each floor 1–8, the highest tier reaching it and which modalities reach it, using the home-floors column exactly as the modalities module encodes it (ranges and qualifiers preserved: "6–7" reaches both; "conditions" and "change process" reach no floor and are shown as the dimmer layer instead). A floor reached at fluent or above is "in stack"; at deep or master, "specialist"; at literacy, "literacy"; unreached, "gap". Unit-tested with the worked example from the doc, whose expected coverage you derive from the table and write into the test.

Screen /stack. One row per modality from the modalities module, a tier selector per row (blank = not in stack), and the building from /formulate re-used with floors shaded by coverage level; the dimmer layer shown under the building as its own row. The reading rules render as guidance beside the selectors, and the app warns (does not block) on more than one Master or more than one Deep. Under the building: "Self-declared. Not a credential. Never shown to clients." verbatim. A "Roadmap" tab lists stack_goals with a done checkbox and date; no free text.

Scope gate in Formulate. When a formulation's floor is reached only at literacy or is a gap, the result panel shows, above the protocol chips: "Floor N is outside your stack at this tier — refer, co-treat, or supervise." It annotates only; "Write this formulation" still works, and the formulation row gets a boolean outside_stack recorded at write time so a later view knows the clinician was told. Test: a fixture stack and a floor-6 formulation produce the line; a fluent floor-6 stack does not.

Assistant. The stack (modality + tier only) may be included in locate() and ask() context as clinician-owned, non-PHI data. Add a rule to both system prompts: never suggest a modality the clinician's stack lacks as something for them to run; when the reached floor is outside the stack, point at referral and supervision language from the corpus instead. Add one eval question for each assistant that exercises this.

Copy: the clinical UI never uses the phrase "full-stack therapist"; that is marketing.

Report in the standard shape.
```

---

## Prompt 14 — "How much does this one count?" and the IMS

`docs/proposal-06-counts-for.md` is on disk. Proposal 03's measures enum now includes `ims`. This is a field on `predictions`, so it runs on its own branch and touches the client resolve screen.

```
Task: implement docs/proposal-06-counts-for.md, including the full eleven-instrument measures table from proposal 03 §2 with `ims` in the enum (only IMS is wired in this prompt; Prompt 8 wires the rest). Branch: feature/counts-for-ims. Migration 0006, additive; rebuild predictions_summary with DROP/CREATE as 0002 did, adding counts_for.

1. Schema and shared: predictions.counts_for smallint null, check 0–100. Zod: optional integer 0–100, only permitted when outcomeVerdict is miss or partial (refine). Codec both directions. IndexedDB store version bump with a migration that leaves existing rows null. Sync carries it.
2. Calibration: discountRate() and the discount block on summarizeLedger() exactly per §"What is computed"; ledger sentence clause only when answered ≥ 3; shouldRouteToClinician() gains the discounted-loud-miss case; isLoudMiss unchanged — add a test that proves it unchanged. Fixtures: three misses at 100/50/0 → rate 50, dismissed 1; null answers excluded from the mean and the count.
3. apps/web resolve screen: the question appears after surprise and before the reinterpretation text, only for miss/partial, with the exact label and hint from the proposal, 0–100 in tens, skippable. Client copy test: the vocabulary check must not find "immunization", "prior", "furnace", or "reinterpret" on the screen.
4. Clinician view: the discount rate and dismissed count appear as rows in the furnace profile block, labelled "Discount rate" and "Dismissed misses". (Blocked until Prompt 3 builds that view; carried there.)
5. Research: counts_for added to the export allowlist (blocked until Prompt 8 builds the export module; carried there); ims added to the instrument enum with the three subscale keys (negative_expectations, assimilation, cognitive_immunization) in the per-instrument subscale schema. Do not include any IMS item text anywhere.
6. docs/proposal-01 Status paragraph: note the new column. docs/data-path.md: counts_for is structured, no prose, included in predictions_summary.

Report in the standard shape.
```

---

## Prompt 15 — Rename to CourageLoop

The product name is **CourageLoop** (one word, capital C and L). Domain bought: courageloop.com. Ledger stays the name of the client-facing module inside it. The repo, the `@ledger/*` package scope, and every table, column, and migration name stay exactly as they are — this prompt renames what a human reads, nothing a machine depends on.

```
Task: rename the product to CourageLoop in user-facing text and settle the production hostnames. Branch: feature/rename-courageloop. No migration. No schema change. No package or directory renames.

Spelling, everywhere, without exception: CourageLoop. Not Courageloop, not Courage Loop, not COURAGELOOP. Add a test that greps the repo for the wrong casings in .md, .ts, .tsx and fails on a hit, excluding docs/theory/ (the theory corpus is about the model, not the product) and this prompt's own text.

What changes:
1. README.md — the product is CourageLoop; Ledger is the client-facing module. Keep the honesty paragraph exactly as it stands: predictive processing is a framework, not a validated treatment; the app delivers behavioral experiments and exposure with an explanatory layer; it is not a therapist.
2. The clinician app: <title>, any header or nav wordmark, the sign-in screen, and the invite copy the clinician sends. apps/web: <title>, the /join screen, the PWA manifest name and short_name.
3. docs/go-live-gate.md and docs/data-path.md: replace every placeholder hostname with the real ones below.
4. .env.example: the three origins below, with a comment that the CORS allowlist is these exact origins and never a wildcard.

Hostnames of record:
- courageloop.com — the public site and the clinician app (apex; www redirects to apex)
- app.courageloop.com — the client PWA, the /join target
- api.courageloop.com — the API

CORS: exactly those origins for the API, from config, no wildcard, and a test that asserts the allowlist rejects an origin not on it.

Do not touch: the repo name, the @ledger/* scope, directory names, table or column names, migration filenames, the ledger_api Postgres role, the database name, DATABASE_URL, or anything in docs/theory/. Those are identifiers; renaming them needs a migration and this prompt has none.

The rule for the ambiguous cases, since "Ledger" does three jobs in this tree:
- **Product name → rename.** Anywhere a human reads it as the name of the thing they are using: the H1, page titles, wordmarks, notification titles, the invite copy, the PWA manifest. The client never sees the word "Ledger" as a product name — a client who was sent a CourageLoop link should not have to learn a second name. These become CourageLoop.
- **Common noun → keep.** "your ledger", "the ledger screen", "a prediction ledger for behavioral experiments". Lowercase, meaning the record itself. Untouched.
- **Identifier → keep.** summarizeLedger, @ledger/*, ledger_api, file and directory names. Untouched.

One special case, called out because it is safety copy: the CrisisCard disclaimer currently reads "Ledger is a notebook, not a therapist." The subject there is the product the client is holding, so it becomes "CourageLoop is a notebook, not a therapist." Quote the final string of every crisis-copy change in your report so I can read them as shipped.

Report in the standard shape, with the list of files changed and the name-casing test's name.
```
