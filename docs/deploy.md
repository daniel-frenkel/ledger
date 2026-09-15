# Deploying — Cloud Run, the static site, and the verification job

Go-live gate A3, A6, B5, B9, and the A2 verification carried from Prompt 11.
Read [`gcp-setup.md`](gcp-setup.md) first; this assumes the project, the Cloud
SQL instance and Identity Platform already exist.

Everything here is a console or `gcloud` action. Nothing in the repository is
GCP-specific except this document: the image is portable, and the Cloud Run
specifics are environment variables and a Secret Manager binding set at deploy
time.

**Hostnames of record.** `courageloop.com` — public site and clinician app ·
`app.courageloop.com` — client PWA · `api.courageloop.com` — the API.

## Which of these commands have actually been run

**Almost none of them.** Every command below was written carefully and, with
the exceptions listed, has never been executed. Four failed on first contact
in a single evening — the missing quota project on the Admin API calls, the
`\` continuations in PowerShell, `gcloud builds submit --file` (not a flag
that exists), and §1 omitting both the Cloud Build enablement and the service
account the build runs as.

That is the written/configured/verified vocabulary from
[`go-live-gate.md`](go-live-gate.md) applied to this runbook, and the honest
state is:

| | Status |
|---|---|
| §1, and `deploy/gcp/cloudbuild.api.yaml` | **verified 14 Sept 2026** — `api:9ec4cea` built and pushed |
| §3, the service account | **verified 15 Sept 2026** — `api-runtime`, three roles, nothing else |
| §7, public ingress | **deferred** — not a prerequisite; §4 deploys private |
| Everything else in this document | **written, not executed** |
| `packages/api/scripts/verify-cloudsql.sh` (§6) | **written**; its four refusal guards were exercised locally, the script as a whole never was |
| `deploy/gcp/cloudbuild.verify.yaml` | **written**; it parses, it has never been submitted |
| `gcp-setup.md` steps 1–5, 7 | **configured** — done in the console |
| The Identity Platform MFA `PATCH` and the config `GET` | **verified** — both run, output recorded |

**Treat an unexecuted command as a draft.** If one fails, the first question is
whether the command is wrong, not whether the project is misconfigured — that
has been the answer four times out of four so far. Report the failure and the
document gets fixed; do not work around it silently, because the next person
inherits the workaround and not the reason.

## Run this from Git Bash or WSL, not PowerShell

Every command below is `sh` — twenty-four of them, and six sections' worth use
`\` at the end of a line to continue onto the next.

**`\` is not a line continuation in PowerShell. The backtick is.** Paste one of
these into PowerShell and it does not fail cleanly as "wrong shell": the first
line runs on its own, truncated, and the remainder arrives as a separate
command with a parse error. A `gcloud run deploy` missing most of its flags is
a deploy, not an error message.

So: **Git Bash** — it ships with Git for Windows, which is already installed
here — or **WSL**. Then every command works verbatim and nobody hand-translates
twenty-four of them into a production change.

If this gets ignored, the symptom is a `ParserError` or an unexpected-token
complaint naming a `\`. That is this paragraph.

**The exceptions, already PowerShell and meant to stay that way:** the Admin
API calls in [`gcp-setup.md`](gcp-setup.md) and the config `GET` in
[`go-live-gate.md`](go-live-gate.md). Those are written for PowerShell
deliberately — `Invoke-RestMethod` with a headers hashtable is the clearer form
on Windows, and they carry no `\` continuations. **Do not convert either
document to match the other.**

---

## 1. Artifact Registry, and the build — VERIFIED 14 September 2026

**Executed, not merely written.** `api:9ec4cea` is in Artifact Registry, built
through `deploy/gcp/cloudbuild.api.yaml` with the `build-runner` service
account. The first thing in either runbook to earn that word by running rather
than by being read.

Two things it needed that this section did not mention. Both are **steps**,
not troubleshooting — a runbook that omits them fails for the next person
exactly as it failed for the first.

```sh
gcloud config set project courageloop-prod

# Cloud Build is not enabled by default. gcloud prompts; enabling is benign.
gcloud services enable cloudbuild.googleapis.com

gcloud artifacts repositories create courageloop \
  --repository-format=docker --location=us-west1 \
  --description="API images"

# The build runs as a service account, and the compute default one has no
# permissions for this. It fails on the first submit — not at push time — with
# a permissions error naming an account nobody chose.
gcloud iam service-accounts create build-runner --display-name="Cloud Build runner"

BR=build-runner@courageloop-prod.iam.gserviceaccount.com

# Three roles, one per thing the build actually does:
#   write its logs  — required, because both configs set CLOUD_LOGGING_ONLY
#   push the image  — to the repository created above
#   read the source — the uploaded directory lands in a staging bucket
gcloud projects add-iam-policy-binding courageloop-prod \
  --member="serviceAccount:$BR" --role=roles/logging.logWriter
gcloud projects add-iam-policy-binding courageloop-prod \
  --member="serviceAccount:$BR" --role=roles/artifactregistry.writer
gcloud projects add-iam-policy-binding courageloop-prod \
  --member="serviceAccount:$BR" --role=roles/storage.objectViewer

# From the repo root, and through a build config rather than --tag. See below.
gcloud builds submit \
  --region=us-west1 \
  --config=deploy/gcp/cloudbuild.api.yaml \
  --substitutions=_TAG=$(git rev-parse --short HEAD) \
  --service-account="projects/courageloop-prod/serviceAccounts/$BR" \
  .
```

> **Confirm the three roles against what was actually granted.** These are the
> three this build requires, and why, reconstructed from what it does. If the
> set that worked differed, correct the list to match it — the point of the
> section is that someone else can reproduce the build, and a plausible list
> is not the same as the one that ran.

**Why a config and not `--tag`, stated here so nobody reintroduces it.**
`gcloud builds submit --tag` requires a Dockerfile at the **root** of the
uploaded source, and **there is no `--file` flag** to point it elsewhere —
passing one fails with *"unrecognized arguments: --file"*. Ours lives at
`packages/api/Dockerfile` and needs the repo root as its context, because the
image copies `docs/theory` and `docs/legal`. Dockerfile not at the root,
context at the root: that combination is what a build config is for. Same
reason §6 needs one.

`deploy/gcp/cloudbuild.api.yaml` builds the **default** stage — no `--target`,
because the Dockerfile puts `verify` before the runtime stage precisely so the
default is the server.

**The tag is passed in.** `$SHORT_SHA` is not available to a config run this
way: Cloud Build populates it only when the source comes from a connected
repository, and `builds submit` uploads a local directory. `_TAG` has no
default, so forgetting it fails the build rather than quietly producing an
image nobody can tie to a commit.

Tag with the commit, never `latest`: a revision should name the code it is
running, and `latest` makes "which build is live" unanswerable at the moment
you most need to answer it.

### What the image carries, and why it is not obvious

The API reads two directories from disk at runtime, and both are in the image
because of it:

- **`docs/theory/`** — the locating assistant's system prompt is assembled from
  the corpus rather than copied into `src/`, so it cannot drift from the
  document a clinician could be shown. With `ASSISTANT_ENABLED` the server
  calls `assertCorpusAvailable()` at boot, so an image without it fails to
  start rather than building a truncated prompt on the first real note.
- **`docs/legal/`** — the clinician BAA's frontmatter is the only source of the
  version anyone accepts. Without it the two BAA routes answer 503 and the rest
  of the API carries on.

`ENV DOCS_ROOT=/app` is what makes them findable. Both readers used to walk up
for `pnpm-workspace.yaml`, which exists in a checkout and not in a container,
so the walk reached `/` and gave up — the files would have been present and
unreachable. `packages/api/test/image-contents.test.ts` fails if any of those
three lines leaves the Dockerfile.

## 2. Secrets

Everything that would be a credential in a `.env` goes in Secret Manager and is
referenced by the service. None of it is ever a plain environment variable on
the revision, where it is readable by anyone with console view access.

### 2.1 — First: back up FIELD_ENCRYPTION_KEY, before it is a secret

**This is a precondition, not an afterthought, and it is gate A9.**

`FIELD_ENCRYPTION_KEY` decrypts every journal entry, prediction, prior label
and body-state note in the database. It is the one value in this system that
cannot be regenerated: lose it and all of that prose is still in the database
and permanently unreadable. Database backups do not help — they hold the same
ciphertext.

So, in this order:

1. Generate the key **outside this project**, on a machine you control.
2. Store it somewhere that is neither this Google project nor this repository —
   a password manager, or paper in a safe. Somewhere that survives losing
   access to the project, because that is one of the cases this protects
   against.
3. **Read it back from that store once** and check it against what you
   generated. An untested backup is not a backup, and this is the one value
   where finding out later is finding out too late.
4. Only then create the secret version.

This document does not generate the key, print it, or carry it in an example.
The value never appears in this repository, in a fixture, or in anything a
transcript could capture.

### 2.2 — Then the secret versions

**Do not run this until the password check in [`gcp-setup.md`](gcp-setup.md) §3
has passed.** Both connection strings below embed a password into a URI, and a
password containing `/`, `+`, `@`, `:`, `#`, `?` or `%` does not survive that.
The failure arrives at deploy or on the first query as an authentication or
host error, pointing at the database or the socket rather than at the
encoding. `rand -hex 24` makes them URI-safe by construction; anything created
before that section said so needs checking first.

**The two URLs are built from secrets that already exist.** Read them back
rather than asking anyone to remember a password from three days ago — the
value is in Secret Manager, which is the point of Secret Manager.

```sh
API_PW="$(gcloud secrets versions access latest --secret=ledger-api-password)"
OWNER_PW="$(gcloud secrets versions access latest --secret=db-owner-password)"
INST=courageloop-prod:us-west1:courageloop-db

# The key from 2.1, pasted from your backup — not generated here.
gcloud secrets create field-encryption-key --data-file=-

printf '%s' "postgresql://ledger_api:${API_PW}@/ledger?host=/cloudsql/${INST}" | \
  gcloud secrets create database-url --data-file=-

printf '%s' "postgresql://postgres:${OWNER_PW}@/ledger?host=/cloudsql/${INST}" | \
  gcloud secrets create database-migrate-url --data-file=-
```

`printf '%s'` rather than `echo`, because `echo` appends a newline and a
trailing newline inside a connection string is a connection failure whose
message will not mention newlines.

#### The same thing in PowerShell

The preamble says run this runbook from Git Bash, and the `sh` form above is
the primary one. This exists because secrets handling is where people deviate
— pasting from a password manager, working in the shell they already have
open — and the obvious PowerShell translation is wrong in a way that does not
announce itself.

**`$value | gcloud secrets create X --data-file=-` appends a newline.** The
secret is then one byte longer than the password, every use of it fails
authentication, and nothing in the error says so.

```powershell
$inst = 'courageloop-prod:us-west1:courageloop-db'
$apiPw = (gcloud secrets versions access latest --secret=ledger-api-password).Trim()
$ownerPw = (gcloud secrets versions access latest --secret=db-owner-password).Trim()

function New-SecretFromString([string]$Name, [string]$Value) {
  $tmp = [System.IO.Path]::GetTempFileName()
  try {
    # WriteAllText: UTF-8 with no BOM, and no trailing newline. Set-Content and
    # Out-File both add one, and a BOM would sit at the front of the secret.
    [System.IO.File]::WriteAllText($tmp, $Value)
    gcloud secrets create $Name --data-file=$tmp
  } finally {
    Remove-Item $tmp -Force -ErrorAction SilentlyContinue
  }
}

New-SecretFromString 'database-url'         "postgresql://ledger_api:$apiPw@/ledger?host=/cloudsql/$inst"
New-SecretFromString 'database-migrate-url' "postgresql://postgres:$ownerPw@/ledger?host=/cloudsql/$inst"
```

**Why a temp file rather than a pipe, since the tradeoff is real.** PowerShell
has no reliable way to pipe a string to a native process without a trailing
newline — `Write-Output -NoNewline` does not survive the boundary. So the
choice is a byte-wrong secret or a file that exists briefly. The file is the
lesser harm and its cost is nameable: **the value touches disk in the user
temp directory for the length of one `gcloud` call**, in a `finally` so it is
removed even if the call throws. On a machine where that is not acceptable,
use Git Bash and the `sh` form, which never writes the value anywhere.

`.Trim()` on the values read back is safe **because the passwords are hex** —
`0–9a–f` cannot contain meaningful leading or trailing whitespace. It would not
be safe for an arbitrary password, which is one more reason the alphabet is
fixed in `gcp-setup.md` §3.

Neither form prints a password. `gcloud secrets create` echoes the resource
name, never the payload.

`db-owner-password` and `ledger-api-password` already exist from
`gcp-setup.md` §3; the two URLs above read them rather than restating them.

## 3. The service account — VERIFIED 15 September 2026

`api-runtime` exists with exactly three roles — `cloudsql.client`,
`secretmanager.secretAccessor`, `identitytoolkit.admin` — and nothing else.
Executed and confirmed against the project IAM policy.

One service account for the API, with exactly what it needs:

```sh
gcloud iam service-accounts create api-runtime --display-name="API runtime"

SA=api-runtime@courageloop-prod.iam.gserviceaccount.com

gcloud projects add-iam-policy-binding courageloop-prod \
  --member="serviceAccount:$SA" --role=roles/cloudsql.client
gcloud projects add-iam-policy-binding courageloop-prod \
  --member="serviceAccount:$SA" --role=roles/secretmanager.secretAccessor
# Deleting an auth user when someone deletes their account.
gcloud projects add-iam-policy-binding courageloop-prod \
  --member="serviceAccount:$SA" --role=roles/identitytoolkit.admin
```

No key is downloaded, and none can be:
`constraints/iam.disableServiceAccountKeyCreation` is enforced. The API's
Identity Platform calls take their token from the metadata server of the
running revision, which is why that works and why it is better than the
long-lived key it replaces.

## 4. Deploy the service

```sh
gcloud run deploy api \
  --region=us-west1 \
  --image=us-west1-docker.pkg.dev/courageloop-prod/courageloop/api:COMMIT \
  --service-account="$SA" \
  --min-instances=0 --max-instances=4 \
  --add-cloudsql-instances=courageloop-prod:us-west1:courageloop-db \
  --set-env-vars=NODE_ENV=production,AUTH_PROVIDER=identity-platform,GCP_PROJECT_ID=courageloop-prod,DOCS_ROOT=/app,ASSISTANT_ENABLED=false,JOBS_ENABLED=true,CORS_ORIGINS=https://courageloop.com\,https://app.courageloop.com\,https://api.courageloop.com \
  --set-secrets=DATABASE_URL=database-url:latest,DATABASE_MIGRATE_URL=database-migrate-url:latest,FIELD_ENCRYPTION_KEY=field-encryption-key:latest \
  --no-allow-unauthenticated
```

`--no-allow-unauthenticated` for now; step 7 is what makes it public, and it
needs an org-policy exception first.

### The environment, and where each value comes from

| Variable | Source | Differs from local |
|---|---|---|
| `NODE_ENV` | literal `production` | local is `development` |
| `AUTH_PROVIDER` | literal `identity-platform` | local is `supabase` |
| `GCP_PROJECT_ID` | literal `courageloop-prod` | unset locally |
| `DOCS_ROOT` | literal `/app` | unset locally — the walk finds the checkout |
| `CORS_ORIGINS` | the three hostnames of record | local adds `localhost` automatically, outside production only |
| `DATABASE_URL` | Secret `database-url` | local points at Docker or Supabase, over TCP not a socket |
| `DATABASE_MIGRATE_URL` | Secret `database-migrate-url` | as above |
| `FIELD_ENCRYPTION_KEY` | Secret `field-encryption-key` | local is a throwaway in `.env` |
| `ASSISTANT_ENABLED` | literal `false` | ships off, and stays off until gate A5 |
| `AUTH_TEST_MODE` | **absent** | config refuses to boot with it in production |
| `ALLOW_DESTRUCTIVE_TESTS` | **absent** | test-only, and never set anywhere near this |
| `SUPABASE_*` | **absent** | the provider is Identity Platform here |

`AUTH_TEST_MODE` is not merely unset by convention — `config.ts` raises a
configuration error if it is on with `NODE_ENV=production`, so a revision that
carried it would fail to start.

## 5. Migrations

Run once against the new instance, before the first request that needs a table:

```sh
CONFIRM_MIGRATE_HOST=/cloudsql/courageloop-prod:us-west1:courageloop-db \
  pnpm db:migrate:prod
```

It refuses unless `CONFIRM_MIGRATE_HOST` names the host in the connection
string. A hostname rather than a boolean, for the same reason
`ALLOW_DESTRUCTIVE_TESTS` is one: a `1` left in a shell profile goes on
authorising whatever the connection string points at next, while a hostname
stops being true the moment the target changes.

This runs from wherever can reach the instance — in practice the same place as
step 6.

## 6. The Cloud SQL verification job — gate A2

**Carried from Prompt 11, which could not run it.** The instance is private-IP
only (`10.83.0.3`), the Cloud SQL Auth Proxy has to be on a resource with
access to the instance's VPC, and `constraints/sql.restrictPublicIp` is
enforced org-wide and stays enforced. So the verification runs inside the VPC,
as a job, executing the script unchanged.

First the connector, on the network the instance peers to:

```sh
gcloud compute networks vpc-access connectors create courageloop-vpc \
  --region=us-west1 --network=default --range=10.8.0.0/28
```

Then a **separate image**. The runtime image cannot do this: it has no `pnpm`,
no vitest, no test files and no `psql`, and giving it any of those to save a
build target would mean shipping a test runner to production. The Dockerfile
has a `verify` target that carries the full workspace, the dev dependencies and
a Postgres client, placed before the runtime stage so that the default build is
still the server.

`gcloud builds submit --tag` always builds the final stage, so selecting a
target needs a build config — `deploy/gcp/cloudbuild.verify.yaml` is that file:

```sh
gcloud builds submit --region=us-west1 \
  --config=deploy/gcp/cloudbuild.verify.yaml \
  --substitutions=_TAG=$(git rev-parse --short HEAD) \
  .
```

Then the job:

```sh
gcloud run jobs create verify-cloudsql \
  --region=us-west1 \
  --image=us-west1-docker.pkg.dev/courageloop-prod/courageloop/verify:COMMIT \
  --service-account="$SA" \
  --vpc-connector=courageloop-vpc \
  --set-env-vars=CLOUDSQL_HOST=10.83.0.3,CLOUDSQL_INSTANCE=courageloop-prod:us-west1:courageloop-db \
  --set-secrets=PGPASSWORD_OWNER=db-owner-password:latest,PGPASSWORD_API=ledger-api-password:latest \
  --task-timeout=15m

gcloud run jobs execute verify-cloudsql --region=us-west1 --wait
gcloud run jobs executions logs read --region=us-west1 EXECUTION_NAME
```

The passwords come from Secret Manager; Cloud Run resolves the versions and
injects them, so the value never exists in a file, an argument or a shell
history. Every refusal the script already has is unchanged: a host outside
`courageloop-prod`, anything resembling Supabase, a missing password, and no
password or connection string printed at any point.

**Why this is better than the laptop path**, not merely a substitute for it: it
is repeatable on every schema change rather than something one person did once
from a machine nobody else has; it never needs a public IP, so the org policy
stays untouched; and it runs as the same service account the API uses against
the same private endpoint, so what it proves is what production does. A proxy
on a laptop proves a laptop could connect.

**Gate A2 closes on the case count this prints, and on nothing else.** CI
already runs the RLS suite against vanilla PostgreSQL on every push, so the
schema's portability is largely established — what this adds is that role
creation, the migrations and RLS behave on Google's build. A local-Postgres run
is not evidence for this gate; it proves the SQL, not this instance.


## 7. Public ingress — turning domain-restricted sharing off for one project

> **Deferred, and NOT a prerequisite for anything above.** §4 deploys with
> `--no-allow-unauthenticated`, so the service comes up private and works. The
> API is reachable by the deploy itself, by the verification job, and by
> anything with credentials. Public ingress is a later step and nothing in
> §1–§6 waits on it. Do not stall here.

A public Cloud Run service needs an `allUsers` invoker binding, and
`constraints/iam.allowedPolicyMemberDomains` (domain-restricted sharing, DRS)
will refuse it. **The org policy stays as it is.** Whatever is done, is done to
this one project.

### What this actually does — it is not a narrow exception

This section used to describe adding a rule that allows `allUsers` for
`courageloop-prod`. **That mechanism does not exist**, and the honest
description is wider:

> **There is no value of `iam.allowedPolicyMemberDomains` that permits
> `allUsers`.** Google's documentation is explicit — *"Adding exceptions is
> only possible if you're using custom organization policies to implement
> domain restricted sharing"*, and of the legacy constraint, *"This constraint
> doesn't let you configure exceptions for specific principals."*

The console's own description — that `allowed_values` may contain
"organization principal sets" — is about *which organisations'* identities are
allowed. It is adjacent to the question and does not answer it: a principal set
names an organisation, and `allUsers` is not one.

So the only thing the managed constraint can do at project scope is **stop
being enforced there**. That is what permits the binding, and it means:

**§7 removes domain restriction from `courageloop-prod`. It does not add a
public-access exception.** Inside that project, any identity can be added to an
IAM policy — not only `courageloop.com`. That is a wider change than a narrow
exception and it must not be written up as one.

### The residual, and what compensates for it

The residual is real: within this one project, nothing stops an IAM binding to
an outside identity.

What makes it acceptable rather than merely tolerable:

- **The org policy is untouched everywhere else.** Every other project in the
  organisation — the seven in the inventory above, and anything created later —
  keeps DRS enforced. This is one node, chosen.
- **The project holds exactly one public binding, by design**: `allUsers` as
  `run.invoker` on the two app services. Everything else in it is a service
  account this repository creates and `docs/deploy.md` §3 lists.
- **Nothing in the project relies on DRS for its security.** What protects data
  here is the bearer token on every request, RLS in Postgres, and the
  issuer-and-audience check — not who may appear in an IAM policy. DRS was
  never load-bearing for this design; it is defence in depth that this one
  project gives up.

### What would change this

**Move to a custom organization policy with a CEL exception** if any of these
becomes true:

- A second person gets IAM access to `courageloop-prod`.
- The project starts holding bindings beyond the one public invoker and our own
  service accounts.
- A security questionnaire asks what restricts identities in the project that
  serves PHI — "nothing, by configuration" is a true answer and a bad one to
  give.

The custom path uses `iam.managed.allowedPolicyMembers` or a custom constraint
with `MemberSubjectMatches(member, ['allUsers', 'allAuthenticatedUsers'])`
alongside `MemberInPrincipalSet`, which permits **our domain plus those two
principals specifically** — genuinely the narrow exception this section
originally claimed.

**It is not free, and one part is undocumented.** Google says *"In most cases,
you should use the `iam.managed.allowedPolicyMembers` managed constraint
instead of using a custom organization policy"*, but **the documentation does
not state what happens when a custom policy and the legacy managed constraint
are both in force.** Organization policies are evaluated independently, so the
inference — and it is an inference, not a citation — is that a binding must
satisfy both, meaning the legacy constraint would still refuse `allUsers` while
it is enforced on that resource. If that is right, the custom path *also*
requires the legacy constraint to stop being enforced at this project, and only
then narrows what is allowed from "anything" to "our domain plus allUsers".
That is better, and it is more work, and it should be verified rather than
assumed before anyone relies on it.

### The steps, when the time comes

**Daniel runs these. Not something to attempt from a script.**

1. Console → **IAM & Admin → Organization policies**.
2. **Change the resource picker FIRST, before opening the policy.** The console
   lands on the **organisation** — it defaulted to *"Applies to: Organization
   courageloop.com"* with **Override parent's policy** and **Replace** already
   selected. Select the project `courageloop-prod` in the picker at the top.
3. Open **Domain restricted sharing**
   (`constraints/iam.allowedPolicyMemberDomains`) and **confirm the "Applies
   to" line names `courageloop-prod`** before touching anything.

   > **Getting step 2 wrong replaces the organisation policy.** The org and
   > project screens are otherwise identical, and "Applies to" is the only
   > thing distinguishing them. Read that line twice.

4. At project scope the constraint reads **"Inherit parent's policy"** and
   offers three options: *Inherit parent's policy*, *Google-managed default*,
   *Override parent's policy*.

   **Google-managed default** returns the constraint to its unenforced state
   for this project — the console's own description says *"By default, all user
   identities are allowed to be added to IAM policies."* An explicit
   **Override parent's policy** that allows all values reaches the same place.

   > **Which of the two to use is not settled by the documentation.** The
   > console description supports "Google-managed default" being permissive;
   > the docs separately say that for organisations created on or after 3 May
   > 2024 — which includes this one — the constraint *"is enforced by default,
   > with your domain listed as the only allowed value"*, which describes a
   > default **policy Google sets at the org node**, not the constraint's own
   > default. The two statements are about different things and the console is
   > the one describing the button being pressed. **Try "Google-managed
   > default" first and confirm the result before granting anything**; if the
   > binding in step 5 is still refused, use the explicit override instead.
   > Either way the effect on this project is the same and is the one described
   > above.

5. Then, and only then:

```sh
gcloud run services add-iam-policy-binding api \
  --region=us-west1 --member=allUsers --role=roles/run.invoker
gcloud run services update api --region=us-west1 --allow-unauthenticated
```

The API is public because clients call it from a browser; what protects data is
the bearer token on every request, RLS in Postgres, and the issuer-and-audience
check — never network reachability.


## 8. The two apps — A6

Each app is **its own Cloud Run service**. Not Firebase Hosting, and the reason
is written down here rather than left to memory.

### Why not Firebase Hosting

It was the obvious choice and it is the wrong one. Managed certificates and
custom domains are included, SPA rewrites are one config line, and it is
already adjacent to the project because Identity Platform is. All true, and
none of it matters, because:

**Firebase Hosting is not on Google's HIPAA covered-products list.** Cloud Run,
Cloud SQL, Secret Manager, Cloud Build, Artifact Registry and Identity Platform
are. Google's own guidance is to ensure products not explicitly covered by the
BAA are not used in connection with PHI. Both `apps/web` and `apps/clinician`
touch PHI — the clinician app reads client records directly — so neither ships
on it.

This paragraph exists so that nobody re-adds Firebase Hosting in six months for
the same sensible-sounding reasons. The reasons were never wrong; they were
answering the wrong question.

A pure marketing site with no auth and no client identifiers would be fine on
Firebase Hosting. **There is no such site in this repository today**, so this is
not a carve-out to build against.

### What they are instead

| | Service | Image |
|---|---|---|
| `app.courageloop.com` | `web` | `apps/web/Dockerfile` — Vite build, served by nginx |
| `courageloop.com` | `clinician` | `apps/clinician/Dockerfile` — Next.js `output: 'standalone'` |

The client PWA is static files, so nginx serves them with an SPA fallback: it
is a solved problem with a long list of ways to get it wrong, and path
traversal and MIME sniffing are two of them. The clinician app is not static —
it is a Next.js server with prerendered pages — so it runs as one.

Both scale to zero, so an idle beta costs nothing but storage.

```sh
gcloud builds submit --region=us-west1   --tag=us-west1-docker.pkg.dev/courageloop-prod/courageloop/web:$(git rev-parse --short HEAD)   --file=apps/web/Dockerfile .

gcloud run deploy web --region=us-west1   --image=us-west1-docker.pkg.dev/courageloop-prod/courageloop/web:COMMIT   --min-instances=0 --max-instances=4 --allow-unauthenticated
```

The same for `clinician`, with its own Dockerfile and tag.

**Build-time values, not revision values.** Vite and Next both inline
`VITE_*` / `NEXT_PUBLIC_*` at build time, so the API origin and the Identity
Platform key are properties of the *image*. Changing one means a rebuild, not a
new revision with different environment variables — a trap worth knowing before
you try the latter and wonder why nothing changed. The Dockerfiles take them as
`--build-arg`; all are public by design.

### Custom domains — no domain mapping

Cloud Run domain mappings would be free and `us-west1` supports them. They are
rejected, and the reason is the standing rule in Prompt 0: **a Google service
entering the deploy path must be both on the HIPAA covered-products list and
generally available.** Domain mappings fail the second test.

> "This feature is subject to the 'Pre-GA Offerings Terms' in the General
> Service Terms section of the Service Specific Terms."
>
> — Cloud Run, *Mapping custom domains*

Google's HIPAA guidance says not to use Pre-GA offerings in connection with
PHI. These origins serve the shell that carries the invite link and the
authenticated session. Having rejected Firebase Hosting on the covered-products
list and then accepted a Pre-GA offering in the same path would be inconsistent
in a way a security questionnaire would find before we did.

Two other documented limitations point the same way and are not the reason:
Google calls domain mappings "not production-ready", and TLS 1.0 and 1.1 cannot
be disabled on them. **The Pre-GA status is the disqualifier**; those are
corroboration. The next person to notice the $0 price tag should find this
paragraph.

### Before launch: the default run.app URLs

Right now, and only right now, both services are reached at their generated
`*.run.app` URLs. Generally available, free, no custom domain, no load
balancer.

**This is a pre-launch arrangement, not the launch one, and should not be read
as hardened.** Google publishes no minimum TLS version for `*.run.app`, and an
SSL policy cannot be attached to it — there is no target proxy in that path to
attach one to. So the TLS floor on those hostnames is whatever Google's front
end offers, and it is not something this project controls or can evidence.

That is acceptable while the only people using it are building it. It stops
being acceptable at the trigger in gate **A10**.

### At launch: a global external Application Load Balancer

One load balancer, both hostnames, TLS 1.2 floor. Roughly **$18.25/month** for
the forwarding rule; data processing is negligible at beta scale.

**Written now, executed later, deliberately.** At the gate this happens
alongside the A4 sender and the A8 tier change, and that is the wrong moment to
be reading about URL maps for the first time.

#### 1. Serverless NEGs — one per service

A serverless network endpoint group is how a load balancer points at Cloud Run.
Regional, in the services' own region.

```sh
gcloud compute network-endpoint-groups create web-neg \
  --region=us-west1 --network-endpoint-type=serverless --cloud-run-service=web

gcloud compute network-endpoint-groups create clinician-neg \
  --region=us-west1 --network-endpoint-type=serverless --cloud-run-service=clinician
```

#### 2. Backend services

```sh
gcloud compute backend-services create web-backend \
  --global --load-balancing-scheme=EXTERNAL_MANAGED
gcloud compute backend-services add-backend web-backend --global \
  --network-endpoint-group=web-neg --network-endpoint-group-region=us-west1

gcloud compute backend-services create clinician-backend \
  --global --load-balancing-scheme=EXTERNAL_MANAGED
gcloud compute backend-services add-backend clinician-backend --global \
  --network-endpoint-group=clinician-neg --network-endpoint-group-region=us-west1
```

No health checks: serverless NEG backends do not take them, and `gcloud` will
refuse if you add one.

#### 3. The URL map — host rules for both names

```sh
gcloud compute url-maps create courageloop-lb --default-service=clinician-backend

gcloud compute url-maps add-path-matcher courageloop-lb \
  --path-matcher-name=web --default-service=web-backend \
  --new-hosts=app.courageloop.com

gcloud compute url-maps add-path-matcher courageloop-lb \
  --path-matcher-name=clinician --default-service=clinician-backend \
  --new-hosts=courageloop.com,www.courageloop.com
```

The apex is the default service, so an unmatched Host header reaches the
clinician app rather than nothing.

#### 4. The reserved address, and DNS

Reserve the address **before** the certificate: a Google-managed certificate
will not validate until the name already resolves to it.

```sh
gcloud compute addresses create courageloop-ip --global
gcloud compute addresses describe courageloop-ip --global --format='value(address)'
```

Then, at the registrar, with that address:

| Record | Name | Value |
|---|---|---|
| A | `courageloop.com` (apex) | the reserved IPv4 |
| A | `app.courageloop.com` | the same address |
| CNAME | `www.courageloop.com` | `courageloop.com` |

Both hostnames point at the same load balancer; the host rules in step 3
separate them. Wait for DNS before step 6 — `dig +short app.courageloop.com`
should return the reserved address.

#### 5. The SSL policy — the TLS floor

```sh
gcloud compute ssl-policies create courageloop-tls \
  --profile=MODERN --min-tls-version=1.2
```

**`MODERN` with an explicit 1.2 floor, not `RESTRICTED`.** Both give the same
minimum version. `RESTRICTED` additionally narrows the cipher suites to a
compliance-oriented set, which is a real compatibility cost on older mobile
browsers and buys nothing here — the requirement is a version floor, and
picking the tighter profile because it sounds stronger is how a client on an
old Android phone silently cannot sign in. `COMPATIBLE` is the default and
permits TLS 1.0, which is the thing being fixed.

Read cold in a config file, `MODERN` looks like the weaker option and
`RESTRICTED` looks like diligence. For this requirement it is the other way
round, which is why the reasoning sits here next to the choice rather than
being left to re-derivation: the version floor is identical either way, and the
only difference `RESTRICTED` makes is to the people whose browsers it drops.

#### 6. The certificate and the proxies

```sh
gcloud compute ssl-certificates create courageloop-cert --global \
  --domains=courageloop.com,www.courageloop.com,app.courageloop.com

gcloud compute target-https-proxies create courageloop-https-proxy \
  --url-map=courageloop-lb \
  --ssl-certificates=courageloop-cert \
  --ssl-policy=courageloop-tls

gcloud compute forwarding-rules create courageloop-https --global \
  --target-https-proxy=courageloop-https-proxy \
  --address=courageloop-ip --ports=443 \
  --load-balancing-scheme=EXTERNAL_MANAGED
```

**The certificate takes 15 to 60 minutes to provision and can take longer**,
and it sits in `PROVISIONING` until DNS resolves to the forwarding rule. Watch
it rather than guessing:

```sh
gcloud compute ssl-certificates describe courageloop-cert --global \
  --format='value(managed.status, managed.domainStatus)'
```

`ACTIVE`, with every domain `ACTIVE`, is the finished state. A domain stuck at
`FAILED_NOT_VISIBLE` means DNS has not propagated yet.

#### 7. Redirect HTTP to HTTPS

Create a redirect URL map from a YAML file — `gcloud compute url-maps create`
has no flag for a redirect-only map.

```sh
cat > /tmp/redirect.yaml <<'CONF'
name: courageloop-redirect
defaultUrlRedirect:
  httpsRedirect: true
  redirectResponseCode: MOVED_PERMANENTLY_DEFAULT
CONF

gcloud compute url-maps import courageloop-redirect --global --source=/tmp/redirect.yaml

gcloud compute target-http-proxies create courageloop-http-proxy \
  --url-map=courageloop-redirect

gcloud compute forwarding-rules create courageloop-http --global \
  --target-http-proxy=courageloop-http-proxy \
  --address=courageloop-ip --ports=80 \
  --load-balancing-scheme=EXTERNAL_MANAGED
```

This second forwarding rule adds no cost: $0.025/hour covers the first five.

#### 8. Lock the services to the load balancer

Once traffic arrives through the balancer, the `*.run.app` URLs are a second
front door with no SSL policy on it. Close them:

```sh
gcloud run services update web --region=us-west1 \
  --ingress=internal-and-cloud-load-balancing
gcloud run services update clinician --region=us-west1 \
  --ingress=internal-and-cloud-load-balancing
```

The API keeps its own ingress setting; this is about the two app origins.

**Ingress and the `allUsers` invoker binding are both required, and they are
not the same control.** Ingress governs *who can reach* the service; the
invoker binding governs *who may call it* once reached. The trap is to set
ingress, conclude the `allUsers` binding is now redundant, and remove it — the
result is a service unreachable from the internet **and** returning 403 through
the load balancer, because the balancer's forwarded request still needs an
identity permitted to invoke.

So keep the `allUsers` invoker binding from §7 **and** set ingress. Ingress does
the narrowing; the binding is what lets the balancer through it.

**Verify rather than assume, and write down what you saw.** After the ingress
change, confirm all three:

| Check | Expected |
|---|---|
| `curl -I https://app.courageloop.com/` | `200` — a real request, through the balancer |
| `curl -I https://<service>-<hash>.run.app/` | refused — the second front door is shut |
| `gcloud compute backend-services get-health web-backend --global` | healthy |

Serverless NEG backends report health differently from instance-group backends,
so read what the command returns rather than scanning for the word you expect.
**Record the observed results in this document, below this table.** The step is
the observation; the commands are only how it is obtained.

#### 9. Verify the floor took effect — do not assume it attached

Attaching a policy and having a policy in force are different claims, and only
one of them is testable. Test it.

```sh
# Must FAIL. A handshake here means the policy is not in force.
openssl s_client -connect app.courageloop.com:443 -tls1_1 </dev/null

# Must SUCCEED.
openssl s_client -connect app.courageloop.com:443 -tls1_2 </dev/null | head -5

# And confirm which policy the proxy is actually using.
gcloud compute target-https-proxies describe courageloop-https-proxy \
  --format='value(sslPolicy)'
```

Run all three against **both** hostnames. The evidence for gate A10 is **the
TLS 1.1 refusal**, not the 1.2 success — a successful handshake at 1.2 is
equally consistent with a policy that was never attached.


### Not a PHI hop — the claim to confirm, not assume

The browser loads the application shell and then calls `api.courageloop.com`
directly. Nothing proxies through either app's origin, so no client data
transits them. After deploying, confirm it rather than assuming it: open each
app, watch the network panel, and check that every `/v1/` request goes to the
API origin. Record the confirmation in `docs/data-path.md` under A6.


## 9. No PHI in logs, on the real host — B9

The test exists and passes in CI. B9 asks for it once against Cloud Logging,
because a log pipeline is not the thing the test exercises.

**The first successful sign-in verifies three A4 items at once**, and it is
worth doing deliberately rather than noticing later:

| What it exercises | What "working" looks like |
|---|---|
| Project display name | the email says **CourageLoop**, not `courageloop-prod` |
| Identity Toolkit, under the narrowed API key | the link arrives and signs you in |
| Token Service, under the same key | **the session survives past the hour mark** |

The third is the one that fails late. **If sign-in works and sessions die
around an hour in, look at the API key screen before the session code** — a
key restricted to Identity Toolkit alone permits sign-in and forbids refresh,
and the symptom arrives an hour after the change that caused it, in a
different part of the system. Both APIs, or neither.

Then the log check:

1. Sign in on the deployed app as yourself.
2. Write one prediction whose situation contains a distinctive string —
   `ZQX-PROD-CHECK-0001`, matching the shape the test uses.
3. Wait a minute for the logs to settle, then:

```sh
gcloud logging read \
  'resource.type="cloud_run_revision" AND resource.labels.service_name="api" AND "ZQX-PROD-CHECK-0001"' \
  --project=courageloop-prod --freshness=1h --limit=10
```

**The expected result is no entries.** Put the query and its empty output in
the report — an empty result is the evidence, and it only means something
alongside the query that produced it. Then delete the prediction.

**What this check cannot see.** It queries Cloud Run's own logs. It cannot see
a log *sink* copying those logs somewhere else, and neither can
`phi-logs.test.ts`, which only knows what the application wrote. The org-level
sink that existed here was deleted rather than repaired for that reason among
others — `gcp-setup.md` §7a. If centralized aggregation is ever added, its
retention, its readers and its exclusion filters are decided before it exists,
because an aggregation bucket is where an exception to the no-PHI rule would
first become invisible.

## 10. CI deploys — Workload Identity Federation

`constraints/iam.disableServiceAccountKeyCreation` is enforced and stays
enforced, so there is no downloadable key. GitHub Actions authenticates through
Workload Identity Federation or it does not authenticate.

**Done badly this is worse than the key file it replaces**, because it looks
like a hardened setup. A provider with no attribute condition mints tokens for
*any* GitHub repository on the internet — anyone's fork, anyone's fresh repo —
and nothing about the configuration looks wrong. Two layers, and neither is
optional.

### Layer 1 — the provider will not mint a token for anyone else

```sh
gcloud iam workload-identity-pools create github --location=global

gcloud iam workload-identity-pools providers create-oidc github-provider   --location=global --workload-identity-pool=github   --issuer-uri=https://token.actions.githubusercontent.com   --attribute-mapping=google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.repository_owner=assertion.repository_owner,attribute.ref=assertion.ref   --attribute-condition="assertion.repository_owner == 'daniel-frenkel' && assertion.repository == 'daniel-frenkel/ledger'"
```

Both halves of the condition, not one: the owner check and the full repository
name. A name alone is a string someone else can create in their own namespace.

### Layer 2 — the service account will not be impersonated by anyone else

Scope the binding by `attribute.repository`, **not by the pool**. A binding on
the pool grants every identity the pool can ever mint; a binding on the
attribute grants exactly one repository, and stays correct if layer 1 is ever
loosened by accident.

```sh
gcloud iam service-accounts create deployer --display-name="CI deployer"
POOL=projects/PROJECT_NUMBER/locations/global/workloadIdentityPools/github

gcloud iam service-accounts add-iam-policy-binding   deployer@courageloop-prod.iam.gserviceaccount.com   --role=roles/iam.workloadIdentityUser   --member="principalSet://iam.googleapis.com/$POOL/attribute.repository/daniel-frenkel/ledger"
```

For any job that **deploys**, add the ref as well, so a pull request from a
fork cannot obtain a deploy token even if it runs in this repository's context:

```sh
gcloud iam service-accounts add-iam-policy-binding   deployer@courageloop-prod.iam.gserviceaccount.com   --role=roles/iam.workloadIdentityUser   --member="principalSet://iam.googleapis.com/$POOL/attribute.ref/refs/heads/main"
```

Grant `deployer` only `run.admin`, `artifactregistry.writer`, and
`iam.serviceAccountUser` on `api-runtime`. Nothing else.

### Verify it by making it fail

**A provider that works from `main` proves nothing about what else it
accepts.** The evidence this step closes on is a refusal, not a success.

From a scratch repository under a different owner — or a fork of this one —
run a workflow that requests a token from the provider:

```yaml
- uses: google-github-actions/auth@v2
  with:
    workload_identity_provider: projects/PROJECT_NUMBER/locations/global/workloadIdentityPools/github/providers/github-provider
    service_account: deployer@courageloop-prod.iam.gserviceaccount.com
```

The expected result is a failure at the auth step, naming the attribute
condition. **Put that failure in the report** — the error message and the
repository it came from. A green run from `main` alongside it is the control,
not the evidence.


## 11. Email — gate A4

The sign-in email is the first thing a client ever sees from this product. It
has to come from `courageloop.com`, someone has to be responsible for whether
it arrives, and the words in it have to be ours.

### The sender: Google Workspace SMTP relay

Already covered by the Workspace BAA accepted 14 September 2026, so it adds no
vendor and no new agreement.

**SendGrid is excluded permanently.** Twilio's own documentation:

> "SendGrid is not a HIPAA Eligible Service" and Twilio "is not able to sign
> Business Associate Agreements for SendGrid."

That is not a gap to work around with a configuration; it is a closed door.
Recorded here so it is never revisited by someone comparing deliverability
features.

**AWS SES was considered and rejected.** Cheaper per message and perfectly
BAA-able under the AWS BAA — and a second cloud account, a second set of
credentials, a second console and a second bill. That is operational surface a
solo operator should not take on for a few cents a month.

### The API sends. Identity Platform never does.

Our code mints the link and composes the message:

1. `AuthAdmin.signInLink()` calls Identity Platform's admin `accounts:sendOobCode`
   with `returnOobLink: true`, which returns the link **instead of** emailing
   it. It needs the service-account token, which is also what stops anyone
   holding the public API key from calling it.
2. `services/email-copy.ts` composes the message. Its composers take a link and
   nothing else, so there is no parameter through which a name or a date could
   arrive.
3. `services/email.ts` sends it through the relay.

Three reasons, in order. It is the only way to control the body under **no PHI
in email bodies** — Identity Platform's templates are console state, editable
by anyone with console access, and they interpolate the project name. It makes
the provider a configuration change rather than a re-plumb. And it lets the
relay authenticate by IP allowlist, so **no credential exists at all** rather
than one being well stored.

### Identity Platform's Custom SMTP stays OFF — permanently

**This is a decision, not an omission.** "Custom SMTP settings → Enable" is
exactly the box a person reaches for when wiring up email, and the whole design
above exists to avoid it.

Google's servers would connect to the relay from addresses nobody can
enumerate, so that path can only ever authenticate with SMTP AUTH — a Workspace
account password living inside Identity Platform's configuration, outside
Secret Manager, with no clean rotation. It is the credential path we rejected,
in a worse place.

### Relay configuration — run this AFTER the static egress IP exists

**Nothing is configured yet, deliberately.** The relay has no IP to point at
until something is deployed, and the failure mode of configuring it early is
severe (below).

Admin console → **Apps → Google Workspace → Gmail → Routing → SMTP relay
service**:

| Setting | Value |
|---|---|
| Allowed senders | **Only addresses in my domains** — so `noreply@courageloop.com` needs no licensed seat |
| Authentication | **Only accept mail from the specified IP addresses** → the reserved Cloud NAT egress IP |
| | **Require SMTP Authentication — leave UNCHECKED.** That is the credential path we rejected. |
| Encryption | **Require TLS encryption — checked** |

> **Forbidden: saving this with neither authentication option selected.**
>
> Not "not recommended" — forbidden. A relay saved with no authentication
> method is an **open relay for courageloop.com**: anyone on the internet can
> send mail that appears to come from our domain, to anyone. It is a
> configuration someone could reach for while debugging a delivery failure,
> because removing the IP restriction is the obvious way to test whether the IP
> restriction is the problem. It is not a debugging step. If mail is not
> arriving, the answer is to check the egress IP, never to remove the check.

The API refuses to send until `EMAIL_ENABLED` is set, and refuses to boot with
`EMAIL_ENABLED` and no `MAIL_FROM` — so "not yet configured" means "does not
send" rather than "sends from a Google default".

### The known gap: no bounce or complaint webhooks

The relay does not tell us when a message bounces or is marked as spam. **A
failed sign-in email is silent**, and the person affected sees only that
nothing arrived.

This is not fixable with infrastructure, and adding a provider that has
webhooks would undo every reason the relay was chosen. It is a product
requirement instead, and the sign-in screen owes the client three things:

1. **State the address it sent to**, so a typo is visible without a support
   conversation. "Check your email" is useless to someone who typed
   `gmial.com`.
2. **Offer a resend**, rate-limited, with the address editable — so correcting
   a typo does not mean starting over.
3. **Offer a path that does not depend on that email arriving.** A client who
   cannot receive our mail must not be locked out with no recourse, which for a
   product someone may be using at their worst is not a support inconvenience
   but an abandonment.

**Status: written, not built.** The current screen says "Check your email" and
does none of the three.

### What this path does not cover

It replaces Identity Platform's sending **for sign-in**, and for nothing else.
Anything else the project can still send goes out through the built-in sender
with a default template.

That is recorded as an **accepted risk** rather than an open item — see
*Accepted risk — a caller with the public key can cause a send* in
`docs/go-live-gate.md`, with the three steps that reduce it and the reason it
cannot be designed away. The short version: email-link sign-in requires the
email provider enabled, so there is a floor below which "disable what can fire"
cannot go, and the floor is the product.
