---
name: trtc-search
description: >
  Search the TRTC knowledge base for specific SDK capabilities, API patterns,
  error codes, and integration scenarios. Use this skill when the user asks
  "how do I do X with TRTC", "what's the API for Y", "find me info about Z",
  or wants to discover what capabilities are available for a given TRTC product.
  Also trigger when the user asks about specific TRTC error codes, SDK behaviors,
  or wants to compare approaches across platforms. This skill searches the local
  knowledge base index and loads relevant slice content.
---

# TRTC Knowledge Base Search

You search the TRTC knowledge base to find relevant atomic capabilities (slices) and integration scenarios for the user.

## Search workflow

### Step 1: Read the index

Read `knowledge-base/index.yaml` to get the full catalog of slices and scenarios. This file contains:
- **products**: List of TRTC products with descriptions and supported platforms
- **slices**: Each slice has `id`, `name`, `tags`, `platforms`, `file`, `platform_files`, `related`, `description`, and optionally `status`
- **scenarios**: Each scenario has `id`, `name`, `slices` (references), `file`, `description`

### Step 2: Match the user's question

Search the index using multiple strategies (try them in this order, and collect all matches):

1. **Direct ID match** — the user mentions a slice ID like "chat/multi-instance"
2. **Error code match** — the user mentions an error code; scan slice descriptions and tags for it
3. **Tag match** — extract keywords from the user's question and match against slice `tags` arrays
4. **Product + keyword match** — narrow by product, then fuzzy match against `name` and `description`
5. **Scenario match** — the user describes a workflow that matches a scenario's description

Rank matches by relevance. If multiple slices match, list them all — the user might need several.

### Step 3: Load the content

For each matching slice:

1. **Load the product-level overview**: Read `knowledge-base/{slice.file}`
   - This gives you cross-platform concepts, best practices (ALWAYS/NEVER), error codes, and troubleshooting flows

2. **Load platform-specific detail** (only if the user specified a platform): Read `knowledge-base/{slice.platform_files[platform]}`
   - This gives you API calls, code examples, and platform-specific gotchas

3. If a scenario matched, also read `knowledge-base/{scenario.file}`

For slices with `status: planned`, don't try to read the file — it doesn't exist yet. Report what you know from the index.

### Step 4: Present the results

Structure your response like this:

**For a single matching slice:**
Start with the most relevant section from the product overview (don't dump the entire file — focus on what the user asked about). If they specified a platform, weave in the platform-specific details and code examples. End with links to official docs from the slice's frontmatter.

**For multiple matches:**
Give a brief summary of each match so the user can pick which one to dive into:

```
I found these relevant capabilities:

1. **chat/multi-instance** — 多实例/多端并发: Multi-device login strategies, kick-offline handling
   Platforms: web, android, ios

2. **chat/login** — 登录与认证: SDK initialization, UserSig, login flow
   Platforms: web, android, ios, flutter
   ⚠️ Status: planned (content coming soon)

Which one would you like to explore?
```

**For scenario matches:**
Mention that a complete integration guide exists and offer to walk through it step-by-step (which would switch to the topic sub-skill flow).

### When nothing matches

If the knowledge base doesn't have relevant content:
1. Say so clearly — "The knowledge base doesn't have a slice for this yet."
2. List what IS available, in case it's close to what they need
3. Point them to official TRTC documentation (trtc.io) for topics not yet covered
