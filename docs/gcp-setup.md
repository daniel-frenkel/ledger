# Google Cloud setup — the console actions, in order

Everything in this list is something only Daniel can do: it needs console access
to `courageloop-prod`, and the organisation forbids downloaded service-account
keys, so there is no credential that would let anything else do it. The code
that depends on each step is already written and merged.

Follow it top to bottom. Nothing here asks you to decide anything — where there
was a choice, it has been made and the reason is given.

**Run state.** Steps 1–5 and 7 are **configured** — done in the console. The
Identity Platform MFA `PATCH` and the config `GET` are **verified** — both were
run and their output is recorded (§7 step 3, and A4 in `go-live-gate.md`).
Step 6 has never been run. `docs/deploy.md` is in a weaker state again: written
throughout and executed nowhere, with the table at its head saying so.

**The commands here are PowerShell, deliberately.** They are `Invoke-RestMethod`
calls with a headers hashtable, which is the clearer form on Windows, and they
carry no `\` continuations — so they run as written in the shell Daniel is
already in. `docs/deploy.md` is the opposite: it is `sh` throughout and has to
be run from Git Bash or WSL, because `\` is not a PowerShell continuation.
**Do not convert either document to match the other.**

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

## Current state — 14 September 2026

What exists in the console now, so that the steps below can be read as done or
not done rather than re-derived.

| | |
|---|---|
| Cloud SQL instance | `courageloop-db`, **RUNNABLE**, `POSTGRES_16`, `db-f1-micro`, `us-west1-a` |
| Address | private `10.83.0.3`, **no public address** |
| Data protection | point-in-time recovery **on**, deletion protection **on** |
| Database | `ledger` created |
| Identity Platform | enabled; email-link sign-in on, **password sign-in off** |
| Authorised domains | `app.courageloop.com` and `courageloop.com`, nothing else |
| Second factor | **TOTP enabled via the Admin API**, SMS off |

Steps 1 through 5 and step 7 are done. **Step 6 is deferred to Prompt 2** for
the reason written there. Step 8 is the standing list of what is still blocked.

### The organisation contains eight projects. We use one.

Observed 14 September 2026. Recorded so that a future reader who runs
`gcloud projects list` and finds seven unfamiliar names does not have to work
out which one matters.

| Project ID | Name | |
|---|---|---|
| `courageloop-prod` | CourageLoop | **ours — the only one in scope** |
| `cs-project-0kqm4lcr` | central-logging-monitoring | wizard output |
| `cs-project-1c4rr85f` | nonprod | wizard output |
| `cs-project-7cyrxkk7` | prod | wizard output |
| `cs-project-vynzfwnh` | development | wizard output |
| `google-mpf-5v7vrftg6mkd` | Non-Production-mp | wizard output |
| `google-mpf-ca4o3gdkz7ip` | Development-mp | wizard output |
| `google-mpf-dh4y1ovr7z8j` | Production-mp | wizard output |

**`courageloop-prod` is the only project in scope for everything in this
document and in `docs/deploy.md`.** Every `gcloud` command here names it
explicitly, and none of them touches the other seven.

The other seven are Google Cloud Setup wizard output — the same provenance as
the log sink in §7a, and the same category: infrastructure nobody designed and
nothing here documents. **The difference is that there is no evidence anything
runs in them.** So this is an inventory line and not a task: nothing is being
investigated, nothing is being cleaned up, and no gate is being added.

It becomes a real item only if one of them is spending money. Billing by
project is being checked separately; if that turns something up it gets raised
then, on evidence.

### Two service accounts in the project IAM policy that we did not create

Observed 15 September 2026, from the `courageloop-prod` IAM policy. **Observed
fact, no action.**

| Principal | Roles | Where it came from |
|---|---|---|
| `firebase-adminsdk-fbsvc@courageloop-prod.iam.gserviceaccount.com` | `roles/firebase.sdkAdminServiceAgent`, **`roles/iam.serviceAccountTokenCreator`** | auto-created when Identity Platform was enabled |
| `43998349902@cloudbuild.gserviceaccount.com` | `roles/cloudbuild.builds.builder` | the **legacy** Cloud Build service account, provisioned when the API was enabled |

**`iam.serviceAccountTokenCreator` is worth naming specifically.** It is
privileged — it lets its holder mint tokens as other service accounts — and
nobody here asked for it. It arrived with Identity Platform.

The Cloud Build one is **unused**: builds run as `build-runner` via
`--service-account` (`docs/deploy.md` §1), not as this account.

**This entry exists to make them known, not to queue a cleanup.** Both are
Google's own provisioning, and **removing service agents breaks things in
non-obvious ways** — the breakage usually shows up somewhere unrelated, weeks
later, in a service that quietly depended on the agent. Knowing they are there
is worth more than tidying them away.

For comparison, the accounts this repository *does* create are
`api-runtime` and `build-runner`, and `docs/deploy.md` §1 and §3 list every
role each one holds.

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

- Name `db-owner-password`
- Name `ledger-api-password`

**One generator, one length: `openssl rand -hex 24`, which is 48 characters of
`0–9a–f` and 192 bits of entropy.** Paste the output. Do not reuse one for
both: the owner runs migrations, `ledger_api` is what the running API connects
as, and the whole point of the second one is that it cannot do the first one's
job.

This section previously said "32 random characters" *and* prescribed
`openssl rand -hex 24`, which produces 48. Somebody following the prose and
somebody following the command got different things. One of each now.

**Why 192 bits, and why the length is not the interesting part:**

| | Length | Alphabet | Entropy |
|---|---|---|---|
| `openssl rand -hex 24` | 48 | 16 | **192 bits** |
| 32 alphanumeric characters | 32 | 62 | 190.5 bits |
| `openssl rand -base64 24` | 32 | 64 | 192 bits |

All three are the same strength to any distinguishable degree — 190 and 192
bits are both far past anything that will ever be brute-forced. **The choice
here is the alphabet, not the entropy.** Hex is longer *because* its alphabet
is smaller, and its alphabet is smaller precisely so that nothing in it means
anything to a URI parser.

### Hex, not base64, and this is not a style preference

These passwords get embedded in a URI —
`postgresql://ledger_api:PASSWORD@/ledger?host=/cloudsql/…` — and
`openssl rand -base64 24` emits from the alphabet `A–Za–z0–9+/`. **Both `+`
and `/` are URI-special.** A `/` in the userinfo terminates the authority
component, so the string stops meaning what it looks like it means.

**How likely, in closed form.** 24 bytes is exactly 32 base64 characters with
no padding. Two of the 64 alphabet characters are `+` or `/`, so each
character is safe with probability 62/64 = 0.96875, and

> P(at least one `+` or `/`) = 1 − 0.96875³² = **0.6379**

Measured over 200,000 samples: **0.6400**. The derivation and the measurement
agree, and the derivation is the one that survives someone doubting it — a
number from a simulation only invites a re-run.

For **two** independently generated passwords, the chance that at least one is
unsafe is 1 − 0.3621² = **86.9%**. Which is why the next section is not
hypothetical.

The failure would surface at deploy or on the first query as an authentication
or host error, pointing at the database, the socket, or the role — anywhere
except at the password's encoding. So the fix is the alphabet rather than
escaping at the point of use: `rand -hex 24` is 48 characters of `0–9a–f`,
192 bits of entropy, **URI-safe by construction**. Nothing downstream has to
remember to encode it, which is the only kind of fix that survives.

### The two secrets that already exist

They were created before this section said any of the above, so on the figures
above there is an **86.9% chance at least one of them is unsafe**. Check, then
fix. Both steps are reachable from a laptop — **neither needs a network path to
Postgres**, which matters because there isn't one.

#### 1. Check, without printing either value

```powershell
foreach ($n in 'db-owner-password','ledger-api-password') {
  $v = (gcloud secrets versions access latest --secret=$n)
  if ($v -match '[^A-Za-z0-9._~-]') { "$n : NOT URI-safe — rotate it" } else { "$n : ok" }
  Remove-Variable v
}
```

It prints a verdict and never the value, and clears the variable after each
check so the password is not left in the session.

> **Result, 15 September 2026: both secrets checked, both URI-safe, no
> rotation performed.** 32 characters each.
>
> **Neither was generated by the command this section prescribes** — that
> produces 48. Almost certainly a password manager, whose default alphabet is
> alphanumeric, which is why they passed.
>
> That distinction is the whole point of recording it. This is not "the rule
> worked". The rule was **never exercised**: the values predate it, came from
> somewhere else, and happened to land in the 13.1% that a base64 generator
> would have produced safely anyway. The next password generated by something
> outside this document is an independent draw, and the procedures below are
> for that one.

**Why `[^A-Za-z0-9._~-]` rather than `[+/=]`.** The narrow form tests for the
three characters base64 happens to produce. This one tests for **anything that
is not a URI unreserved character** — so it also catches a password that was
pasted from elsewhere, typed by hand, or generated by some future tool nobody
has thought of yet. The question is not "did base64 do this to us", it is "is
this value safe in a URI".

#### 2. If either is unsafe — and the two are in different situations

**`ledger-api-password` — nothing to rotate. The role does not exist.**

`ledger_api` is created in §6 by `verify-cloudsql.sh`, from
`packages/api/src/db/rls/000_roles.sql`, and §6 has not run. The secret
currently holds a password for a Postgres role **nobody has created**. So:

```sh
printf '%s' "$(openssl rand -hex 24)" | \
  gcloud secrets versions add ledger-api-password --data-file=-
```

Add the version and stop. When §6 eventually runs it creates the role with
whatever the secret says at that moment. **There is nothing to keep in sync**,
because there is nothing on the other side yet.

**`db-owner-password` — the `postgres` user, and it is a Cloud SQL user.**

It was set on the instance-creation form (§4), which makes it a Cloud SQL
user rather than a role created by SQL. That is the difference that matters:
**`gcloud sql users set-password` goes through the Cloud SQL Admin API and
needs no connection to the database.**

```sh
# --prompt-for-password keeps it out of shell history and out of argv.
gcloud sql users set-password postgres \
  --instance=courageloop-db --prompt-for-password

# Then the same value into the secret.
gcloud secrets versions add db-owner-password --data-file=-
```

**So the rotation is not circular.** The circular case — a role that can only
be altered over a connection we do not have — would have applied to
`ledger_api`, and it does not, because that role has not been created yet.

#### PowerShell, which is where Daniel actually is

The `sh` forms above are correct and work in Git Bash. These are the same two
operations in PowerShell, and they fix one thing the `sh` form gets wrong.

First, a helper — `gcloud secrets versions add` needs the same treatment as
`secrets create` in `docs/deploy.md` §2.2, and for the same reason: piping a
string in PowerShell appends a newline, and a secret one byte longer than the
password fails every use without saying so.

```powershell
function New-SecretVersion([string]$Name, [string]$Value) {
  $tmp = [System.IO.Path]::GetTempFileName()
  try {
    # UTF-8, no BOM, no trailing newline. Set-Content and Out-File add one.
    [System.IO.File]::WriteAllText($tmp, $Value)
    gcloud secrets versions add $Name --data-file=$tmp
  } finally {
    Remove-Item $tmp -Force -ErrorAction SilentlyContinue
  }
}
```

**`ledger-api-password` — the secret only. No role exists.**

```powershell
$bytes = [byte[]]::new(24)
[System.Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
$pw = [System.Convert]::ToHexString($bytes).ToLower()

New-SecretVersion 'ledger-api-password' $pw

Remove-Variable pw
[Array]::Clear($bytes, 0, $bytes.Length)
```

**`db-owner-password` — the database and the secret, from one generated value.**

> **The `sh` form has a flaw this fixes.** `--prompt-for-password` asks for the
> password, and then the secret has to be given the same value a second time.
> **Two typings of the same string is two chances to type it differently**, and
> if they differ nothing complains: the database has one password and the
> secret has another, and you find out at the next deploy, from an
> authentication error that says nothing about which of the two is wrong.
>
> Generate once, into a variable, and use that variable for both.

```powershell
$bytes = [byte[]]::new(24)
[System.Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
$pw = [System.Convert]::ToHexString($bytes).ToLower()

# 1. The database.
gcloud sql users set-password postgres --instance=courageloop-db --password=$pw

# 2. The secret — the SAME value, not a re-typed one.
New-SecretVersion 'db-owner-password' $pw

# Only after both have succeeded.
Remove-Variable pw
[Array]::Clear($bytes, 0, $bytes.Length)
```

**Do not put the clear-down in a `finally`.** If step 2 fails, the database has
the new password and the secret does not — and `$pw` is the only place that
value now exists. Clearing it there would lock you out of the instance. Leave
it in the session, fix the secret, *then* clear.

**On `--password=$pw` and where the value goes.** PowerShell's history records
the command **text**, not its expansion, so the file keeps `--password=$pw` and
never the password — which is why this is written as a variable rather than
pasted. The residual is that the value is in the process's arguments for the
duration of the `gcloud` call, visible to another process on the same machine
during that second. On a single-user laptop that is an acceptable trade against
the desynchronisation it prevents; on a shared machine, use the `sh` form and
type it twice, carefully.

`RandomNumberGenerator.Fill` rather than `Get-Random`: the latter is not
cryptographically secure and is the wrong tool for a database password, however
convenient.

**What was actually run, 15 September 2026.** The generator and the file write
were executed on this machine: `Fill` + `ToHexString().ToLower()` produces 48
characters matching `^[0-9a-f]{48}$` and passing the check in step 1 above, and
`WriteAllText` writes exactly three bytes for `abc` — **no BOM, no trailing
newline**, which is the property the whole helper exists for. The two `gcloud`
calls were not run; they are the part that changes something.


#### Do it now, because right now it is free

`database-url` and `database-migrate-url` **do not exist yet** — §2.2 of
`docs/deploy.md` creates them. Nothing is deployed. `ledger_api` has not been
created. So at this moment a rotation is: add one secret version, and for the
owner, one Admin API call.

**The same rotation after §2.2 and a deploy is a four-step ordering with an
outage in it**, which is the next section. That asymmetry is the whole argument
for doing it before §2.2 rather than after.

**Percent-encoding the existing values is the fallback and is not
recommended.** It works, and it leaves a value that every future connection
string has to remember to encode — a rule enforced by whoever is paying
attention, which is the failure mode the hex alphabet exists to remove. Take it
only if rotation turns out to be blocked, and record that it was taken.

#### Ordering, for a rotation after the connection strings exist

A Postgres role has exactly one password, so there is no dual-password window.
The order that minimises the gap:

1. **New value into the password secret** (`db-owner-password` or
   `ledger-api-password`) — a new version, nothing else changes yet.
2. **Change the password on the database** — `gcloud sql users set-password`
   for `postgres`, or `ALTER ROLE` through the verification job for
   `ledger_api`. **Every existing connection using the old password now
   fails.**
3. **New version of the connection-string secret** (`database-url`,
   `database-migrate-url`) built from the new password.
4. **Deploy a new Cloud Run revision.** Secrets exposed as environment
   variables are resolved when an instance starts, so a revision already
   running keeps the old value until it is replaced. `:latest` in the secret
   reference does not change a running instance.

**The outage is between 2 and 4**, and it is unavoidable — the database has
the new password and the running revision has the old one. With
`--min-instances=0` and no traffic it is invisible; under load it is a real
window, so do it deliberately rather than discovering the ordering during an
incident.

Getting this backwards — 3 before 2 — breaks the service *earlier* and for
longer, because the new connection string is wrong until the database catches
up.


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

## 6. The verification — deferred to Prompt 2, and why

**This cannot be run from a laptop, and the obvious workaround is closed.**
Both findings are from the console run of 14 September 2026.

The instance is private-IP only (`10.83.0.3`). Google's own guidance is
unambiguous: *"To connect to a Cloud SQL instance using private IP, the Cloud
SQL Auth Proxy must be on a resource with access to the same VPC network as the
instance."* A laptop is not in the VPC. `--private-ip` does not help — it
chooses which endpoint the proxy uses once network access already exists; it
does not create the access.

Temporarily assigning a public IP is refused by
`constraints/sql.restrictPublicIp`, enforced org-wide. **That policy stays
enforced and no exception is being granted for this.** A database holding PHI
should not acquire a public address so that a convenience step can run.

So the verification **moves inside the VPC and runs as a Cloud Run job**, added
to Prompt 2's scope. It does what `packages/api/scripts/verify-cloudsql.sh`
does — create `ledger_api` from `src/db/rls/000_roles.sql`, run `db:migrate`,
run the RLS suite as `ledger_api`, print the case count — reaching the private
IP through the VPC connector, and taking both passwords from Secret Manager.
Every refusal the script already has stays: a host outside `courageloop-prod`,
anything resembling Supabase, a missing password, and no password or connection
string printed at any point.

**This is better than the laptop path, not merely a substitute for it.** It is
repeatable on every schema change rather than a thing someone did once from a
machine nobody else has. It never needs a public IP, so the org policy stays
untouched. And it runs as the same service account the API will use, against
the same private endpoint, so what it proves is what production actually does —
a proxy on a laptop proves that a laptop could connect.

**What is already established without it.** The RLS suite runs in CI on every
push, against vanilla PostgreSQL in a container, and passes — so "nothing in
the schema, the policies or the migrations is Supabase-specific" is largely
proven already, and was proven before this instance existed. What Cloud SQL
adds is narrower and still worth having: that role creation, the migrations and
RLS behave the same on Google's build, with Google's defaults and extensions.

**Gate A2 stays open until that job has run and reported.** Deferred is not
skipped.

## 7. Identity Platform

**Security → Identity Platform → Enable**. Then:

1. **Providers → Add a provider → Email/Password**. Enable it, and enable
   **Email link (passwordless sign-in)**. Leave Password sign-in **off** —
   there are no passwords in this system.
2. **Providers → Authorised domains → Add domain**, twice:
   `app.courageloop.com` and `courageloop.com`. This list is what stops a
   stolen sign-in link being redirected somewhere else, so it should contain
   these two and nothing else.
3. **TOTP — not in the console.** Gate B2. The Multi-factor authentication
   page offers SMS only; there is no TOTP toggle in the UI. It is enabled
   through the Admin API instead. In PowerShell:

   ```powershell
   $project = 'courageloop-prod'
   $token   = gcloud auth print-access-token

   $body = @{
     mfa = @{
       state = 'ENABLED'
       providerConfigs = @(
         @{ state = 'ENABLED'; totpProviderConfig = @{ adjacentIntervals = 5 } }
       )
     }
   } | ConvertTo-Json -Depth 6

   $headers = @{ Authorization = "Bearer $token"; 'X-Goog-User-Project' = $project }
   $uri = "https://identitytoolkit.googleapis.com/admin/v2/projects/$project/config?updateMask=mfa"

   Invoke-RestMethod -Method Patch -Uri $uri -Headers $headers -ContentType 'application/json' -Body $body
   ```

   **If this returns 403 `PERMISSION_DENIED` / `SERVICE_DISABLED`, read the
   next paragraph before doing anything.** The error names project
   `32555940559` — gcloud's own shared client project, which appears nowhere in
   our setup — and reads as "the Identity Toolkit API is off". It is not off;
   step 1 enabled it. What is missing is a *quota project* attributed to the
   call, which is what the `X-Goog-User-Project` header above supplies. That
   header is not always sufficient on its own: Identity Toolkit does not accept
   end-user credentials from the Cloud SDK without a quota project configured,
   and the caller needs `serviceusage.services.use` on it. If the header alone
   does not clear it:

   ```powershell
   gcloud config set billing/quota_project courageloop-prod
   ```

   **Do not enable an API in response to that error.** The project it names is
   not ours and the service it names is already on. The same applies to the
   `GET` below and to the one in `go-live-gate.md`.

   **Both `state` fields are required, and this is the trap.** The top-level
   `mfa.state` governs all multi-factor authentication including TOTP. Set only
   the provider config and TOTP stays inert — while the response comes back
   looking exactly like success. The `updateMask=mfa` replaces the whole `mfa`
   object, so both fields have to travel in the same call; sending
   `providerConfigs` alone clears the state you meant to set.

   `-Depth 6` on `ConvertTo-Json` is not decoration. PowerShell's default depth
   is 2, and at that depth the body serialises as
   `{"mfa":{"providerConfigs":["System.Collections.Hashtable"],"state":"ENABLED"}}`
   — the provider config becomes the *name of its type*. PowerShell does warn
   ("Resulting JSON is truncated as serialization has exceeded the set depth of
   2"), but it is one line in a scrollback and the API's rejection will not
   mention depth. Both forms checked before this was written down.

   `adjacentIntervals: 5` is Google's own default, not a loosened setting: it is
   how many adjacent 30-second windows are accepted either side, for clock drift
   and human typing speed. The allowed range is 0 to 10.

   **SMS stays off by omission**, which is the behaviour to rely on rather than
   a setting to check: phone MFA lives in a separate `enabledProviders` field
   that nothing here ever writes. The reason it stays off is unchanged — it is a
   weaker factor and it adds a telephone number to the identity record for no
   gain.

   **Verify it, because the PATCH will not tell you.** A `GET` on the same
   resource:

   ```powershell
   (Invoke-RestMethod -Method Get -Uri "https://identitytoolkit.googleapis.com/admin/v2/projects/$project/config" -Headers $headers).mfa | ConvertTo-Json -Depth 6
   ```

   Three things, all of which must be true:
   - `state` is `ENABLED` — the top-level one
   - a `providerConfigs` entry with `state: ENABLED` **and** a
     `totpProviderConfig` inside it
   - no phone provider: `enabledProviders` is absent or empty

4. **Application setup details** → the **apiKey**. For `courageloop-prod` it is:

   ```
   AIzaSyDFiAHXuyUU8yZul7iPDJF2Re4m2QzYaIc
   ```

   It populates `NEXT_PUBLIC_IDENTITY_PLATFORM_API_KEY` and
   `VITE_IDENTITY_PLATFORM_API_KEY`. Written down here rather than treated as a
   secret because it is not one: it names the project and authorises nothing,
   and it is compiled into both client bundles, so anyone with a browser has it
   already. What protects data is RLS in Postgres and the issuer-and-audience
   check on every token — never this string.

   It is worth adding **HTTP referrer restrictions** to it in
   **APIs & Services → Credentials**, limited to `courageloop.com` and
   `app.courageloop.com`. That buys nothing in confidentiality; it stops someone
   spending the project's sign-in quota from somewhere else.
5. **OAuth consent screen — deliberately not configured.**

   Not applicable today, and this is a decision rather than an oversight. No
   Google sign-in provider is enabled — sign-in is email-link only — so no user
   ever reaches that screen, and configuring it would be configuring a surface
   nobody sees.

   **What reverses this: adding Google (or any OAuth provider) as a sign-in
   method.** The consent screen then becomes *the first thing a clinician
   sees*, before they have seen anything of ours, and an unconfigured one
   displays the raw project id. That is the same failure as the `%APP_NAME%`
   leak in the email templates, on a considerably more visible surface.

   It is also **downstream of gate C1**, not independent of it: the consent
   screen requires public privacy-policy and terms-of-service URLs, and neither
   document exists yet. So adding an OAuth provider is blocked on C1 whether or
   not anyone has thought about the consent screen.

6. **Templates → SMTP settings**: leave for now, and see gate A4. The built-in
   sender is permitted under the BAA and is fine for testing against your own
   address; what it cannot do is send from `courageloop.com`, take
   responsibility for deliverability, or let us write the message body. The
   beta needs all three.

## 7a. The org-level log sink — gone, and not repaired

**Resolved, 14 September 2026.** The Google Cloud Setup wizard created an
org-level sink, `org-level-logsink-611109317176`, exporting to a bucket in a
project it also created (`cs-project-0kqm4lcr`). It was failing with
`log_bucket_permission_denied`.

**It is already gone.** `gcloud logging sinks list` at both org and project
level returns only `_Required` and `_Default` — the built-ins — so the
Foundation Builder cleanup had removed it before anyone looked. Nothing was
done to it here, and nothing needs to be.

**The failure notification postdated the fix**, which is why it read as live.
Worth knowing for the next one: an error email describes state at the time of
the failure, not current state, so the first step is to look rather than to
act on the message.

The decision below stands as a decision — if it had still existed, it would
have been deleted rather than repaired, and the reasoning is what makes that
the right answer for the next wizard-created thing too.

Three reasons it would not have been worth repairing, and the first is the one
that generalises:

**An undocumented log destination in a wizard-created project is exactly the
thing the covered-and-GA rule exists to catch.** Nobody chose that project,
nobody can say what is in the bucket, and it is not on any list in this
repository. A destination for logs that nothing here documents is a
destination nobody is accountable for.

**Repairing it would bill org-wide log storage for logs nobody reads.** The
sink was not created to answer a question; it was created by a wizard.

**No audit trail is lost.** Per-project `_Required` buckets retain Admin
Activity and System Event audit logs for **400 days**, and those buckets are
non-configurable and undeletable — retention is not something this decision
can reduce. The HIPAA audit obligation is met by the in-app `access_log` from
migration 0008 (gate B1) and by `_Required`, neither of which depends on log
aggregation.

**This is not a gate**, and the register was checked before saying so: B1 is
the in-app audit table, B9 is the no-PHI check against Cloud Run's logging,
and nothing else in `go-live-gate.md` covers aggregation.

### If centralized aggregation is wanted later, it gets designed

Not inherited. Three things have to be decided before a sink exists, not
after:

- **Retention period**, chosen rather than defaulted.
- **Who can read it** — a log bucket is a copy of production behaviour with a
  different access-control list from production.
- **Exclusion filters**, written before the first log arrives.

**Tie this to the no-PHI-in-logs rule, because an aggregation bucket is where
an exception to that rule would first become invisible.** `phi-logs.test.ts`
asserts what the application writes, and gate B9 checks it once on the real
host. Neither of them can see a bucket that some other project is copying logs
into. A sink that aggregates across services is the one place a PHI leak could
sit, retained, in a project nobody is looking at — which is the same shape as
every other finding in this document: the failure is silent and surfaces
somewhere that does not point back at it.

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
