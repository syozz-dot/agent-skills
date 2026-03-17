---
id: chat/web/multi-instance
name: 多实例/多端并发 - Web
product: chat
platform: web
parent: chat/multi-instance
tags: [multi-instance, login, web, multi-tab, browser]
docs:
  - title: Web SDK 登录文档
    url: https://trtc.io/zh/document/47971?product=chat
---

# 多实例/多端并发 - Web 实现

## Web 特有注意事项

### 多 Tab 场景
Web 平台最独特的场景是 **多 Tab 并发** —— 同一个用户在同一浏览器中打开多个 Tab，每个 Tab 都初始化 Chat SDK 并登录。

- Web 平台最多支持 **10 个同时在线实例**
- 每个 Tab 中的 SDK 实例是独立的，互不影响
- 超过 10 个实例后，最早的实例会被踢下线

### 浏览器存储
- Web SDK 使用 IndexedDB / localStorage 存储本地数据
- 多 Tab 共享同一个域名的存储空间
- 注意：不同 Tab 的 SDK 实例不会自动同步内存状态，需依赖 SDK 事件回调

### 浏览器兼容性
- 推荐使用 Chrome 56+、Firefox 56+、Safari 11+、Edge 16+
- IE 不支持

---

## 代码示例（TypeScript）

### 1. SDK 初始化与登录

```typescript
import TencentCloudChat from '@tencentcloud/chat';

// 初始化 SDK
const chat = TencentCloudChat.create({
  SDKAppID: 0, // 替换为你的 SDKAppID（Number 类型）
});

// 设置日志级别（开发环境建议设为 debug）
chat.setLogLevel(0); // 0: normal, 1: release (无日志)

// ✅ ALWAYS: 先注册事件监听，再调用 login
chat.on(TencentCloudChat.EVENT.KICKED_OFFLINE, onKickedOffline);
chat.on(TencentCloudChat.EVENT.SDK_READY, onSDKReady);
chat.on(TencentCloudChat.EVENT.SDK_NOT_READY, onSDKNotReady);

// 登录
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

### 2. 登出

```typescript
async function logout(): Promise<void> {
  try {
    await chat.logout();
    console.log('登出成功');
  } catch (error) {
    console.error('登出失败:', error);
  }
}
```

### 3. 检查登录状态

```typescript
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
```

### 4. 互踢回调处理

```typescript
// ❌ NEVER: 不要在回调中自动重新登录（会造成互踢死循环）
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
          // 用户主动选择重新登录
          safeLogin(currentUserID, newUserSig);
        },
      },
      {
        text: '退出',
        onClick: () => {
          // 清理并退出
          redirectToLoginPage();
        },
      },
    ],
  });
}

function onSDKReady(): void {
  console.log('SDK Ready - 可以使用各项功能了');
}

function onSDKNotReady(): void {
  console.warn('SDK Not Ready - 功能暂不可用');
}
```

### 5. 多 Tab 感知（Web 特有）

```typescript
// 利用 BroadcastChannel 在多 Tab 间通信（可选增强）
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

### 6. 切换账号

```typescript
// ✅ 切换账号：直接用新的 userID 调用 login 即可
async function switchAccount(newUserID: string, newUserSig: string): Promise<void> {
  // 无需先 logout，SDK 内部会自动处理
  try {
    const res = await chat.login({ userID: newUserID, userSig: newUserSig });
    console.log('切换账号成功:', res.data);
  } catch (error) {
    console.error('切换账号失败:', error);
  }
}
```

---

## Web 特有排障

### 问题：多 Tab 中部分 Tab 收不到消息

**原因排查**：
1. 检查每个 Tab 是否都成功登录（`getLoginStatus` 返回 `LOGINED`）
2. 检查是否超过 10 个实例上限（超出的实例会被踢下线）
3. 检查消息监听 `chat.on(TencentCloudChat.EVENT.MESSAGE_RECEIVED, ...)` 是否注册

**解决方案**：
```typescript
// 在每个 Tab 中检查状态
const status = chat.getLoginStatus();
console.log('当前 Tab 登录状态:', status);

// 如果状态异常，重新登录
if (status !== TencentCloudChat.TYPES.LOGIN_STATUS_LOGINED) {
  await safeLogin(userID, userSig);
}
```

### 问题：页面刷新后 SDK 状态丢失

**原因**：Web SDK 的内存状态（事件监听、连接状态）在页面刷新后重置。

**解决方案**：
```typescript
// 在页面加载时重新初始化和登录
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

### 问题：IndexedDB 存储错误

**原因**：浏览器隐私模式或存储空间不足。

**解决方案**：
- 检查浏览器是否处于隐私/无痕模式（部分浏览器隐私模式下 IndexedDB 不可用）
- 清理浏览器存储空间
- 确认没有其他脚本干扰 IndexedDB 操作
