#!/usr/bin/env python3
"""cursor-adapter.py — Translate Cursor hook protocol to existing Claude-format guardrails.

Wired from hooks-cursor.json. Each Cursor hook event runs:

    python3 ./hooks/cursor-adapter.py <dispatch-key>

This script:
  1. Reads the Cursor hook envelope from stdin (camelCase fields).
  2. Normalizes it to the {tool_name, tool_input} shape the existing
     guardrail scripts in skills/*/guardrails/ expect.
  3. Sets CLAUDE_PLUGIN_ROOT and CLAUDE_PROJECT_DIR env vars so the
     existing scripts find sessions and shared libs unchanged.
  4. Spawns the underlying script and propagates stdout/stderr.
  5. Translates exit codes:
       Claude Code: 0=allow, 1=fail, 2=block
       Cursor:      0=success, 2=deny (with JSON), other=fail-open
     We map Claude exit 1 and exit 2 -> Cursor deny (exit 2 + JSON on stdout).

Fail-open principle: if anything goes wrong inside the adapter (missing
script, malformed stdin, dispatch key unknown), we exit 0 silently so a
broken adapter never blocks the user's workflow.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

ADAPTER_DIR = Path(__file__).resolve().parent
PLUGIN_ROOT = ADAPTER_DIR.parent  # plugin install root


# Dispatch table: dispatch_key -> relative script path under PLUGIN_ROOT.
DISPATCH = {
    "trtc-prepare-ui":      "skills/trtc/room-builder/guardrails/trtc_prepare_ui.py",
    "gate-slice-read":      "skills/trtc-topic/guardrails/gate_slice_read.py",
    "gate-slice-write":     "skills/trtc-topic/guardrails/gate_slice_write.py",
    "verify-ui-post-write": "skills/trtc/room-builder/guardrails/verify_ui_post_write.sh",
    "verify-slice-must":    "skills/trtc-apply/guardrails/verify_slice_must_rules.py",
    "stop-apply-evidence":  "skills/trtc-topic/guardrails/stop_require_apply_evidence.py",
    "trtc-verify-ui":       "skills/trtc/room-builder/guardrails/trtc_verify_ui.py",
    "verify-apply-project": "skills/trtc-apply/guardrails/verify_apply_project.py",
}

# Dispatch keys whose underlying scripts read JSON from stdin.
# Other keys are CLI-only and will receive empty stdin.
STDIN_KEYS = {
    "gate-slice-read",
    "gate-slice-write",
    "verify-ui-post-write",
    "verify-slice-must",
}


def _silent_allow() -> None:
    """Fail-open: never block the user because the adapter itself failed."""
    sys.exit(0)


def _read_cursor_payload() -> dict:
    raw = sys.stdin.read()
    if not raw or not raw.strip():
        return {}
    try:
        data = json.loads(raw)
        return data if isinstance(data, dict) else {}
    except (ValueError, TypeError):
        return {}


def _translate_payload(key: str, cursor: dict) -> dict:
    """Map Cursor's per-event payload to the {tool_name, tool_input} envelope
    the existing guardrails expect.

    The existing scripts read either:
      - {"tool_name": "Read",       "tool_input": {"file_path": "..."}}
      - {"tool_name": "Write|Edit", "tool_input": {"file_path": "..."}}
    """
    if key == "gate-slice-read":
        # Cursor's beforeReadFile payload: {file_path, content, attachments, ...}
        file_path = cursor.get("file_path") or cursor.get("filePath")
        return {"tool_name": "Read", "tool_input": {"file_path": file_path}}

    if key == "gate-slice-write":
        # Cursor's preToolUse payload: {tool_name, tool_input, tool_use_id, cwd, ...}
        # Cursor only emits "Write" (no separate "Edit"); existing script
        # accepts both. Pass through unchanged when tool_name is Write/Edit;
        # silent allow for unrelated tools.
        tool_name = cursor.get("tool_name") or cursor.get("toolName")
        if tool_name not in ("Write", "Edit"):
            return {}  # caller will silent-allow
        tool_input = cursor.get("tool_input") or cursor.get("toolInput") or {}
        return {"tool_name": tool_name, "tool_input": tool_input}

    if key in ("verify-ui-post-write", "verify-slice-must"):
        # Cursor's afterFileEdit payload: {file_path, edits}
        file_path = cursor.get("file_path") or cursor.get("filePath")
        return {"tool_name": "Edit", "tool_input": {"file_path": file_path}}

    # CLI-only events (sessionStart, stop) get empty stdin — they read state
    # from session files and env vars, not stdin.
    return {}


def _emit_cursor_deny(message: str) -> None:
    """Cursor deny protocol: JSON on stdout + exit 2."""
    payload = {
        "permission": "deny",
        "agent_message": message or "Blocked by TRTC guardrail.",
    }
    sys.stdout.write(json.dumps(payload))
    sys.stdout.flush()
    sys.exit(2)


def main(argv: list[str]) -> None:
    if len(argv) < 2:
        _silent_allow()

    key = argv[1]
    rel_script = DISPATCH.get(key)
    if not rel_script:
        # Unknown dispatch key — never block on adapter misconfiguration.
        _silent_allow()

    script = PLUGIN_ROOT / rel_script
    if not script.exists():
        # Script missing (e.g., skill not installed). Same convention the
        # existing hooks.json uses ("[ ! -f X ] || python3 X").
        _silent_allow()

    cursor_payload = _read_cursor_payload()
    claude_payload = _translate_payload(key, cursor_payload)

    # gate-slice-write returns {} when tool isn't Write/Edit -> silent allow.
    if key == "gate-slice-write" and not claude_payload:
        _silent_allow()

    # Build env: surface Cursor's project dir as CLAUDE_PROJECT_DIR so
    # existing scripts that key off CLAUDE_PROJECT_DIR keep working.
    env = dict(os.environ)
    cursor_project_dir = env.get("CURSOR_PROJECT_DIR") or cursor_payload.get("cwd")
    if cursor_project_dir and not env.get("CLAUDE_PROJECT_DIR"):
        env["CLAUDE_PROJECT_DIR"] = cursor_project_dir
    env["CLAUDE_PLUGIN_ROOT"] = str(PLUGIN_ROOT)

    runner = ["bash", str(script)] if script.suffix == ".sh" else ["python3", str(script)]
    stdin_data = json.dumps(claude_payload) if key in STDIN_KEYS else ""

    try:
        proc = subprocess.run(
            runner,
            input=stdin_data,
            text=True,
            env=env,
            capture_output=True,
            timeout=30,
        )
    except (subprocess.TimeoutExpired, OSError):
        _silent_allow()

    # Forward whatever the inner script wrote.
    if proc.stdout:
        sys.stderr.write(proc.stdout)  # inner stdout goes to stderr to avoid
                                       # corrupting our Cursor JSON channel
    if proc.stderr:
        sys.stderr.write(proc.stderr)

    rc = proc.returncode
    if rc == 0:
        sys.exit(0)
    if rc in (1, 2):
        # Translate fail/block into Cursor's deny envelope. Use stderr
        # content as the agent-facing message so the existing scripts'
        # human-readable explanations reach the user.
        msg = (proc.stderr or proc.stdout or "").strip()
        _emit_cursor_deny(msg)

    # Unknown exit code — fail open to mimic Claude Code's permissive default.
    _silent_allow()


if __name__ == "__main__":
    main(sys.argv)
