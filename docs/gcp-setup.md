# Google Cloud setup — the console actions, in order

Everything in this list is something only Daniel can do: it needs console access
to `courageloop-prod`, and the organisation forbids downloaded service-account
keys, so there is no credential that would let anything else do it. The code
that depends on each step is already written and merged.

Follow it top to bottom. Nothing here asks you to decide anything — where there
was a choice, it has been made and the reason is given.

**Project facts.** Organisation `courageloop.com` (`611109317176`) · project
`courageloop-prod` · billing `0195B9-B97371-6F379D` (paid) · region `us-west1`
for everything · HIPAA BAA accepted 11 September 2026, scoped to the project.

**Covered products.** Verified against Google's HIPAA covered-products list on
11 September 2026: **Identity Platform, Cloud SQL, Cloud Run and Secret
Manager** are all named, so the BAA covers this architecture end to end. That is
the whole PHI path — identity, database, compute, secrets — and it is why gate
A2 could move off Supabase without buying an add-on.

## Two conditions on Identity Platform

From Google's Identity Platform HIPAA guidance. Both are satisfied today, and
both are the kind of thing that stops being satisfied by accident, so they are
written down rather than remembered.

**Store only the minimum auth attributes. No PHI in the user record** — not in
the display name, not in a photo URL, not in a custom claim. Today the only
attribute the tenant holds is an email address, and the application database
knows a user as a UUID and a role (`docs/data-path.md`). The temptation this
guards against is a real one: a custom claim is a convenient place to cache
something about a client, and it is the wrong place. If something needs to be
known about a user, it belongs in Postgres behind RLS.

**No SDKs or client libraries when handling PHI.** Already true, and not by
accident: both clients speak the REST API through
`packages/shared/src/auth/identity-platform.ts`, and the API verifies tokens
with `jose` against a JWKS URL. Neither `firebase/auth` nor `firebase-admin` is
a dependency of this repository, and neither should become one.

---

## 1. Enable the APIs

Console → **APIs & Services → Enable APIs and services**. Enable, one at a time:

- `sqladmin.googleapis.com` — Cloud SQL Admin
- `secretmanager.googleapis.com` — Secret Manager
- `identitytoolkit.googleapis.com` — Identity Platform
- `servicenetworking.googleapis.com` — needed for the private IP in step 3
- `run.googleapis.com` — Cloud Run (Prompt 2 uses it; enabling it now costs nothing)

## 2. The VPC and Private Service Access

Cloud SQL's private IP is not a checkbox on the instance — the network has to
be able to reach it first, and this is the step that is easy to discover only
after the instance creation form refuses.

1. **VPC network → VPC networks**. The `default` network exists in a new
   project; use it. If it does not, create one named `default`, **Automatic**
   subnet mode.
2. **VPC network → Private Service Connection → Private services access →
   Allocate IP range**.
   - Name: `google-managed-services-default`
   - **Automatic** allocation, prefix length **/16**
3. Click **Create connection** (or **Private connection to services → Create**),
   choose the range you just allocated, and wait for it to report connected.
   This takes a few minutes.

## 3. The database passwords, before the instance

Create the secrets first so nothing ever types a password into a form twice.

**Security → Secret Manager → Create secret**, twice:

- Name `db-owner-password`, value: 32 random characters
- Name `ledger-api-password`, value: 32 random characters

Generate them with `openssl rand -base64 24` and paste. Do not reuse one for
both: the owner runs migrations, `ledger_api` is what the running API connects
as, and the whole point of the second one is that it cannot do the first one's
job.

## 4. Create the Cloud SQL instance

**SQL → Create instance → PostgreSQL**.

| Field | Value | Why |
|---|---|---|
| Instance ID | `courageloop-db` | The verification script expects `courageloop-prod:us-west1:courageloop-db`; anything else means passing `CLOUDSQL_INSTANCE` by hand. |
| Password | the `db-owner-password` value | This is the `postgres` user. |
| Database version | **PostgreSQL 16** | What the migrations are written and tested against. |
| Cloud SQL edition | **Enterprise** | Enterprise Plus is roughly a 30% premium per vCPU and per GiB and buys nothing this workload needs. |
| Preset | **Sandbox**, then edit below | The production presets start far larger than a beta needs. |
| Region | **us-west1**, single zone | Same region as Cloud Run — cross-region would add latency to every query and egress cost to every row. Single zone is the cost decision in step 9. |
| Machine | **`db-f1-micro`** (shared core, 0.6 GB) | The cheapest tier that runs. No client data goes in for a good while, a tier change is a restart, and the SLA is not worth paying for yet. Gate **A8** requires moving off it before any real client's data is entered. See §9. |
| Storage | **SSD, 10 GB**, automatic increases **on** | 10 GB is far more than this schema will use for a long time; automatic increase means it cannot fill up silently. |
| Connections | **Private IP on**, network `default`, **Public IP off** | No public surface at all. This is why step 2 had to come first. |
| Data protection → Automated backups | **on**, window 03:00–07:00 | Gate B6. **Stays on at the cheap tier.** |
| Data protection → Point-in-time recovery | **on** | Gate B6. Costs write-ahead log storage and is what makes "restore to just before the mistake" possible. **Stays on at the cheap tier.** |
| Data protection → Deletion protection | **on** | This instance will hold PHI. **Stays on at the cheap tier.** |

**What is and is not being economised.** Only CPU, memory and the SLA. Private
IP, automated backups, point-in-time recovery and deletion protection are all on
from the first day and stay on — they cost close to nothing and they are what
protects the data from our own mistakes, which at this stage is the likelier
threat than a zone outage.

Creation takes ten to fifteen minutes.

## 5. The database and the role

**SQL → courageloop-db → Databases → Create database**, name `ledger`.

The `ledger_api` role is *not* created here — `verify-cloudsql.sh` creates it
from `packages/api/src/db/rls/000_roles.sql` in step 6, so that the role the
production database has is the role the repository says it should have.

## 6. Run the verification

This is the step that proves nothing in the schema is Supabase-specific, which
is the claim go-live gate A2 rests on. From a machine with `gcloud`, the
[Cloud SQL Auth Proxy](https://cloud.google.com/sql/docs/postgres/sql-proxy)
and this repository:

```sh
cloud-sql-proxy courageloop-prod:us-west1:courageloop-db &

export CLOUDSQL_HOST=127.0.0.1
export CLOUDSQL_INSTANCE=courageloop-prod:us-west1:courageloop-db
export PGPASSWORD_OWNER="$(gcloud secrets versions access latest --secret=db-owner-password)"
export PGPASSWORD_API="$(gcloud secrets versions access latest --secret=ledger-api-password)"

packages/api/scripts/verify-cloudsql.sh
```

It creates the role, sets its password from the environment, runs the
migrations, then runs the RLS suite as `ledger_api` and prints the case count.
Paste the last block of its output back. The script refuses to run against a
host outside `courageloop-prod`, refuses anything that looks like Supabase,
refuses to start without both passwords, and prints no password or connection
string at any point.

## 7. Identity Platform

**Security → Identity Platform → Enable**. Then:

1. **Providers → Add a provider → Email/Password**. Enable it, and enable
   **Email link (passwordless sign-in)**. Leave Password sign-in **off** —
   there are no passwords in this system.
2. **Providers → Authorised domains → Add domain**, twice:
   `app.courageloop.com` and `courageloop.com`. This list is what stops a
   stolen sign-in link being redirected somewhere else, so it should contain
   these two and nothing else.
3. **Multi-factor authentication → TOTP → Enable**. Gate B2. Leave SMS off:
   it is a weaker factor and adds a telephone number to the identity record
   for no gain.
4. **Application setup details** → copy the **apiKey**. It goes in
   `NEXT_PUBLIC_IDENTITY_PLATFORM_API_KEY` and `VITE_IDENTITY_PLATFORM_API_KEY`.
   It is public by design: it names the project and authorises nothing.
5. **Templates → SMTP settings**: leave for now, and see gate A4. The built-in
   sender is permitted under the BAA and is fine for testing against your own
   address; what it cannot do is send from `courageloop.com`, take
   responsibility for deliverability, or let us write the message body. The
   beta needs all three.

## 8. What is still blocked, and on what

- **A4, the email sender.** Step 7.5 above. A provider that signs a BAA has to
  be chosen and configured as the tenant's SMTP sender before a real client
  signs in.
- **Public ingress for Cloud Run**, at Prompt 2. `constraints/iam.allowedPolicyMemberDomains`
  is enforced org-wide and will refuse the `allUsers` grant a public service
  needs. Do **not** relax it at the organisation. Add a policy exception scoped
  to `courageloop-prod` only, and say so in that report.
- **CI deployment**, at Prompt 2. `constraints/iam.disableServiceAccountKeyCreation`
  means GitHub Actions cannot hold a downloaded key, so it needs Workload
  Identity Federation. The runtime path already avoids keys: the API's
  Identity Platform calls take their token from the metadata server.

## 9. What this costs — and the tier to create now

Indicative, from Google's published Enterprise-edition rates as of mid-2026
(≈$0.0413 per vCPU-hour, ≈$0.0070 per GiB-hour, ≈$0.17 per GiB-month SSD,
≈$0.08 per GiB-month backup). **The console is authoritative** — the instance
page shows the real figure before you click create.

### Create now: `db-f1-micro`

| Item | Monthly |
|---|---|
| `db-f1-micro` — shared vCPU, 0.6 GB | ≈ $9 |
| 10 GB SSD | ≈ $2 |
| Backups + PITR, ~10 GB | ≈ $1 |
| Identity Platform, beta scale | $0 (free below 50k monthly active users) |
| Secret Manager | ≈ $0 |
| **Total** | **≈ $12** |

Settled 11 September 2026: **take the cheapest tier that runs.** No client data
goes into this instance for a good while, and a tier change is a restart rather
than a migration, so the SLA is not worth paying for yet.

Be honest about what `db-f1-micro` is: a shared core and 0.6 GB of memory, which
is below what Postgres is comfortable with. It will run this schema, and it may
be visibly slow under `verify-cloudsql.sh`, which is the heaviest thing that
will ever touch it. **If it struggles there, step up to `db-g1-small`** (shared
core, 1.7 GB, ≈$26/month) and carry on — that is a restart, not a rebuild.
If the console no longer offers shared-core machines in `us-west1`, take the
smallest lightweight dedicated option instead and note what it cost.

### Upgrade target: 1 vCPU, 3.75 GB — gate A8

| Item | Monthly |
|---|---|
| 1 vCPU | ≈ $30 |
| 3.75 GiB RAM | ≈ $19 |
| 10 GB SSD | ≈ $2 |
| Backups + PITR, ~10 GB | ≈ $1 |
| **Total, single zone** | **≈ $52** |

Shared-core tiers carry **no SLA**. That is a reasonable trade while the only
data in the instance is ours and a fixture, and a bad one the moment a real
client's record is in there — so **gate A8 requires this move before any real
client's data is entered**, not before launch and not before the first
clinician. Changing the tier is an edit to the instance and a restart of a few
minutes; do it with nothing at stake rather than under pressure.

**High availability doubles the compute.** A regional instance is ≈$100/month
and is on neither list, because a beta is better served by point-in-time
recovery than by a standby — restore time is minutes either way at this size.
Revisit when a real practice depends on it.

Either way, an order of magnitude below Supabase's HIPAA add-on at ~$599/month,
which is the comparison that started this.
