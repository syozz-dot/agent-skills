# UIKit Class → AtomicXCore Composable Bindings

> **Internal asset.** Consumed by `topic/SKILL.md` when generating full-ui
> Vue SFCs. Maps UIKit component class names (defined in
> `uikit/references/component-catalog.md`) to AtomicXCore composables and
> reactive Vue bindings. Users never read this file.

> **Caveat:** composable names below are assumed based on the AtomicXCore Vue 3
> SDK surface (`useLoginState` / `useRoomState` / `useDeviceState` /
> `useRoomParticipantState`). Verify against the actual installed SDK version
> before generation and adjust as needed.

## Device controls

| UIKit class pattern | Composable | Vue binding example |
|---|---|---|
| `.ui-icon-button.is-off` (mic) | `useDeviceState()` + `useRoomParticipantState()` | `:class="{ 'is-off': isMicOff }" @click="toggleMic"` |
| `.ui-icon-button.is-off` (camera) | `useDeviceState()` | `:class="{ 'is-off': isCameraOff }" @click="toggleCamera"` |
| `.ui-icon-button` (screen share) | `useDeviceState()` | `:class="{ 'is-active': isScreenSharing }" @click="toggleScreenShare"` |

**MUST rules for device controls:**

**Camera** — state source MUST be `cameraStatus` from `useDeviceState()`, NOT `localParticipant.isCameraDisabled`:
```ts
import { useDeviceState, DeviceStatus } from 'tuikit-atomicx-vue3/room';
const { cameraStatus, openLocalCamera, closeLocalCamera } = useDeviceState();

// ✅ Correct: physical device state
const isCameraOff = computed(() => cameraStatus.value !== DeviceStatus.On);

async function toggleCamera() {
  if (isCameraOff.value) {
    await openLocalCamera();
  } else {
    await closeLocalCamera();
  }
}
```
> ⚠️ `localParticipant.isCameraDisabled` is an admin-level moderation flag — it does NOT update when `openLocalCamera()`/`closeLocalCamera()` is called. Using it as the camera button state source causes the button to always appear "on" after `closeLocalCamera()`, making it impossible to reopen the camera.

**Screen Share** — `isScreenSharing` MUST be derived from `screenStatus`; toggle MUST call `startScreenShare`/`stopScreenShare`:
```ts
import { useDeviceState, DeviceStatus } from 'tuikit-atomicx-vue3/room';
const { screenStatus, startScreenShare, stopScreenShare } = useDeviceState();

const isScreenSharing = computed(() => screenStatus.value === DeviceStatus.On);

async function toggleScreenShare() {
  if (isScreenSharing.value) {
    await stopScreenShare();
  } else {
    await startScreenShare();
  }
}
```
> ⚠️ `startScreenShare()` / `stopScreenShare()` MUST both be destructured and called — the screen share button MUST NOT be left as a static placeholder or with only one direction wired.

**Mic** — the mic toggle MUST use `muteMicrophone`/`unmuteMicrophone` from `useRoomParticipantState()` for in-meeting mute/unmute (not `closeLocalMicrophone`/`openLocalMicrophone`). `isMicOff` should be tracked via a local `ref(true)` initialized on join:
```ts
import { useDeviceState } from 'tuikit-atomicx-vue3/room';
import { useRoomParticipantState } from 'tuikit-atomicx-vue3/room';
const { openLocalMicrophone } = useDeviceState();
const { muteMicrophone, unmuteMicrophone } = useRoomParticipantState();

const isMicOff = ref(true);

// On room join: pre-mute then start capture
async function prepareMic() {
  await muteMicrophone();
  await openLocalMicrophone();
  isMicOff.value = true;
}

async function toggleMic() {
  if (isMicOff.value) {
    await unmuteMicrophone();
    isMicOff.value = false;
  } else {
    await muteMicrophone();
    isMicOff.value = true;
  }
}
```

## Room state

| UIKit class pattern | Composable | Vue binding example |
|---|---|---|
| `.ui-topbar__title` | `useRoomState()` | `{{ roomName }}` |
| `.ui-topbar__time` | `useRoomState()` | `{{ elapsed }}` |
| `.ui-btn--end` (leave button) | `useRoomState()` | `@click="leaveRoom"` |

## Participants

| UIKit class pattern | Composable | Vue binding example |
|---|---|---|
| `.ui-stage__tile` (video tile) | `useRoomParticipantState()` | `v-for="p in participants" :key="p.userId"` |
| `.ui-list-row` (member row) | `useRoomParticipantState()` | `v-for="p in participants" :key="p.userId"` |
| `.ui-video-badge__name` | `useRoomParticipantState()` | `{{ p.userName }}` |
| `.ui-avatar` (dynamic avatar) | `useRoomParticipantState()` | `:style="{ backgroundImage: 'url(' + p.avatar + ')' }"` |

## Side panels

| UIKit class pattern | Vue state | Vue binding example |
|---|---|---|
| `.ui-side-panel.is-open` | `const activePanel = ref(null)` | `:class="{ 'is-open': activePanel }"` |
| `.ui-side-panel__close` | same | `@click="activePanel = null"` |
| `.mc-app.is-panel-open` | same | `:class="{ 'is-panel-open': activePanel }"` |

## Static-to-reactive replacement rules

1. Any `.is-off` / `.is-on` / `.is-open` / `.is-active` static class →
   `:class="{ '<class>': <reactive state> }"`
2. Any hardcoded participant data (avatar URL / name / message) →
   `v-for` + a reactive array returned by the mapped composable
3. Every button → `@click` binding to the corresponding composable action
4. Retain as static (do NOT replace): layout / size / color classes that carry
   no state (e.g. `.ui-icon-button`, `.ui-icon-button__iconrow`,
   `.ui-icon--lg`)
5. Inline styles are retained only for the three data-driven cases listed in
   `uikit/references/token-contract.md` (`background-image`, `--level`,
   `--stage-off-avatar`)

## Chat

> Import path: `tuikit-atomicx-vue3/chat`
> Required: call `setActiveConversation(`GROUP${roomId}`)` immediately after
> `roomId` is available — MUST include the `GROUP` prefix.

| UIKit class pattern | Composable | Vue binding example |
|---|---|---|
| `.ui-chat-list` (message scroll container) | `useMessageListState()` | `v-for="msg in messageList" :key="msg.ID"` |
| `.ui-chat-message` (each message row) | `useMessageListState()` | `v-for="msg in messageList" :key="msg.ID"` |
| `.ui-chat-message--me` (self message variant) | `useMessageListState()` + local userId | `:class="['ui-chat-message', { 'ui-chat-message--me': msg.from === selfUserId }]"` |
| `.ui-chat-message__meta` (sender + time) | `useMessageListState()` | `{{ msg.nick || msg.from }} {{ formatTime(msg.clientTime) }}` |
| `.ui-chat-message__bubble` (message text) | `useMessageListState()` | `{{ msg.payload?.text }}` |
| `.ui-chat-input__textarea` | `useMessageInputState()` | `:value="inputRawValue" @input="(e) => updateRawValue((e.target as HTMLTextAreaElement).value)"` |
| `.ui-btn--send` | `useMessageInputState()` | `@click="handleSend" :disabled="isMessageDisabled || !inputRawValue?.trim()"` |
| Conversation binding (on roomId change) | `useConversationListState()` | `watch(() => currentRoom.value?.roomId, id => { if (id) setActiveConversation(`GROUP${id}`); }, { immediate: true })` |

**MUST rules for chat region:**
- Always use `GROUP` prefix when calling `setActiveConversation`
- Always call `updateRawValue('')` after a successful `sendMessage()`
- Guard send with `isMessageDisabled` check before `sendMessage()`
- The `.ui-chat-list` container must have a stable height (`flex: 1; overflow-y: auto`) so the stage layout does not shift when messages arrive

**MUST NOT:**
- Never pass bare `roomId` without the `GROUP` prefix to `setActiveConversation`
- Never use a rich-text editor API for the plain textarea input — use `updateRawValue` only

## Fallback when a composable is absent from the scenario

If the scenario's slice list does not cover a given composable (e.g.
`general-meeting` has no raise-hand), topic either (a) omits the corresponding
UI region, or (b) keeps a static placeholder. Topic chooses based on whether
the region is structurally essential (toolbar / stage → keep placeholder;
side-panel tab → omit).

**Exception — Chat region:** the `.ui-chat-list` / `.ui-chat-input` region
is always treated as structurally essential for Conference scenarios. If
`conference/room-chat` is present in the scenario's slice list, it MUST be
fully implemented — a stub placeholder is not acceptable. If the slice is
genuinely absent from the scenario's slice list, omit the chat tab entirely
rather than producing a non-functional placeholder.
