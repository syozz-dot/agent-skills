# Path A2 — Direct Integration

> Loaded by `onboarding/SKILL.md` when `intent ∈ {integrate-scenario, integrate-feature}` in `.trtc-session.yaml`.
> Before reading this file, SKILL.md must have populated `.trtc-session.yaml` and passed Stage 1 calibration (including Stage 1.0 conflict resolution if applicable).

**Your role: Co-developer.** You scan the project and write code that follows slice-defined best practices. Every code-writing step silently runs through `apply/SKILL.md` as an internal quality gate before being declared done — the user never opts into it, and it is never surfaced as a user-facing service. See **"Calling apply"** below for the exact request/response contract.

## Calling apply (internal quality gate)

apply is invoked per step, not per file, and not per session. It follows the I/O contract defined in `apply/SKILL.md` Phase 0. Construct each call explicitly; do not dump raw code and hope apply infers context.

**Request construction** (build this before calling apply):

```yaml
request:
  code:
    - path: {relative path under project root}
      content: {full file content after this step's edits}
    # include every file this step created or modified, not just the "main" one

  product:     {product}
  platform:    {platform}
  capability:  {slice_id of the step just completed, e.g. "live/coguest-apply"}

  project_context:
    root:              {project root absolute path, if file scanning is available}
    modified_files:    {list of paths touched by this step}
    has_existing_tests: {true if the project has a test command configured, else false}

  related_capabilities:
    # include any prerequisite slices the current step depends on,
    # so apply can verify cross-slice prerequisites without re-inferring
    - {e.g. live/login-auth if this step depends on login}
    - {e.g. live/device-control if this step opens camera/mic}

  mode: full | quick | static-only
    # full        → first integration of a full scenario step
    # quick       → small edits (< 50 lines), single capability
    # static-only → no project_context.root available
```

**Mode selection rules:**

| Situation | mode |
|-----------|------|
| First implementation of a slice, full project available | `full` |
| User asked for an adjustment in A2-Q3 option 3, edit is < 50 lines | `quick` |
| No project scanning / no build env (user pasted snippet) | `static-only` |

**Response handling:**

After apply returns, read the structured `response` and branch as follows:

| response.status | What to do |
|-----------------|------------|
| `pass` | Report the step done (see step summary template in A2-Q3). Show the compile command + exit code from `response.compile_check` as proof. Do not display constraint-check details unless the user asks. |
| `partial` | Step done with non-blocking warnings. Show the warnings inline in the step report, in a single collapsed note. Do NOT block the user from moving to the next step unless a warning is a `critical` severity. |
| `fail` | Step NOT done. Do not write the step summary. Follow `response.retry_hint.strategy`: see below. |

**Acting on `retry_hint` when `status = fail`:**

| retry_hint.strategy | What to do |
|---------------------|------------|
| `patch` | Apply the specific fixes listed in `response.constraint_check.issues[*].fix.code_diff`, write the updated files, re-call apply **once** with the same `capability` but updated `code`. |
| `regenerate` | Re-generate the step's code from scratch, guided by `retry_hint.focus_on` (those are the things to fix on the re-gen). Call apply again with the new code. |
| `give-up` | Stop retrying silently. Surface a message to the user framed as "I hit a snag on step N" — never "apply skill said X". Include what was tried (`attempts`, `failure_signature`) and ask the user whether to skip this step, pause, or provide more context. |
| `missing-field` | **Do NOT retry.** This is a contract violation on the caller side (onboarding built a malformed request), not a code-quality problem. Log the missing field names from `retry_hint.focus_on` internally, then surface "I hit an internal snag on step N" to the user and offer to skip this step. Treat as a self-bug to report rather than a generation quality issue. |

**Retry budget:** at most **2 apply calls per step**. This mirrors apply's own compile retry budget (Phase 3.2). If the second call still returns `fail` with the **same `failure_signature`** as the first, treat it as `give-up` regardless of what `retry_hint.strategy` says — the second call has proven that patch/regenerate isn't converging.

**Never:**
- Never tell the user "I'm calling apply" or "apply said X". apply is silent infrastructure.
- Never show raw `request` / `response` yaml to the user. Translate to the step report template.
- Never skip apply to "move faster". Compile evidence is the only acceptable proof that a step is done.

> **Slice discovery vs. slice loading in this path:**
>
> - **When the slice ID is already known** (user picked from A2-Q1 menu, or scenario file lists the slice sequence): read `knowledge-base/{slice.file}` and the platform-specific file at `knowledge-base/slices/{product}/{platform}/{ability}.md` directly. Do NOT call search.
> - **When the slice ID is unknown** (user described a feature in free text, or Stage 0 inferred `target_features` from natural language): call `search/SKILL.md` with `intent=feature` to discover the matching slice ID. Read `response` fields by name — see `search/SKILL.md` → "Response Contract" for the schema.
> - **When `response.status == 'matched'` and `matches.length == 1`** (and `content_loaded: full`): the slice is found — load the file directly from `matches[0].file_paths_read` and proceed.
> - **When `response.status == 'matched'` and `matches.length > 1`** (typically with `content_loaded: summary` set per match): present the slice summaries to the user and let them pick which to integrate. Use `AskUserQuestion` with each summary as an option.
> - **When `response.status == 'no_match'` or `'no_slice'`**: the feature is not covered in the knowledge base. Fall back to `docs/SKILL.md` (which will use llms.txt to find official documentation). Inform the user in their language that the KB doesn't have a detailed integration guide for this feature, and present the official docs instead.
> - **When `response.status == 'status_planned'`**: the slice is indexed but not yet written. Show the user `matches[0]`'s index-level description, tell them this feature's detailed playbook is still being authored, and offer to fall back to `docs/SKILL.md` for the official-doc equivalent.
> - **When `response.status == 'ambiguous_product'`**: the user's description plausibly matches multiple products (`response.ambiguous_candidates`). Ask the user to confirm which product, then re-call search with the confirmed `product` set. Do NOT pick silently.
>
> Users never see that search was involved — you compose the final answer with the slice content.

Recap example:
> Alright — Live on iOS, adding gift function to your existing project. I see your Podfile already has AtomicXCore and LoginStore is set up, so we'll start at the gift module directly.

## A2-Q0 — Scenario vs single-feature branching

Skip if `intent = integrate-feature` was already explicitly set (user said "add gift" — no need to ask about scenarios).

Ask when `intent = integrate-scenario`, or when the user finished Path A1 of a product that supports scenario-based UI (Conference / Live), or when `target_features` is empty.

Question text: "What kind of experience are you building?"

Options are **product-dependent**. Pull the concrete scenario list from `knowledge-base/index.yaml` scenarios whose `product` matches the identified product. The sets below are reference — always cross-check against the current index.

**If `product = conference`:**

| # | Option | Fills |
|---|--------|-------|
| 1 | Webinar / large-audience seminar | `scenario = webinar-large` |
| 2 | Online education / classroom | `scenario = online-classroom` |
| 3 | Telemedicine / remote consultation | `scenario = telemedicine` |
| 4 | Corporate / internal team meeting | `scenario = corporate-meeting` |
| 5 | I want to pick individual features myself | fall through to A2-Q1 |
| 6 | Type something | free-text |

**If `product = live`:**

| # | Option | Fills |
|---|--------|-------|
| 1 | Entertainment live room (gifts, barrage, co-guest) | `scenario = entertainment-live-room` |
| 2 | E-commerce live streaming | `scenario = ecommerce-live` |
| 3 | I want to pick individual features myself | fall through to A2-Q1 |
| 4 | Type something | free-text |

When a scenario is chosen:

1. **Handoff to `topic/SKILL.md`.** Scenario-driven step-by-step execution (reading the scenario file, walking the ordered slice list, loading per-step slices, pausing between steps, verification checklist) is topic's responsibility, not onboarding's. Onboarding A2 owns intent identification and scenario selection; once a scenario is picked, topic owns the drive.
2. Pass the scenario id and the current `session_context` (product, platform, credentials if collected, `target_features`, `project_state`) to topic as inputs. Topic will read `knowledge-base/{scenario.file}` itself.
3. Save `session_context.current_step = 'topic-handoff'` and `session_context.scenario = <chosen-id>` so if the user later returns mid-flow, routing can resume topic from where it paused.
4. Do NOT run A2-Q1 (module selection) or A2-Q3 (per-step execution) for scenario-driven flows — those paths are for `intent = integrate-feature` only.

Scenario-driven UI presets, default layouts, and scenario-specific A2-Q4 tweaks are not onboarding's concern after handoff — topic handles them (or defers UI adjustments back to the user as a follow-up).

If the chosen scenario has `status: planned` in the index: tell the user (in their own language) that the detailed playbook for this scenario is still being written, and offer two options — (a) fall through to A2-Q1 for manual module selection, or (b) let onboarding/topic compose the flow on-the-fly from the available slices. Do NOT silently hand off to topic in this case; topic needs a concrete scenario file to drive its walk-through.

## A2-Q1 — Module selection (single-feature mode)

Trigger: `intent = integrate-feature`, or the user chose "pick individual features" in A2-Q0, or A2-Q0 was skipped.

Question text: "Which modules do you want to integrate? (multi-select; login is required as the foundation)"

Options are **product-dependent**. Pull from `knowledge-base/index.yaml` slices filtered by product. Example for `product = live`:

| # | Option | Slice |
|---|--------|-------|
| 1 | Login & authentication (required) | live/login-auth |
| 2 | Anchor broadcast + device control | live/anchor-preview + device-control + anchor-lifecycle |
| 3 | Audience watch + live list | live/audience-watch + live-list |
| 4 | Barrage (live comments) | live/barrage |
| 5 | Gift | live/gift |
| 6 | Co-guest (audience goes on mic) | live/coguest-apply |
| 7 | Beauty filters | live/beauty |
| 8 | Audio effects | live/audio |
| 9 | Audience management (mute, kick, admin) | live/audience-manage |
| 10 | Type something | free-text |

Use `AskUserQuestion` with `multiSelect: true`.

## A2-Q2 — Credentials

Reuse A1-Q1 format (see `reference/path-a1-demo.md`). Skip entirely if `credentials.sdk_app_id_provided` and `credentials.secret_key_provided` are both `true` in the session file.

**Important**: the actual SDKAppID / SecretKey values are **never** written to `.trtc-session.yaml`. After the user pastes them, hold them in conversation context only. Update the session file's `credentials.sdk_app_id_provided` / `credentials.secret_key_provided` booleans to `true` — and persist those booleans as part of the next Checkpoint write (do not trigger an extra Write just for credentials).

## A2-Q3 — Per-step confirmation

After writing code for each step, call `apply/SKILL.md` as described in **"Calling apply"** above. Only report the step done after `response.status` is `pass` (or `partial` with no `critical` severity issues). Summarize the outcome to the user using this template:

```
Step {n} ({slice name}) done.
Changes: {N files added, M files modified}. Did not touch {AppDelegate.swift / main.ts / etc.}.
Compile check: passed — `{compile_command}` exit 0.
```

**Persist session state** (see `SKILL.md` § Session context → Checkpoints). After a step passes apply:
- Set `current_step` to the next step's id (e.g. from `A2.3` to `A2.4`)
- Append the just-completed slice id to `completed_steps`
- Update `updated_at` timestamp
- Write to `.trtc-session.yaml`

**First Write of the session** (i.e. right after Stage 1 calibration confirmed, before this step executes): create the file with `status: active`, all inferred fields filled, and trigger the `.gitignore` auto-update flow described in `SKILL.md` § Session context.

If apply returns `fail`, do NOT write this summary **and do NOT advance `current_step` in the session file**. Follow the retry rules in **"Calling apply → Acting on retry_hint"** (max 2 apply calls per step). If the step ultimately gives up, surface a message framed as "I hit a snag on step {n}" — never "apply skill said X" — and list what was tried.

Question text: "What would you like to do next?"

| # | Option | Action |
|---|--------|--------|
| 1 | Continue to the next step | advance `current_step`, load next slice |
| 2 | Walk me through why this code is structured this way | expand the slice's ALWAYS/NEVER rationale (no session write) |
| 3 | I want to adjust this step's code | collect diff request; after adjusted code passes apply again, re-write session as in the normal Step passes-apply flow |
| 4 | Pause here | set `status: paused`, keep `current_step` unchanged, Write session; exit the loop |
| 5 | Type something | free-text |

## A2-Q4 — Completion

After all planned steps are done.

Question text: "Integration finished. What's next?"

| # | Option | Action |
|---|--------|--------|
| 1 | Add another feature | loop back to A2-Q1 (as single-feature mode); session `status` stays `active` |
| 2 | Tweak the UI | go to A2-Q4-UI (below); session `status` stays `active` |
| 3 | I'm good for now | set `status: completed`, Write session, end onboarding cleanly |
| 4 | Type something | free-text |

### A2-Q4-UI — UI customization sub-flow

Question text: "Which aspect of the UI do you want to adjust?"

| # | Option | Example change |
|---|--------|----------------|
| 1 | Brand color (primary accent) | example: `#FF6B6B` (coral) instead of the default blue |
| 2 | Font family / size | example: switch to `"PingFang SC"`, body text from 14pt to 16pt |
| 3 | Corner radius (buttons, cards) | example: `12px` for a softer look, `0` for sharp edges |
| 4 | Dark or light mode | example: force dark mode, or follow system preference |
| 5 | Custom color for a specific element — tell me which | free-text, format `{element}: {color}` (e.g., "send button: #4ECDC4") |
| 6 | Type something | free-text |

Apply rules:

- **Scope is UI layer only.** Modify theme tokens / stylesheets / component styling. Do NOT change SDK calls, store logic, event handlers, or data flow. This preserves the integration that passed the internal compile gate.
- For option 5 (custom color), parse the element name and map it to the nearest semantic token in the generated code. If ambiguous, show the user 2-3 candidate matches and let them pick.
- Store choices in `ui_preferences` in the session file so subsequent feature additions (via A2-Q4 option 1) reuse them automatically. This write piggybacks on the next Checkpoint (e.g. the next successful A2-Q3 step or A2-Q4 completion); don't trigger an extra Write just for UI tweaks.
- After each change, ask: "Apply and continue, or adjust more?" — re-show A2-Q4-UI options if the user wants more, otherwise return to A2-Q4.
