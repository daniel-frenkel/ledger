# Proposal 05 — The beta holds no PHI

**Status:** approved for build (Sept 2026). Supersedes the go-live gate *for the beta only*; the gate remains the plan for the paid product. Not legal advice; one paragraph below needs a lawyer's eyes and says so.

**The principle.** There is no legal way for a clinician to put an identifiable client's information into a hosted system that has no BAA and no safeguards — that exposes the clinician first and the vendor second. The legal route is not to work around HIPAA but to design the beta so that HIPAA never attaches: **no protected health information is ever transmitted to, or stored on, anything Loadbearing operates.** Real clients use the Ledger. Real clinicians use the Library, the locator, and the protocols. The server holds clinician accounts and nothing about any client.

Why this is legitimate rather than clever: HIPAA governs PHI held by covered entities and their business associates. A person using a wellness app on their own device, for themselves, with no covered entity in the loop, is not creating PHI in the vendor's hands; a clinician using a reference tool and a decision aid without entering identifiers is doing what they do with a textbook. Consumer health apps are still governed by the FTC's Health Breach Notification Rule and by state laws (Washington's My Health My Data Act and California's CMIA are the strict ones), so the beta still needs a privacy policy, real security, and a breach procedure — but "we store nothing about you" is a privacy policy that is easy to keep.

---

## 1. The client app in beta: local only, no account

- **Sync off.** `SYNC_ENABLED=false` at build time removes the sign-in screen, the outbox, and every network call except loading the app shell. The client app already computes everything from IndexedDB; this makes that the whole story.
- **No account, no email, no server row.** Nothing identifies the person to Loadbearing. The clinician "sends the link" — it is the app's URL.
- **Backup.** A client with no account has no recovery if the device is lost. Add *Export my ledger* / *Import a ledger*: one file, encrypted with a passphrase the client chooses (AES-256-GCM, key from the passphrase by a memory-hard KDF), containing everything in IndexedDB. Stored wherever they put it. The app never sees the file after it is written. Plain warning that a lost passphrase means a lost backup.
- **The crisis card is unchanged** — it was always local.
- **Review in session.** The client opens the Ledger on their own device with their clinician in the room. That is the clinician's view of the ledger in beta. Nothing is transmitted.
- **Sharing a summary, optional and later.** A "share code" carrying `summarizeLedger()` output only — counts and rates, no prose, no dates, no identifiers — that the client can show or send. Counts without dates are de-identified under the safe-harbor standard, but a lawyer should confirm before it ships; it is not in the first cut.

## 2. The clinician app in beta: accounts, no clients

- **Clinician accounts stay.** The clinician's own email is their business identity, not PHI. Ordinary consumer-grade auth (Supabase free tier is fine here — there is no PHI behind it). MFA for clinicians is still worth having and is cheap.
- **No invites, no links, no client records.** The `clinician_client_links`, `link_invites`, `measures`, `phase_events`, and research tables are not used in beta; the routes return 404 behind `CLIENT_LINKING_ENABLED=false`. They stay in the schema for the paid product.
- **Formulations, de-identified by construction.** The locator is a decision aid; it stays. A formulation in beta has: a **case label** the clinician chooses (the app suggests "Case A", "Case B", and refuses labels that look like names, emails, phone numbers, or dates by the same kind of deterministic rules the crisis module uses); the ticked observations; the gate attestation; the floor; the protocol; and the falsify line. **No free-text note field.** The note is the field that would carry identifying detail; without it a formulation is a set of ids from a fixed list and a label the clinician made up. Stored server-side under the clinician's account, encrypted as before, deletable.
- **The beta terms say it in one sentence:** "Do not enter any information that identifies a client. Case labels are for you; the app does not know who they are and must not." Repeated as placeholder text on the label field.
- **Assistant off** as before. When it comes on, its input is the formulation's ids, not a note, until the full gate is met.

## 3. What this changes in the plan

| Was | Beta now |
|---|---|
| Prompt 7 Part 2 (invites, join page) | deferred; flag off |
| Prompt 7 Part 3 (locator writes) | built, with case labels instead of client ids and no note field |
| Prompt 7 Part 4 (locating assistant) | deferred with the note field; the reference assistant (Prompt 9) can come first when its BAA exists, since it sees no client data |
| Prompt 8 (research) | deferred; the feasibility study becomes an anonymous usability survey linked from the client app, not data collection |
| Prompt 4 (deletion) | clinician accounts only; trivial |
| Prompts 10, 11, 2 | Cloud Run deploy still happens (Prompt 2), without the BAA items; Prompt 11 not needed for beta |
| Go-live gate | stays as the paid-product gate, untouched |

## 4. Beta terms and the two documents that replace the gate

- **Privacy policy (client app):** we store nothing; the app runs on your device; export files are encrypted with your passphrase and we never see them; the crisis card is a pointer to help, not help.
- **Clinician beta terms:** free until pricing is announced, 60 days' notice, founder pricing; no client-identifying information in the app, ever; formulations are yours and deletable; the assistant is off; no uptime commitment. ⚖ Have counsel read both before the first clinician signs — this is the one place a lawyer is not optional.

## 5. What the beta cannot do, said plainly

The clinician cannot see a client's ledger remotely. There is no research dataset. There is no locating assistant on notes. Those are the paid product, and the go-live gate is the price of them.
