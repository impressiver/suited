# Refinement history and revert (planned)

**Status:** **Not implemented** — normative product/behavior spec for a future change. Today, persisting refined data overwrites **`refined.json`** / **`refined.md`** (see [`project.md` §7](./project.md#7-profile-directory-layout-conceptual)); users rely on **version control**, copies of the profile directory, or backups to recover older refined states.

**Normative terms** follow [RFC 2119](https://datatracker.ietf.org/doc/html/rfc2119).

**Primary implementers:** stream **P0** (schema + `profile/serializer` + shared save path), **S1** (service API), **T2** (Refine / Profile UX). See [`AGENTS.md`](./AGENTS.md).

---

## 1. Goal

Users MUST be able to **recover prior refined profile states** whenever this spec’s snapshot rules apply. “Revert” means **making an older snapshot the current working refined profile** again, not only viewing read-only history.

**Persistence contract:** Any flow that would replace global **`refined.json`** through the **canonical save API** (today **`saveRefined`** in [`src/profile/serializer.ts`](../src/profile/serializer.ts); future renames keep the same “single front door” rule) participates in history **without** listing call sites by hand — Refine, Profile editor, polish, Q&A, markdown sync, **`generate`** md reload, **`improve`**, **`contact`**, etc. all go through that API.

---

## 2. Scope

### 2.1 In scope (first delivery)

- **Global refined profile** only: **`refined.json`** (full **`RefinedData`**: **`profile` + `session`**) and **`refined.md`**.
- When §4’s conditions hold, implementations **MUST** persist a **durable snapshot** of the **current** on-disk refined state **before** replacing `refined.json` / `refined.md`, using the **durability ordering** in §3.3. No successful overwrite of an existing `refined.json` may drop the previous state from recoverable history **except** via explicit pruning (§6).

### 2.2 Out of scope (initially)

- **Per-job curated profiles** under `jobs/{slug}/` — MAY use the **same pattern** later ([`tui-screens.md` — CurateScreen](./tui-screens.md#curatescreen-planned)); this spec does not require job-scoped history in v1.
- **Branching / merging** histories, diff-between-arbitrary-versions UI, or **hosted** sync.
- Replacing **Git** — history is for users who do not use VCS on the profile dir; it MUST NOT assume a Git repo exists.

### 2.3 Relationship to source

- **`source.json`** is the import truth; refinement history concerns **refined** data only. Reverting refined MUST NOT silently rewrite **source** unless a separate, explicit product action says otherwise (not part of this spec).

### 2.4 Privacy and duplication

- Snapshots contain the **same PII** as `refined.json`, **multiplied** by retention count. Documentation (e.g. [`README.md`](../README.md)) SHOULD warn users who sync or commit **`--profile-dir`** trees to cloud or Git.

---

## 3. Storage model (behavioral)

Implementations SHOULD keep machine-readable snapshots **under the profile directory** (local-first, same as [`project.md` §2](./project.md#2-goals)).

### 3.1 Directory layout and collision avoidance

- **MUST** store global-refined snapshots in a **dedicated top-level** directory under the profile dir, e.g. **`refined-history/`** (exact dirname is implementation-defined but MUST be documented).
- **MUST NOT** place global snapshot files under **`refinements/`**, because that tree is reserved for **per-job** artifacts (`refinements/{jobId}.json` — curation plan and **`pinnedRender`** per [`project.md` §7](./project.md#7-profile-directory-layout-conceptual)). Global history MUST NOT collide with job plan globs, parsers, or user mental models.

### 3.2 Snapshot payload

- Each snapshot **MUST** include enough data to restore **one** consistent prior state:
  - **`RefinedData`** as a whole (**`profile` + `session`**) — restore **MUST** write both so `sourceHash`, Q&A metadata, and profile bullets stay internally consistent.
  - **`savedAt`** (ISO 8601).
  - **`reason`** / **label** (enum or short string: e.g. `qa-save`, `polish`, `consultant`, `direct-edit`, `profile-editor`, `md-sync`, `improve`, `contact-merge`, `generate-md-sync`, `manual-restore`).
- Snapshot envelopes **SHOULD** include a **`schemaVersion`** (or reuse the profile JSON version field if one exists) so future migrations can read old snapshots.

**Stable user-facing id:** Each snapshot **MUST** expose an **`id`** that is **stable until pruned**, **unique** within the profile dir’s history store, and **accepted by** `restore` / TUI selection (e.g. monotonic integer, ULID, or filename stem — document in CLI `--help` and TUI copy affordances).

**Ordering:** Snapshots MUST be **totally ordered** (by `id` or by `savedAt` + tie-breaker) so “list recent first” is deterministic.

### 3.3 Markdown parity

- On-disk snapshots **MAY** store **only** `RefinedData` (JSON); **restore** **MUST** rewrite **`refined.md`** from the chosen profile via **`profileToMarkdown`** (or equivalent) so the pair matches.
- Alternatively, snapshots **MAY** store **both** JSON and markdown for audit fidelity; if so, restore **MUST** write both files consistently.

The user-visible contract: **after restore, `refined.json` and `refined.md` match** the chosen snapshot (same invariant as today after save).

### 3.4 Durability (write ordering)

Single-process **crash safety** for the “replace refined” operation **MUST** follow this pattern (or equivalent with the same failure properties):

1. If a snapshot is required (§4), **read** the current `refined.json` from disk (source of truth for “previous state”) and compute canonical comparison against the pending write.
2. **Write** the new snapshot file to a **temp** path inside `refined-history/`, then **rename** into its final name (atomic where the OS allows).
3. **Write** new `refined.json` / `refined.md` via **temp + rename** consistent with existing serializer patterns.

**MUST NOT** delete or truncate the current `refined.json` until the snapshot for the **previous** state is durably committed (final rename of snapshot file completed). **Concurrency** between two processes on the same profile dir remains undefined; **SHOULD** use the same atomic-rename discipline for the live refined files to reduce torn writes.

---

## 4. When to record history

**MUST** create a history entry when **all** of the following hold:

1. **`refined.json` already exists** on disk (first creation of refined data creates only the initial current files — **no** snapshot of a prior refined state).
2. The pending write would change the **canonical serialized** content of the **full** `refined.json` document (the entire **`RefinedData`** object, including **`session`**). Implementations **MUST** pick one canonicalization rule (e.g. stable key order + normalized numbers) and document it; **byte-for-byte** equality is acceptable if the serializer is deterministic.

**Markdown sync (`md-sync`, `generate-md-sync`, etc.):** When the user (or **Generate**) reloads profile from **`refined.md`** and the resulting **`RefinedData`** is **canonically equal** to the current on-disk `refined.json`, implementations **MUST NOT** append a snapshot (no-op save).

**Centralization:** Snapshot creation **MUST** live in **one** place (the canonical save path — **`saveRefined`** or a single internal helper it calls). **MUST NOT** duplicate snapshot logic across TUI, CLI commands, and services.

---

## 5. Revert (restore) semantics

- **Restore** writes snapshot **id**’s **`RefinedData`** to **`refined.json`** and refreshes **`refined.md`** per §3.3. Loaders see the new state after **`loadRefined`**.
- Restore **MUST NOT** delete newer snapshots by default. Persisting a restore **MUST** go through the same save path, producing a new snapshot labeled e.g. **`manual-restore`** (with optional metadata pointing at the source **id**), so a mistaken restore can be undone.
- Optional **“replace head only”** (no new snapshot on restore) **MAY** exist as an advanced CLI flag; default remains append-only.

### 5.1 Job metadata after global restore

- Restoring an **older** global refined profile can invalidate **layout squeeze** assumptions stored in **`pinnedRender`** inside **`refinements/{jobId}.json`** (content length / sections change). Implementations **SHOULD** **clear or invalidate `pinnedRender`** for **all** jobs in that profile dir when a global restore succeeds, mirroring the rationale for Curate **Clear and start over** in [`project.md` §7](./project.md#7-profile-directory-layout-conceptual). The next successful PDF export may write a fresh `pinnedRender`.

---

## 6. Pruning and size

- Unbounded growth is unacceptable. Implementations **SHOULD** support:
  - a **configurable max count** (e.g. keep last **50** snapshots), and/or  
  - a **max total disk** budget for `refined-history/`.
- Pruning **MUST** remove **oldest** entries first (after stable sort by policy).
- **MUST NOT** prune below **one** retained snapshot **or** zero when the user has configured a minimum — if the default cap is **N**, implementations **MUST** document that pruning removes **oldest** entries and **SHOULD** surface a **one-time** notice the first time pruning runs in a session (TUI banner or CLI stderr) so deletion is not fully silent.
- **Corrupt snapshot files:** **`list`** **MUST** either **skip** invalid entries with a visible warning or show them as **unrestorable**. **`restore`** on a corrupt or missing **id** **MUST** fail with a **clear error** (no partial write to `refined.json`).

---

## 7. User experience

### 7.1 TUI

- **Refine** hub ([`tui-screens.md` — RefineScreen](./tui-screens.md#refinescreen)) **SHOULD** expose **View / restore refinement history** (exact label TBD): list recent snapshots with **time + reason + id**, optional preview (summary line or section counts), **`ConfirmPrompt`** before restore.
- **Profile editor** path: after saving refined from **`ProfileEditorScreen`**, the user **SHOULD** reach the same history UI (sidebar back to Refine, or a dedicated entry) without re-running AI steps.

### 7.2 CLI

- **SHOULD** expose non-interactive commands or flags, e.g. `suited refine history list` / `restore <id>`, where **`<id>`** is exactly the **id** column from **`list`**. Exact naming lives in [`README.md`](../README.md) once implemented.

---

## 8. Testing and migration

- **Unit tests:** snapshot only when canonical `RefinedData` changes; no snapshot on first create; no snapshot on md-sync no-op; ordering; prune-oldest-first; restore writes expected **`RefinedData`** + markdown consistency; corrupt file handling; **pinnedRender** cleared (or not) per §5.1 when asserting job JSON side effects.
- **Integration:** temp profile dir with **`saveRefined`** sequences mirroring Refine / Profile editor / generate md-reload paths.
- **Migration:** If `refined-history/` is missing, **MUST** behave as today (no errors). **MAY** offer a one-time “seed history from current refined” for users who upgrade mid-project (optional).

---

## 9. Related documents

| Document | Role |
|----------|------|
| [`project.md` §7](./project.md#7-profile-directory-layout-conceptual) | Profile tree, refined artifacts, `refinements/{jobId}.json` |
| [`tui-screens.md` — RefineScreen](./tui-screens.md#refinescreen) | Where TUI entry points live |
| [`src/profile/schema.ts`](../src/profile/schema.ts) | `RefinedData`, `RefinementSession` |
| [`src/profile/serializer.ts`](../src/profile/serializer.ts) | `saveRefined` / `loadRefined` |

---

## 10. Open questions

- **Deduplication:** Optional hash-based **skip** when canonical `RefinedData` matches the **latest** snapshot exactly (saves space; must not hide distinct user actions if **reason** / **savedAt** matter — product choice).
- **Schema migration:** How to **upgrade** snapshot files when `Profile` or `RefinedData` shape changes (auto-migrate on `list`/`restore` vs reject old snapshots).
- **Job-scoped history:** Same pattern under `jobs/{slug}/` when Curate ships — **SHOULD** be a follow-up so global history ships first.
