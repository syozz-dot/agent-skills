# Web 端多 Tab 登录后第一个 Tab 收不到消息 — 排障指南

> 📖 参考知识：`chat/multi-instance`、`chat/web/multi-instance` | 官方文档：[多端登录与互踢](https://trtc.io/zh/document/47971?product=chat)

## 问题现象

用户在 Web 端使用 `@tencentcloud/chat` SDK，在第二个浏览器 Tab 打开页面并登录后，第一个 Tab 不再能收到消息。

## 最可能的原因

**控制台的多端登录策略未正确配置，或 Web 端同平台实例数限制为 1，导致第二个 Tab 登录后把第一个 Tab 踢下线了。**

Web 端多 Tab 并发属于「同平台多实例」场景。Chat SDK 在正确配置下，Web 平台最多支持 **10 个同时在线实例**，每个 Tab 中的 SDK 实例是独立的。但如果控制台策略配置不正确，新 Tab 登录会把旧 Tab 踢掉。

## 排障流程

请按以下步骤逐一排查：

### Step 1：检查控制台多端登录策略

1. 登录 [TRTC 控制台](https://console.trtc.io/)
2. 进入「应用配置」→「功能配置」→「多端登录」
3. 确认以下配置：
   - **已开通专业版或以上套餐**（多端登录需要专业版 / 专业版增强 / 旗舰版）
   - **多端登录策略**设置为「多端登录」（而非单端/双端/三端）
   - **Web 平台同平台实例数上限** ≥ 2（最大支持 10）

> ⚠️ 如果策略为「单端登录」，则第二个 Tab 登录会直接踢掉第一个 Tab —— 这是你描述的现象的最常见原因。

### Step 2：确认第一个 Tab 是否被踢下线

在第一个 Tab 的代码中，检查是否注册了 `KICKED_OFFLINE` 事件监听：

```typescript
chat.on(TencentCloudChat.EVENT.KICKED_OFFLINE, () => {
  console.warn('当前 Tab 被踢下线');
});
```

- **如果回调被触发** → 确认是互踢问题，回到 Step 1 修改控制台配置
- **如果回调未触发** → 继续 Step 3

### Step 3：检查每个 Tab 的登录状态

在两个 Tab 中分别执行：

```typescript
const status = chat.getLoginStatus();
console.log('当前 Tab 登录状态:', status);
// 期望值: TencentCloudChat.TYPES.LOGIN_STATUS_LOGINED
```

- 如果第一个 Tab 的状态不是 `LOGIN_STATUS_LOGINED`，说明它确实已掉线，需要重新登录
- 如果两个 Tab 都显示已登录，继续 Step 4

### Step 4：检查消息监听是否正确注册

确认每个 Tab 都注册了消息接收回调：

```typescript
chat.on(TencentCloudChat.EVENT.MESSAGE_RECEIVED, (event) => {
  const messages = event.data;
  console.log('收到消息:', messages);
});
```

**关键点**：消息监听必须在 `login` 之前注册。如果在 `login` 之后才注册，可能会丢失在注册前到达的消息。

### Step 5：检查是否超过同平台实例上限

如果你的应用会在多个 Tab 打开，确认未超过 Web 平台的 10 个实例上限。超过上限后，最早登录的实例会被踢下线。

## 最常见根因总结

| 排查项 | 状态 | 说明 |
|--------|------|------|
| 套餐版本 | ❓ 检查 | 需要专业版或以上才支持多端登录 |
| 控制台策略 | ❓ 检查 | 需设为「多端登录」且 Web 实例数 ≥ 2 |
| `KICKED_OFFLINE` 监听 | ❓ 检查 | 必须在 `login` 前注册 |
| `MESSAGE_RECEIVED` 监听 | ❓ 检查 | 必须在每个 Tab 中注册 |
| Web 实例数 | ❓ 检查 | 不超过 10 个 |

## 推荐修复方案

**90% 的情况是控制台策略配置问题。** 修改步骤：

1. 控制台将多端登录策略改为「多端登录」
2. 确保 Web 同平台实例上限 ≥ 2
3. 等待配置生效（通常几分钟）

然后在代码中确保正确的初始化顺序：

```typescript
import TencentCloudChat from '@tencentcloud/chat';

const chat = TencentCloudChat.create({
  SDKAppID: 0, // 替换为你的 SDKAppID
});

// ✅ ALWAYS: 先注册事件监听，再调用 login
chat.on(TencentCloudChat.EVENT.KICKED_OFFLINE, onKickedOffline);
chat.on(TencentCloudChat.EVENT.MESSAGE_RECEIVED, onMessageReceived);
chat.on(TencentCloudChat.EVENT.SDK_READY, onSDKReady);

// 登录前检查状态，避免重复登录
const status = chat.getLoginStatus();
if (status !== TencentCloudChat.TYPES.LOGIN_STATUS_LOGINED) {
  await chat.login({ userID, userSig });
}
```

互踢回调的正确处理：

```typescript
// ❌ NEVER: 不要在回调中自动重新登录（会造成两端互踢死循环）
function onKickedOffline(): void {
  // ✅ 正确做法：提示用户并让用户选择
  showDialog({
    title: '下线通知',
    message: '您的账号在其他地方登录，您已被踢下线。',
    actions: [
      { text: '重新登录', onClick: () => safeLogin(userID, userSig) },
      { text: '退出', onClick: () => redirectToLoginPage() },
    ],
  });
}
```

## 相关错误码

| 错误码 | 名称 | 含义 |
|--------|------|------|
| **6206** | `ERR_USER_SIG_EXPIRED` | UserSig 过期 |
| **6208** | `ERR_LOGIN_KICKED_OFF_BY_OTHER` | 被其他实例踢下线 |
| **70001** | `ERR_SVR_ACCOUNT_USERSIG_EXPIRED` | 服务端检测到 UserSig 过期 |

## 进一步参考

- [多端登录与互踢 - 官方文档](https://trtc.io/zh/document/47971?product=chat)
- [TRTC 控制台](https://console.trtc.io/)
- 相关知识片段：`chat/login`（登录与认证）、`chat/event-listener`（事件监听机制）
