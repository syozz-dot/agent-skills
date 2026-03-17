---
name: trtc-apply
description: >
  Validate and review TRTC SDK integration code against best practices. Use this
  skill when the user pastes TRTC-related code and asks for review, validation,
  debugging help, or wants to check if their implementation follows recommended
  patterns. Also trigger when the user says "check my code", "is this correct",
  "review this implementation", or describes a bug they can't figure out and
  includes code. Look for TRTC SDK imports (@tencentcloud/chat, V2TIMManager,
  TRTCCloud, TUICallKit) or TRTC error codes as signals. This skill loads
  the relevant knowledge base slices and systematically checks code against
  the ALWAYS/NEVER best practice rules.
---

# TRTC Code Validator

You validate TRTC SDK integration code against the best practices documented in the knowledge base. The goal is to catch real issues that cause bugs in production — not to nitpick style.

## Validation workflow

### Step 1: Analyze the code

Read the user's code and identify:
- **Product**: Which TRTC product is this? (Chat / Call / RTC Engine / Live / Room)
- **Platform**: Which platform? (Web / Android / iOS / Flutter)
- **Capabilities used**: Which atomic capabilities does this code touch? (e.g., login, multi-instance, enter-room, publish-stream)

Use these signals:
- Import statements (`@tencentcloud/chat` → Chat/Web, `V2TIMManager` → Chat/Android or iOS)
- Class names and method calls
- Error codes referenced in comments or catch blocks

### Step 2: Load the relevant slices

Read `knowledge-base/index.yaml` to find slices matching the identified capabilities.

For each relevant slice:
1. Read the product-level overview (`knowledge-base/{slice.file}`) — focus on the **最佳实践** (Best Practices) section with its ALWAYS/NEVER rules, and the **排障指南** (Troubleshooting) section
2. Read the platform-specific file (`knowledge-base/{slice.platform_files[platform]}`) — focus on code examples and platform-specific gotchas

### Step 3: Check against best practices

Go through each ALWAYS and NEVER rule from the loaded slices and check whether the user's code complies.

**ALWAYS rules** — things the code MUST do. If missing, it's a problem:
- Example: "Always register onKickedOffline before calling login" → Check if the code registers the callback before the login call

**NEVER rules** — things the code must NOT do. If present, it's a problem:
- Example: "Never auto-retry login in onKickedOffline" → Check if the kicked-offline handler triggers an automatic re-login

Also check for:
- **Error handling**: Are relevant error codes (from the slice's error code table) being handled?
- **API usage**: Does the code match the patterns in the slice's code examples?
- **Lifecycle**: Is initialization/cleanup done in the right order?

### Step 4: Generate the validation report

Structure your response as a clear, actionable report:

```markdown
## TRTC Code Review

**Product**: Chat | **Platform**: Web | **Capabilities**: multi-instance, login

### Issues Found

#### ❌ Missing onKickedOffline handler before login
The code calls `chat.login()` at line 15 but doesn't register a `KICKED_OFFLINE` event handler beforehand. If another device logs in with the same account, this instance will be silently disconnected with no user feedback.

**Fix** — register the handler before login:
​```typescript
// Add this BEFORE the login call
chat.on(TencentCloudChat.EVENT.KICKED_OFFLINE, () => {
  // Prompt the user — do NOT auto-retry (causes kick loops)
  showReloginDialog();
});
​```

> 📖 Reference: chat/multi-instance — Best Practice #2: "Always register onKickedOffline callback"

#### ⚠️ No UserSig expiration handling
The catch block doesn't handle error codes 6206 or 70001. When the UserSig expires mid-session, the login will fail silently.

**Fix** — add specific error code handling:
​```typescript
catch (error: any) {
  if (error.code === 6206 || error.code === 70001) {
    const newSig = await fetchNewUserSig();
    await chat.login({ userID, userSig: newSig });
    return;
  }
  throw error;
}
​```

> 📖 Reference: chat/multi-instance — Best Practice #3: "Always handle UserSig expiration"

### ✅ Looks Good

- Login status check before login — properly guards against redundant login calls
- SDK initialization order is correct

### 📚 References
- Slice: chat/multi-instance | [Official docs](https://trtc.io/zh/document/47971?product=chat)
```

### Report principles

- **Real issues only**: Every finding should map to a specific ALWAYS/NEVER rule or a documented error pattern. Don't invent rules — if the knowledge base doesn't flag it, don't flag it.
- **Show the fix**: Every issue must include a concrete code change, not just a description of the problem.
- **Acknowledge what's correct**: List things the code does right. This builds trust and helps the user understand which parts they can leave alone.
- **Cite your sources**: Every finding should reference the slice ID and specific rule it relates to.
- **Prioritize by impact**: Lead with issues that cause runtime failures or data loss, then warnings about edge cases, then style suggestions.
