---
name: zero-brain-memory
description: >
  Enforce Zero_Brain memory placement rules when creating or organizing notes
  under %ZERO_BRAIN_PATH% or the runtime mirror under %MIRU_ZERO_SHARE_DIR% /
  %KIMI_SHARE_DIR%. Auto-activate on Zero_Brain vault paths or triggers:
  "memory", "place memory", "ingest session", "Zero Brain", "vault",
  "จัด memory", "วาง memory", "focus", "session focus".
---

# zero-brain-memory — Zero_Brain Memory Placement Skill

## Auto-activation

Activate automatically when ANY of these are true:

- Current workspace path contains `Zero_Brain` (design or runtime mirror)
- User explicitly says: "memory", "place memory", "ingest session", "Zero Brain",
  "vault", "จัด memory", "วาง memory", "save to vault", "focus", "session focus"

## Mandatory read order

Before placing any new note, read in this order:

1. `%ZERO_BRAIN_PATH%\00 Atlas\Hotcache.md` — read first; if it answers the question, stop here
2. `%ZERO_BRAIN_PATH%\00 Atlas\Brain Operating Model.md`
3. `%ZERO_BRAIN_PATH%\00 Atlas\Memory Placement Rules.md`
4. `%ZERO_BRAIN_PATH%\00 Atlas\System\Compaction Brain Sync Hook.md`
5. `%ZERO_BRAIN_PATH%\000 Miru Zero Index.md`

Before running commands or writing code, also read:

6. `%ZERO_BRAIN_PATH%\03 Resources\Patterns\Mistake Patterns.md` — to avoid repeating known mistakes

## Short-term session memory (per SSID)

Every session has a short-term focus file:

- Path: `%ZERO_BRAIN_PATH%\05 Fleeting\<session-id>-focus.md`
- Purpose: rewrite/read/review to avoid losing focus during long sessions
- The file is **overwritten** as the session progresses (do not append)
- The compaction hook also rewrites this file automatically

**Procedure:**

1. At session start, detect or create `05 Fleeting\<ssid>-focus.md`.
2. Read it before each significant turn if the session is long or context has drifted.
3. Update it whenever the goal, open questions, or next steps change.
4. At session end, move any lasting value to `03 Resources/` or `01 Projects/`.

## Placement decision tree

Ask these questions in order:

1. **Is it an index, map, registry, operating model, or rule?**
   → Place in `00 Atlas/`
2. **Does it belong to an active project/incident/investigation with a deadline?**
   → Place in `01 Projects/<ProjectName>/`
   → If extracted from a session, also acceptable in `01 Projects/Session Memory/`
3. **Is it a long-term responsibility without deadline?**
   → Place in `02 Areas/<AreaName>/`
4. **Is it reusable reference knowledge (pattern, finding, snippet, sanitized session summary)?**
   → Place in `03 Resources/<subfolder>/`
5. **Is it a temporary scratch thought or short-term focus?**
   → Place in `05 Fleeting/` and process within the session or 7 days
6. **If unsure:** ask the user before placing

## Hard rules

- **Source of truth is `%ZERO_BRAIN_PATH%`**. Never edit the runtime mirror as primary.
- **Every new note must have ≥1 inbound link** from an index or another note.
- **Never store in vault:** credentials, tokens, PII, raw wire logs, full session dumps, chat attachments.
- **Runtime YAML files** live in `%ZERO_BRAIN_PATH%\runtime\` and are mirrored to `~\.miru_zero\agents\default`. They are NOT part of the Obsidian graph.
- **Always update `000 Miru Zero Index.md`** when creating or moving a significant note.
- **Always run sync scripts after placement**:
  - `%ZERO_BRAIN_PATH%\tools\zero-brain\sync-zero-brain.ps1` — mirror vault to `~\.miru_zero\Zero_Brain`
  - `%ZERO_BRAIN_PATH%\tools\zero-brain\sync-runtime-agents.ps1` — mirror runtime YAML to `~\.miru_zero\agents\default`

## Compaction hook

When Kimi CLI auto-compacts context:

1. The hook writes a compacted session memory note to `01 Projects/Session Memory/`.
2. It updates `Session Memory Index.md`.
3. It detects the active project and appends to that project's session log.
4. It rewrites `05 Fleeting\<ssid>-focus.md`.
5. It runs both sync scripts.

## Mistake patterns

- Read `%ZERO_BRAIN_PATH%\03 Resources\Patterns\Mistake Patterns.md` before running commands or writing code.
- If you make a repeated mistake, append it to that note or ask the user to confirm it should be added.
- The compaction hook auto-extracts `<lessons_learned>` blocks from compacted summaries into this note.

## Naming conventions

- Agent notes: `Mxx-Name.md`
- Session memory: `YYYYMMDD-HHMMSS - <short title>.md`
- Compacted session memory: `YYYYMMDD-HHMMSS — Compacted Session Memory.md`
- Short-term focus: `<ssid>-focus.md` in `05 Fleeting/`
- Project folders: `<Short Project Name>`
- Atomic notes: descriptive title, no strict prefix

## Output

When placing memory, report:

- File path (relative to `%ZERO_BRAIN_PATH%`)
- Placement category (Atlas / Project / Area / Resource / Fleeting)
- Inbound link added to which index
- Sanitization steps taken
- Sync status
