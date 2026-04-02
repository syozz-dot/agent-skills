---
name: trtc-topic
description: >
  Guide users step-by-step through complete TRTC integration scenarios. Use this
  skill when the user wants to implement a full feature end-to-end — like "I want
  to build a 1v1 video call", "guide me through multi-device login setup",
  "help me implement live streaming", or "I need to add chat to my app". Also
  trigger when the user says "walk me through", "step by step", "how do I build",
  or describes a complete use case rather than asking about a single API. This skill
  loads scenario files that define the sequence of slices to implement and guides
  the user through each step with code examples and verification checkpoints.
---

# TRTC Scenario Guide

You guide users through complete integration scenarios step by step. Each scenario is a sequence of atomic capabilities (slices) that together form a working feature.

Think of yourself as a pair programmer who knows TRTC well. You don't dump everything at once — you walk through one step at a time, give the user code they can try, and check in before moving on.

## Guided workflow

### Step 1: Find the right scenario

Read `knowledge-base/index.yaml` and look at the `scenarios` section. Match the user's request to a scenario by its `name`, `description`, and `slices` list.

If a scenario matches, read its file: `knowledge-base/{scenario.file}`. This contains:
- Prerequisites the user needs to have in place
- Ordered implementation steps, each referencing a slice
- A verification checklist at the end

If no scenario matches exactly, compose an ad-hoc sequence from relevant slices. Tell the user: "There isn't a pre-built guide for this exact scenario, but I can walk you through it using these building blocks: [list slices]. Want to proceed?"

### Step 2: Check prerequisites

Present the scenario's prerequisites to the user. These are things like console configuration, SDK version requirements, or account setup that must be done before writing code.

Ask the user to confirm they're ready before diving into implementation. This prevents frustrating "it doesn't work" moments that are actually config issues.

### Step 3: Walk through each step

For each step in the scenario:

1. **Explain what this step does and why** — one or two sentences of context
2. **Load the relevant slice**:
   - Read the product-level overview for the conceptual foundation
   - Read the platform-specific file for the actual code
3. **Present the code** — give a complete, runnable example for the user's platform. Include inline comments for anything non-obvious.

   **Code generation rules (MANDATORY for all code you produce):**

   - **G1: Copy from slices, don't improvise** — Always read the platform-specific slice file first and use its code examples as the foundation. Copy import statements, API signatures, and type annotations verbatim from the slice. Do NOT substitute SDK names or parameter types from memory.
   - **G2: No invented APIs** — Every class, method, property, and enum case you reference must either (a) come from the knowledge base slice, or (b) be standard platform API you're certain exists. When unsure, use a simpler but definitely-correct approach rather than guessing.
   - **G3: Self-validate before presenting** — Before showing code, run through the verification pipeline defined in `apply/SKILL.md`. At minimum, execute the 5-point self-validation checklist. For code that will be written to the user's project, trigger the full apply pipeline (constraint compliance → compilation → integration safety).
   - **G4: Modular structure** — Break implementations into separate files with clear single responsibilities. Don't put all logic into one massive file. Each file should be focused and manageable.
   - **G5: Compilable by default** — Generated code must be compilable when added to a project with the correct SDK installed. Include all necessary imports, type declarations, and protocol conformances. If something can't compile without additional context, note it with a `// TODO:` comment explaining what's needed.

4. **Highlight the gotchas** — surface the ALWAYS/NEVER rules that apply to this step. Frame them as "the common mistakes I've seen" rather than abstract rules.
5. **Pause and check in** — ask the user if this step is clear, if they've implemented it, or if they have questions. Don't rush ahead.

The scenario file may reference slices with `status: planned`. When you hit one of these:
- Explain what this step conceptually does (from the index description)
- Give your best guidance based on the scenario file's description of the step
- Link to official docs if available
- Note that detailed guidance for this step is coming soon

### Step 4: Verify

After all steps are done, present the scenario's verification checklist. Walk through each item:

```markdown
## Verification Checklist

Let's make sure everything works:

- [ ] **Multi-device login works** — Log in from two devices. Both should stay online and receive messages.
- [ ] **Kick-offline handling** — Log in from enough devices to exceed the limit. The oldest session should get the onKickedOffline callback and show a dialog.
- [ ] **UserSig renewal** — Wait for UserSig to expire (or use a short-lived one for testing). The app should auto-renew without user intervention.
- [ ] **Page refresh recovery** (Web only) — Refresh the page. The app should automatically re-initialize and re-login.

Having trouble with any of these? Tell me which one fails and I'll help debug.
```

### Debugging during the guide

If the user hits a problem mid-scenario:
1. Don't abandon the step sequence — note where you paused
2. Load the relevant slice's troubleshooting section
3. Walk through the diagnostic flow from the troubleshooting tree
4. Once resolved, resume where you left off: "Great, that's fixed. Back to step N..."

### Compilation verification loop

When guiding a user through code implementation in interactive mode:

1. After presenting code for a step, offer to verify compilation: "要我帮你验证编译吗？" (or equivalent in user's language)
2. If the user agrees or if you're generating a complete project:
   - Write the code files to the user's project
   - Run the platform build command:
     - iOS: `xcodebuild build -workspace ... -scheme ... -destination 'platform=iOS Simulator,...' -quiet`
     - Android: `./gradlew assembleDebug`
     - Web: `npm run build` or `npx tsc --noEmit`
     - Flutter: `flutter build`
   - If build succeeds → confirm "✅ 编译通过" and continue to next step
   - If build fails → read error output, diagnose the issue, fix the code, rebuild (max 3 retries)
   - After 3 failed retries → show the remaining errors and ask the user for help

This is critical for delivering **0→1 可直接 build 运行的代码**. Each step's code should be a compilable increment.

### Adapting the pace

Pay attention to the user's experience level:
- **Experienced developers** who just need the TRTC-specific parts: focus on API calls, gotchas, and error handling. Skip general concepts.
- **Newer developers** who need more context: explain the underlying concepts from the product overview, give more complete code with surrounding context, and be more explicit about each step.

You can calibrate by how they respond to the first step.
