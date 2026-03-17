# 从零实现 Web 端多设备同时登录 Chat 功能

> 📖 本指南基于场景 `chat-multi-device`（多设备/多端并发登录），涉及 slices: `chat/multi-instance`、`chat/login`、`chat/event-listener`

你好！我来一步步带你实现这个功能。多设备同时登录 Chat 的核心是让同一个用户可以在手机、电脑、多个浏览器 Tab 中同时在线，并且消息实时同步。

---

## 前置条件（开始写代码之前先确认这些）

在动手之前，请确认以下三项都已满足：

- [ ] **已开通 TRTC 专业版或以上套餐** — 多端登录功能需要专业版（Professional Edition）、专业版增强（Professional Plus）或旗舰版（Enterprise Edition），基础版不支持
- [ ] **已在 [TRTC 控制台](https://console.trtc.io/) 配置多端登录策略** — 这一步很关键，下面 Step 1 会详细说
- [ ] **已了解各平台实例上限** — Web 最多 10 个实例，Native（Android/iOS）最多 3 个设备

如果你还没有 SDKAppID，需要先去 [TRTC 控制台](https://console.trtc.io/) 创建应用获取。

---

## Step 1: 在控制台配置多端登录策略

**这一步做什么**：在 TRTC 控制台中开启多设备同时在线能力。如果不配置，默认可能是单端登录（新设备登录会踢掉旧设备）。

**操作步骤**：

1. 登录 [TRTC 控制台](https://console.trtc.io/)
2. 进入你的应用 →「应用配置」→「功能配置」→「多端登录」
3. 选择「**多端登录**」策略（推荐，灵活性最大）— 这样移动端 + PC端 + Pad端 + Web端都可以同时在线
4. 配置是否返回互踢错误码 `6208`（建议开启，方便排障）
5. 等待配置生效（通常几分钟内）

**多端登录策略对照表**：

| 策略 | 说明 |
|------|------|
| 单端登录 | 同一时间只允许一个设备在线，新登录会踢掉旧登录 |
| 双端登录 | 移动端 + PC端各一台设备在线 |
| 三端登录 | 移动端 + PC端 + Web端各一台设备在线 |
| **多端登录（推荐）** | 移动端 + PC端 + Pad端 + Web端各可在线，每个平台可多实例 |

> 📖 参考文档: [多端登录与互踢](https://trtc.io/zh/document/47971?product=chat) — slice `chat/multi-instance`

---

## Step 2: 安装 SDK 并初始化 + 注册事件监听

**这一步做什么**：安装 Chat SDK，创建实例，并在登录 **之前** 注册好关键事件回调。这一步至关重要——如果你先登录再注册回调，可能会漏掉一些事件（比如刚登录就被踢下线）。

### 安装 SDK

```bash
npm install @tencentcloud/chat
```

### 初始化并注册事件监听

```typescript
import TencentCloudChat from '@tencentcloud/chat';

// 1. 创建 SDK 实例
const chat = TencentCloudChat.create({
  SDKAppID: 0, // ⚠️ 替换为你的 SDKAppID（Number 类型，从控制台获取）
});

// 2. 设置日志级别（开发环境用 0 方便调试，生产环境用 1 减少输出）
chat.setLogLevel(0); // 0: normal, 1: release (无日志)

// 3. ✅ ALWAYS: 先注册事件监听，再调用 login —— 这是最重要的顺序！
chat.on(TencentCloudChat.EVENT.KICKED_OFFLINE, onKickedOffline);
chat.on(TencentCloudChat.EVENT.SDK_READY, onSDKReady);
chat.on(TencentCloudChat.EVENT.SDK_NOT_READY, onSDKNotReady);

// SDK Ready 回调 — 收到这个事件后才能使用消息收发等功能
function onSDKReady(): void {
  console.log('SDK Ready - 可以使用各项功能了');
}

function onSDKNotReady(): void {
  console.warn('SDK Not Ready - 功能暂不可用');
}
```

**常见坑**：
- ⚠️ 事件监听 **必须** 在 `login()` 之前注册，否则可能漏掉事件
- `SDKAppID` 是 Number 类型，不是 String

> 📖 参考: slice `chat/event-listener`（详细文档正在建设中，上面的代码是标准写法）

---

## Step 3: 实现登录（含状态检查）

**这一步做什么**：实现安全的登录逻辑。关键点是登录前先检查状态，避免重复登录造成不必要的开销。

### 登录状态检查 + 安全登录

```typescript
// 检查当前登录状态
function checkLoginStatus(): string {
  const status = chat.getLoginStatus();

  switch (status) {
    case TencentCloudChat.TYPES.LOGIN_STATUS_LOGINED:
      console.log('已登录');
      return 'logined';
    case TencentCloudChat.TYPES.LOGIN_STATUS_LOGINING:
      console.log('登录中...');
      return 'logining';
    case TencentCloudChat.TYPES.LOGIN_STATUS_LOGOUT:
      console.log('未登录');
      return 'logout';
    default:
      return 'unknown';
  }
}

// ✅ ALWAYS: 登录前检查状态，避免重复登录
async function safeLogin(userID: string, userSig: string): Promise<void> {
  const status = checkLoginStatus();
  if (status === 'logined') {
    console.log('已登录，无需重复登录');
    return;
  }
  if (status === 'logining') {
    console.log('正在登录中，请等待...');
    return;
  }
  await login(userID, userSig);
}

// 实际登录逻辑
async function login(userID: string, userSig: string): Promise<void> {
  try {
    const res = await chat.login({ userID, userSig });
    console.log('登录成功:', res.data);
  } catch (error: any) {
    // 处理登录错误
    switch (error.code) {
      case 6206: // ERR_USER_SIG_EXPIRED
      case 70001: // ERR_SVR_ACCOUNT_USERSIG_EXPIRED
        console.error('UserSig 过期，请重新获取');
        // TODO: 调用业务后端获取新的 userSig，然后重试
        break;
      default:
        console.error('登录失败:', error.code, error.message);
    }
  }
}
```

**常见坑**：
- ❌ **NEVER**: 不要在循环或定时器中无条件调用 `login`，已经是 `LOGINED` 状态时重复登录会造成不必要的资源开销
- ✅ 切换账号时可以直接用新的 `userID` 调用 `login`，无需先 `logout`

> 📖 参考: slice `chat/login`（详细文档正在建设中）

---

## Step 4: 处理互踢（超出设备上限时的核心逻辑）

**这一步做什么**：当同一平台的在线实例数超过上限时（Web 超过 10 个，Native 超过 3 个），最早登录的实例会被踢下线并收到 `onKickedOffline` 回调。你需要优雅地处理这个场景。

### 互踢机制的时序

```
设备A                    服务端                    设备B
  │                        │                        │
  │── login(userA) ───────→│                        │
  │←── success ────────────│                        │
  │                        │                        │
  │                        │←── login(userA) ───────│
  │                        │──── success ──────────→│
  │                        │                        │
  │  (同平台未超限时，A 和 B 都在线)                    │
  │                        │                        │
  │  (同平台超限时)                                   │
  │←─ onKickedOffline ────│                        │
  │                        │──── success ──────────→│
```

### 互踢回调处理代码

```typescript
// ❌ NEVER: 绝对不要在回调中自动重新登录 —— 会造成两端不断互踢的死循环！
function onKickedOffline(): void {
  console.warn('您的账号在其他设备/Tab 登录，当前实例已被踢下线');

  // ✅ 正确做法：提示用户并让用户选择
  showDialog({
    title: '下线通知',
    message: '您的账号在其他地方登录，您已被踢下线。',
    actions: [
      {
        text: '重新登录',
        onClick: () => {
          // 用户主动选择重新登录（此时会踢掉另一端）
          safeLogin(currentUserID, newUserSig);
        },
      },
      {
        text: '退出',
        onClick: () => {
          // 清理本地状态，跳转到登录页
          redirectToLoginPage();
        },
      },
    ],
  });
}
```

> ⚠️ **这是最常见的坑**：在 `onKickedOffline` 中自动调用 `login` 会导致两端互踢死循环（A踢B → B自动登录踢A → A自动登录踢B → 无限循环）。一定要让用户手动选择！

> 📖 参考: [多端登录与互踢](https://trtc.io/zh/document/47971?product=chat) — slice `chat/multi-instance`

---

## Step 5: 处理 UserSig 过期（保持长时间在线的关键）

**这一步做什么**：UserSig 有有效期限，过期后需要自动续期，否则用户会突然断线。这一步确保用户长时间在线时不会因为凭证过期而掉线。

```typescript
// 监听 UserSig 过期事件
chat.on(TencentCloudChat.EVENT.SDK_NOT_READY, async () => {
  // SDK_NOT_READY 可能由多种原因触发，需要结合错误码判断
  console.warn('SDK Not Ready，检查是否需要续期 UserSig');
});

// 在 login 的 catch 中处理 UserSig 过期（见 Step 3 代码）
// 错误码 6206 (ERR_USER_SIG_EXPIRED) 和 70001 (ERR_SVR_ACCOUNT_USERSIG_EXPIRED)

// 推荐的 UserSig 续期流程
async function renewUserSig(): Promise<void> {
  try {
    // 调用你的业务后端获取新的 UserSig
    const response = await fetch('/api/getUserSig', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userID: currentUserID }),
    });
    const { userSig } = await response.json();

    // 使用新的 UserSig 重新登录
    await login(currentUserID, userSig);
    console.log('UserSig 续期成功');
  } catch (error) {
    console.error('UserSig 续期失败:', error);
  }
}
```

---

## Step 6 (Web 特有): 页面刷新恢复 + 多 Tab 感知

**这一步做什么**：Web 端有两个特有场景需要处理：(1) 页面刷新后 SDK 内存状态会重置，需要重新初始化和登录；(2) 多个 Tab 之间可以通过 BroadcastChannel 通信。

### 页面刷新后自动恢复

```typescript
// 页面加载时重新初始化和登录
window.addEventListener('load', async () => {
  // 重新创建 SDK 实例
  const chat = TencentCloudChat.create({ SDKAppID });

  // 重新注册事件监听
  chat.on(TencentCloudChat.EVENT.KICKED_OFFLINE, onKickedOffline);
  chat.on(TencentCloudChat.EVENT.MESSAGE_RECEIVED, onMessageReceived);

  // 从存储中获取凭证并重新登录
  const userID = localStorage.getItem('chat_userID');
  const userSig = localStorage.getItem('chat_userSig');
  if (userID && userSig) {
    await login(userID, userSig);
  }
});
```

### 多 Tab 间通信（可选增强）

```typescript
// 利用 BroadcastChannel 在多 Tab 间通信
const bc = new BroadcastChannel('trtc-chat-channel');

// 当被踢下线时，通知其他 Tab
function onKickedOfflineWithBroadcast(): void {
  // 通知其他 Tab
  bc.postMessage({ type: 'KICKED_OFFLINE', tabId: getTabId() });
  // 处理当前 Tab 的逻辑
  onKickedOffline();
}

// 监听其他 Tab 的消息
bc.onmessage = (event) => {
  if (event.data.type === 'KICKED_OFFLINE') {
    console.log(`Tab ${event.data.tabId} 被踢下线`);
    // 可以选择更新当前 Tab 的 UI 状态
  }
};

// 生成唯一 Tab ID
function getTabId(): string {
  if (!sessionStorage.getItem('tabId')) {
    sessionStorage.setItem('tabId', `tab_${Date.now()}_${Math.random().toString(36).slice(2)}`);
  }
  return sessionStorage.getItem('tabId')!;
}
```

---

## 验证清单

所有步骤完成后，逐项验证：

- [ ] **多端同时登录成功** — 在两个浏览器 Tab（或一个 Tab + 一台手机）中用同一个 userID 登录，两端都显示在线，消息可以同步收到
- [ ] **超出实例上限时互踢正常** — 打开超过上限数量的实例，最早的实例应收到 `onKickedOffline` 回调并弹出提示弹窗
- [ ] **互踢后 UI 正确提示** — 用户可以选择「重新登录」或「退出」，且不会出现互踢死循环
- [ ] **UserSig 过期后自动续期** — 使用一个短有效期的 UserSig 测试，过期后应能自动获取新 UserSig 并重新登录
- [ ] **页面刷新后恢复** (Web) — 刷新页面后应自动重新初始化 SDK 并恢复登录状态
- [ ] **网络断开重连后状态正确** — 断开网络再恢复，SDK 应自动重连

遇到任何问题？告诉我哪一项验证失败，我来帮你排查。

---

## 常见错误码速查

| 错误码 | 名称 | 原因 | 解决方案 |
|--------|------|------|----------|
| **6206** | `ERR_USER_SIG_EXPIRED` | UserSig 过期 | 重新生成 UserSig 并调用 `login` |
| **70001** | `ERR_SVR_ACCOUNT_USERSIG_EXPIRED` | 服务端检测到 UserSig 过期 | 同上 |
| **6208** | `ERR_LOGIN_KICKED_OFF_BY_OTHER` | 被其他实例踢下线 | 需在控制台开启互踢错误码返回；处理 `onKickedOffline` 回调 |

---

## 排障流程

如果遇到问题，按这个流程排查：

```
问题：用户突然掉线
  ├─ 检查是否收到 onKickedOffline 回调
  │   ├─ 是 → 多端互踢，检查控制台策略配置是否正确
  │   └─ 否 → 检查网络连接或 UserSig 是否过期
  │
问题：login 调用失败
  ├─ 错误码 6206/70001 → UserSig 过期，重新生成
  ├─ 错误码 6208 → 被互踢，检查其他在线设备
  └─ 其他 → 检查 SDKAppID、UserID、UserSig 是否正确

问题：多 Tab 中部分 Tab 收不到消息
  ├─ 检查每个 Tab 是否都成功登录（getLoginStatus 返回 LOGINED）
  ├─ 检查是否超过 10 个实例上限（超出的实例会被踢下线）
  └─ 检查消息监听 chat.on(TencentCloudChat.EVENT.MESSAGE_RECEIVED, ...) 是否注册
```

---

> 📖 **参考来源**:
> - Slice `chat/multi-instance`: [多端登录与互踢](https://trtc.io/zh/document/47971?product=chat)
> - Slice `chat/web/multi-instance`: [Web SDK 登录文档](https://trtc.io/zh/document/47971?product=chat)
> - Scenario `chat-multi-device`: 多设备/多端并发登录完整场景
> - Slice `chat/login`（planned）、`chat/event-listener`（planned）: 详细文档正在建设中
