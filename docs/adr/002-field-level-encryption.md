# ADR 002 — App-managed field-level encryption for free text

**Status:** accepted · 2026-09-07

## Context
At-rest encryption protects against lost disks, not against a leaked database dump or an over-privileged query. Free text is where identification risk lives.

## Decision
- AES-256-GCM per value. Data key per `table.column` via HKDF-SHA256 from a root key in env (`FIELD_ENCRYPTION_KEY`).
- Envelope: `version || iv(12) || ciphertext || tag(16)` in `bytea`. Row carries `key_version`.
- Encrypted: prediction situation/expected/actual, reinterpretation text, prior label, journal body, body-state prose (`words`, `verdict`, `room`, `word_now`). Not encrypted: numbers, enums, timestamps.
- Encryption happens in the API only. The client stores plaintext in its local SQLite (device-protected) and sends plaintext over TLS; the API encrypts before insert and decrypts on read. Search over encrypted text is not supported by design.

## Consequences
- Clinician views decrypt server-side; the clinician app never holds the key.
- Rotation is a background job keyed on `key_version`.
- A future move to per-user keys (client-held) is possible without a schema change: the envelope version byte is the switch.
