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

---

## 1. Artifact Registry, and the build

There is no local Docker build in this project's history and none is needed:
**Cloud Build builds the image**, which verifies the Dockerfile in the same
step that produces the artifact rather than as a separate errand on somebody's
laptop.

```sh
gcloud config set project courageloop-prod

gcloud artifacts repositories create courageloop \
  --repository-format=docker --location=us-west1 \
  --description="API images"

# From the repo root. The Dockerfile is packages/api/Dockerfile and the context
# is the whole repo, because the image carries docs/theory and docs/legal.
gcloud builds submit \
  --region=us-west1 \
  --tag=us-west1-docker.pkg.dev/courageloop-prod/courageloop/api:$(git rev-parse --short HEAD) \
  --file=packages/api/Dockerfile \
  .
```

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

```sh
printf '%s' "$(openssl rand -base64 32)" | \
  gcloud secrets create field-encryption-key --data-file=-

printf '%s' 'postgresql://ledger_api:PASSWORD@/ledger?host=/cloudsql/courageloop-prod:us-west1:courageloop-db' | \
  gcloud secrets create database-url --data-file=-

printf '%s' 'postgresql://postgres:PASSWORD@/ledger?host=/cloudsql/courageloop-prod:us-west1:courageloop-db' | \
  gcloud secrets create database-migrate-url --data-file=-
```

`db-owner-password` and `ledger-api-password` already exist from
`gcp-setup.md` §3; the two URLs above embed them.

**`FIELD_ENCRYPTION_KEY` is the one that cannot be regenerated.** It decrypts
every journal entry, prediction, prior label and body-state note in the
database. Losing it loses all of that prose permanently — the rows survive and
their contents do not. Back the value up somewhere that is not this project
before anything is written with it.

## 3. The service account

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
gcloud builds submit --region=us-west1 --config=deploy/gcp/cloudbuild.verify.yaml .
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


## 7. Public ingress — an org-policy exception, project-scoped

A public Cloud Run service needs an `allUsers` invoker binding, and
`constraints/iam.allowedPolicyMemberDomains` (domain-restricted sharing) will
refuse it. **The org policy stays as it is.** The exception is scoped to this
one project.

**Daniel runs this; it is not something to attempt from a script.**

1. Console → **IAM & Admin → Organization policies**, with the **organisation**
   `courageloop.com` selected.
2. Find **Domain restricted sharing**
   (`constraints/iam.allowedPolicyMemberDomains`).
3. **Manage policy** → scope the edit to the **project** `courageloop-prod`
   (the selector at the top — this is the step that keeps the change off the
   organisation).
4. **Override parent's policy** → **Add rule** → **Custom** → allow
   `allUsers` / `allAuthenticatedUsers` for this project only.
5. Save, then:

```sh
gcloud run services add-iam-policy-binding api \
  --region=us-west1 --member=allUsers --role=roles/run.invoker
gcloud run services update api --region=us-west1 --allow-unauthenticated
```

The API is public because clients call it from a browser; what protects data is
the bearer token on every request, RLS in Postgres, and the issuer-and-audience
check — never network reachability.

## 8. The static sites — A6

**Firebase Hosting**, for both `app.courageloop.com` and `courageloop.com`.
The reason over Cloud Storage plus Cloud CDN: managed certificates and custom
domains are included and automatic, SPA rewrites are one line of config rather
than a load balancer URL map, and it is already in this project because
Identity Platform is. Cloud Storage plus a load balancer is more moving parts
for a bucket of static files.

```sh
pnpm --filter @ledger/web build     # -> apps/web/dist
pnpm --filter @ledger/clinician build
firebase deploy --only hosting
```

Both need an SPA rewrite to `/index.html` and the API origin configured at
build time (`VITE_API_URL`, `NEXT_PUBLIC_API_URL`).

**Not a PHI hop, and this is the claim to confirm rather than assume.** The
browser loads the application shell from the static host and then calls
`api.courageloop.com` directly. Nothing proxies through the static host, so no
client data transits it. After deploying, confirm it: open the app, watch the
network panel, and check that every `/v1/` request goes to the API origin.
Record the confirmation in `docs/data-path.md` under A6.

## 9. No PHI in logs, on the real host — B9

The test exists and passes in CI. B9 asks for it once against Cloud Logging,
because a log pipeline is not the thing the test exercises.

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

## 10. CI deploys — Workload Identity Federation

`constraints/iam.disableServiceAccountKeyCreation` is enforced and stays
enforced, so there is no downloadable key. GitHub Actions authenticates through
Workload Identity Federation or it does not authenticate.

```sh
gcloud iam workload-identity-pools create github --location=global

gcloud iam workload-identity-pools providers create-oidc github-provider \
  --location=global --workload-identity-pool=github \
  --issuer-uri=https://token.actions.githubusercontent.com \
  --attribute-mapping=google.subject=assertion.sub,attribute.repository=assertion.repository \
  --attribute-condition="assertion.repository == 'daniel-frenkel/ledger'"

gcloud iam service-accounts create deployer --display-name="CI deployer"
```

The `--attribute-condition` is not optional. Without it the provider will mint
tokens for **any** GitHub repository, which is a considerably worse credential
than the key file this replaces. Bind `deployer` to the pool for that
repository only, and grant it `run.admin`, `artifactregistry.writer` and
`iam.serviceAccountUser` on `api-runtime` — nothing else.
