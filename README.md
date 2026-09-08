# Ledger

A prediction ledger for behavioral experiments. Not a therapist.

## What it is

Before a situation you're dreading, you write down what you expect to happen and how sure you are. Afterward, you write down what actually happened. Over time the ledger shows you the record: *predicted rejection 14 times at an average of 80% confidence; it happened twice.*

That's the whole loop — predict, check, notice the gap. Everything else in this repo exists to keep that loop honest: to fix the prediction before the outcome can rewrite it, to keep "they were only being nice" in a separate column from what actually happened, and to count the experiments you set up and never ran.

## What it is not

**Ledger is not a therapist, and it is not a treatment.** The design draws on predictive processing, a framework from cognitive science for how brains use prediction and prediction error. Predictive processing is a lens, not a validated clinical intervention, and this app does not claim otherwise. What Ledger actually delivers is old and well-studied: written behavioral experiments and exposure, under the expectancy-violation rules described by Craske et al. (2014), with an explanatory layer on top. The explanatory layer is the part that's new, and it is the part with no outcome data.

If you are in crisis, the app will show you the 988 Suicide & Crisis Lifeline and the Veterans Crisis Line (dial 988 and press 1, or text 838255). That check is hard-coded, runs before anything else on every entry, and never involves a language model. It is a pointer to help, not help.

Ledger can be used alone. Connecting a clinician is optional and requires your explicit consent, layer by layer, revocable at any time.

## How the pieces fit

| Package | What it does |
| --- | --- |
| `packages/shared` | Types, zod schemas, and every number the app shows: calibration, prior clustering, the furnace profile, the crisis rules. Pure functions. No network, no LLM. Fully unit-tested. |
| `packages/api` | Fastify server. Verifies Supabase JWTs, enforces row-level security in Postgres *and* in application code, encrypts free text at the field level, runs the sync endpoint the phone talks to, and is the only place the Anthropic API is ever called. |
| `apps/web` | **The milestone-1 client.** React + Vite PWA. Offline-first: entries land in the browser's IndexedDB and sync when there's a connection. Solo mode by default. |
| `apps/client` | Expo / React Native app. Same loop, same local-first design on SQLite. **Parked** — kept in the tree, not the client being developed. |
| `apps/clinician` | Next.js web app for a linked clinician. **Placeholder in milestone 1.** |

The language model is used for two things only: reflective prompts and a post-hoc "why" explanation at the moment of a mismatch. It never computes or influences a number shown to the user. If you find a code path where it does, that's a bug.

## Running it

Prerequisites: Node 20+, pnpm 9 (`corepack enable`), Docker (for the local Postgres used by tests), and a Supabase project (free tier is fine). The web client needs no Expo or EAS account; the parked Expo app does.

```sh
cp .env.example .env         # fill in the values; see comments in the file
pnpm install
pnpm --filter @ledger/shared test
docker compose up -d db      # local Postgres for tests + dev if you're not pointing at Supabase
pnpm db:migrate
pnpm dev:api
pnpm dev:web                 # http://localhost:5173
```

## Data handling

Read `docs/data-path.md` before deploying. The short version: no email or name is stored in the app database (Supabase Auth holds them); prediction text, journal text, prior labels, and body-state prose are encrypted per field with an app-managed key on top of at-rest encryption; the API connects as a role that is subject to row-level security; crisis events store rule identifiers, never text; and nothing that could identify a person or their entries is ever written to a log. Logging redaction is enforced in code (`packages/api/src/logging`), not by convention.

## Where the theory lives

`docs/theory-mapping.md` maps the author's framework onto the app's loop, feature by feature, and lists where the loop is *not* faithful to the theory and what a skeptical clinical reviewer will say. It's kept in the repo on purpose.

## License

Not yet chosen. This repository is private while that decision is made.
