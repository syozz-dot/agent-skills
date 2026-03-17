## TRTC Code Review

**Product**: Chat | **Platform**: Web | **Capabilities**: login, multi-instance (kicked offline handling)

---

### Issues Found

#### ❌ 严重：在 `onKickedOffline` 回调中自动重新登录 — 会导致互踢死循环

代码中 `KICKED_OFFLINE` 事件的处理函数直接调用了 `init(userID, userSig)`，这会自动重新执行 `login`。当两端同时在线且超出实例上限时，A 被踢下线后自动重新登录，会踢掉 B，B 如果也有类似逻辑又会踢掉 A，形成无限互踢循环（ping-pong kick loop）。

```typescript
// ❌ 当前代码 — 自动重新登录，会导致互踢死循环
chat.on(TencentCloudChat.EVENT.KICKED_OFFLINE, () => {
  init(userID, userSig); // 危险！自动重新登录
});
```

**Fix** — 提示用户并让用户主动选择是否重新登录：

```typescript
chat.on(TencentCloudChat.EVENT.KICKED_OFFLINE, () => {
  // ✅ 提示用户，由用户决定是否重新登录
  showDialog({
    title: '下线通知',
    message: '您的账号在其他地方登录，您已被踢下线。',
    actions: [
      {
        text: '重新登录',
        onClick: () => safeLogin(userID, userSig),
      },
      {
        text: '退出',
        onClick: () => redirectToLoginPage(),
      },
    ],
  });
});
```

> 📖 Reference: chat/multi-instance — NEVER #4: "不要在 onKickedOffline 回调中自动重新登录 — 会造成两端不断互踢的死循环"

---

#### ❌ 事件监听注册顺序错误：应在 `login` 之前注册 `KICKED_OFFLINE`

代码中先调用 `await chat.login()`，然后才注册 `KICKED_OFFLINE` 事件监听。如果在 `login` 完成的极短时间窗口内另一端已登录并触发了互踢，当前实例会因为还未注册回调而丢失这个事件，用户将在不知情的情况下处于离线状态。

```typescript
// ❌ 当前代码 — 先 login，后注册回调
async function init(userID: string, userSig: string) {
  await chat.login({ userID, userSig });         // 先登录
  chat.on(TencentCloudChat.EVENT.KICKED_OFFLINE, () => { ... }); // 后注册
}
```

**Fix** — 将事件监听移到 `login` 之前（甚至移到 `init` 函数外部，在 SDK 创建后立即注册）：

```typescript
// ✅ 在 SDK 创建后、login 之前注册事件监听
chat.on(TencentCloudChat.EVENT.KICKED_OFFLINE, onKickedOffline);
chat.on(TencentCloudChat.EVENT.SDK_READY, onSDKReady);
chat.on(TencentCloudChat.EVENT.SDK_NOT_READY, onSDKNotReady);

async function init(userID: string, userSig: string) {
  await chat.login({ userID, userSig });
}
```

> 📖 Reference: chat/multi-instance — ALWAYS #2: "始终注册 onKickedOffline 回调 — 在 SDK 初始化后立即注册，确保在调用 login 之前注册好监听"

---

#### ❌ 缺少登录前状态检查 — 可能重复调用 `login`

`init` 函数在调用 `login` 之前没有检查当前登录状态。如果 `init` 被多次调用（例如页面逻辑重复触发），会导致重复登录，造成不必要的资源开销。

```typescript
// ❌ 当前代码 — 没有登录状态检查
async function init(userID: string, userSig: string) {
  await chat.login({ userID, userSig }); // 直接调用，不管当前状态
}
```

**Fix** — 在登录前使用 `getLoginStatus` 检查当前状态：

```typescript
async function init(userID: string, userSig: string) {
  const status = chat.getLoginStatus();
  if (status === TencentCloudChat.TYPES.LOGIN_STATUS_LOGINED) {
    console.log('已登录，无需重复登录');
    return;
  }
  if (status === TencentCloudChat.TYPES.LOGIN_STATUS_LOGINING) {
    console.log('正在登录中，请等待...');
    return;
  }
  await chat.login({ userID, userSig });
}
```

> 📖 Reference: chat/multi-instance — ALWAYS #1: "始终在登录前检查登录状态"；NEVER #2: "不要频繁重复调用 login"

---

#### ⚠️ 缺少 login 错误处理 — UserSig 过期等异常无法被捕获

`login` 调用缺少 `try/catch`，当 UserSig 过期（错误码 6206 / 70001）或其他异常发生时，Promise rejection 不会被处理，可能导致 `unhandledrejection` 错误。

```typescript
// ❌ 当前代码 — 没有 try/catch
await chat.login({ userID, userSig });
```

**Fix** — 添加错误处理，特别是 UserSig 过期的情况：

```typescript
async function init(userID: string, userSig: string) {
  try {
    await chat.login({ userID, userSig });
    console.log('登录成功');
  } catch (error: any) {
    switch (error.code) {
      case 6206:  // ERR_USER_SIG_EXPIRED
      case 70001: // ERR_SVR_ACCOUNT_USERSIG_EXPIRED
        console.error('UserSig 过期，请重新获取');
        const newSig = await fetchNewUserSig(userID);
        await chat.login({ userID, userSig: newSig });
        break;
      default:
        console.error('登录失败:', error.code, error.message);
    }
  }
}
```

> 📖 Reference: chat/multi-instance — ALWAYS #3: "始终处理 UserSig 过期"；错误码表: 6206 (`ERR_USER_SIG_EXPIRED`), 70001 (`ERR_SVR_ACCOUNT_USERSIG_EXPIRED`)

---

### ✅ Looks Good

- **SDK 初始化方式正确** — 使用 `TencentCloudChat.create({ SDKAppID })` 创建实例，符合 Web SDK 标准用法
- **使用了 async/await** — 登录使用 `await` 等待结果，而非忽略 Promise
- **确实监听了 KICKED_OFFLINE 事件** — 代码有处理互踢的意识，只是实现方式需要调整

---

### 🔧 完整修正后的代码

```typescript
import TencentCloudChat from '@tencentcloud/chat';

const chat = TencentCloudChat.create({ SDKAppID: 1400000000 });

// ✅ ALWAYS: 在 login 之前注册所有事件监听
chat.on(TencentCloudChat.EVENT.KICKED_OFFLINE, () => {
  console.warn('您的账号在其他设备/Tab 登录，当前实例已被踢下线');
  // ✅ 提示用户，不要自动重新登录
  showReloginDialog();
});

chat.on(TencentCloudChat.EVENT.SDK_READY, () => {
  console.log('SDK Ready - 可以使用各项功能了');
});

chat.on(TencentCloudChat.EVENT.SDK_NOT_READY, () => {
  console.warn('SDK Not Ready - 功能暂不可用');
});

async function init(userID: string, userSig: string): Promise<void> {
  // ✅ ALWAYS: 登录前检查状态
  const status = chat.getLoginStatus();
  if (status === TencentCloudChat.TYPES.LOGIN_STATUS_LOGINED) {
    console.log('已登录，无需重复登录');
    return;
  }
  if (status === TencentCloudChat.TYPES.LOGIN_STATUS_LOGINING) {
    console.log('正在登录中，请等待...');
    return;
  }

  // ✅ ALWAYS: 处理登录错误，特别是 UserSig 过期
  try {
    const res = await chat.login({ userID, userSig });
    console.log('登录成功:', res.data);
  } catch (error: any) {
    switch (error.code) {
      case 6206:  // ERR_USER_SIG_EXPIRED
      case 70001: // ERR_SVR_ACCOUNT_USERSIG_EXPIRED
        console.error('UserSig 过期，请重新获取');
        // TODO: 调用业务后端获取新的 userSig 并重试
        break;
      default:
        console.error('登录失败:', error.code, error.message);
    }
  }
}
```

---

### 📚 References

- Slice: `chat/multi-instance` | [多端登录与互踢 - 官方文档](https://trtc.io/zh/document/47971?product=chat)
- Slice: `chat/web/multi-instance` | [Web SDK 登录文档](https://trtc.io/zh/document/47971?product=chat)
- Slice: `chat/login` (planned) — 登录与认证的完整流程
- 控制台配置: [TRTC 控制台](https://console.trtc.io/)
