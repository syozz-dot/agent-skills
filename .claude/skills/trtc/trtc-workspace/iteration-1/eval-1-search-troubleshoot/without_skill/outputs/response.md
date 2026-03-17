# Web 端 @tencentcloud/chat SDK 多 Tab 登录后第一个 Tab 收不到消息的原因与排查

## 问题原因

这是 Tencent Cloud Chat（原 TIM）SDK 的**多实例登录互踢机制**导致的。核心原因如下：

### 1. 同端互踢（最常见原因）

`@tencentcloud/chat` SDK 默认情况下，**同一平台（Web）同一用户只允许一个实例在线**。当用户在第二个 Tab 中调用 `login()` 后，服务端会认为这是同一平台的重复登录，会将第一个 Tab 的连接踢下线。第一个 Tab 的 SDK 实例会收到被踢下线的事件（`KICKED_OUT`），之后自然就无法再收到消息。

### 2. WebSocket 长连接被替代

Chat SDK 通过 WebSocket 维持长连接来接收消息推送。当第二个 Tab 登录成功后，服务端会将消息推送路由切换到新的连接，旧连接（第一个 Tab）就不再收到消息推送了。

---

## 排查步骤

### Step 1: 监听被踢下线事件

在第一个 Tab 中添加被踢下线的事件监听，确认是否触发了互踢：

```javascript
chat.on(TencentCloudChat.EVENT.KICKED_OUT, (event) => {
  console.log('被踢下线:', event.data.type);
  // type 可能的值:
  // TencentCloudChat.TYPES.KICKED_OUT_MULT_ACCOUNT - 多实例登录被踢
  // TencentCloudChat.TYPES.KICKED_OUT_MULT_DEVICE - 多端登录被踢
  // TencentCloudChat.TYPES.KICKED_OUT_USERSIG_EXPIRED - UserSig 过期
});
```

### Step 2: 检查控制台多端登录配置

登录 [即时通信 IM 控制台](https://console.cloud.tencent.com/im)，检查你的应用的**登录设置**：

- 进入 **应用配置** > **功能配置** > **登录与消息**
- 查看 **Web 端同时在线个数** 的配置
- 默认情况下 Web 端可能只允许 1 个实例在线，需要将其调大（例如设置为 2 或 3）

### Step 3: 检查是否共享了同一个 SDK 实例

确保两个 Tab 没有通过 `SharedWorker`、`BroadcastChannel` 或 `localStorage` 等方式共享状态导致冲突。每个 Tab 应该是独立的 SDK 实例。

### Step 4: 检查 SDK 初始化和登录参数

确认两个 Tab 使用的是：
- **相同的 SDKAppID**
- **相同的 userID**
- **各自独立生成的 UserSig**（UserSig 本身可以相同，但要确保没有过期）

```javascript
let chat = TencentCloudChat.create({
  SDKAppID: yourSDKAppID
});

chat.login({
  userID: 'user1',
  userSig: 'xxx'
});
```

### Step 5: 查看 SDK 日志

开启 SDK 的日志输出，查看两个 Tab 的详细日志：

```javascript
let chat = TencentCloudChat.create({
  SDKAppID: yourSDKAppID
});
// SDK 默认会输出日志到控制台，注意观察是否有 disconnect 或 kicked 相关日志
```

在浏览器 DevTools 的 Console 和 Network（WebSocket）面板中观察连接状态变化。

---

## 解决方案

### 方案一：修改控制台多端在线配置（推荐）

在 IM 控制台中将 **Web 端同时在线实例数** 调整为大于 1 的值。这样同一用户可以在多个 Tab 中同时在线并接收消息。

> 注意：此配置可能需要专业版或旗舰版套餐才支持多实例。

### 方案二：使用同一 Tab 管理消息

如果业务场景允许，可以使用 `SharedWorker` 或 `BroadcastChannel` 在多个 Tab 间共享一个 SDK 连接，只在一个 Tab 中维持 SDK 登录，其他 Tab 通过消息通信获取数据。

```javascript
// 主 Tab 通过 BroadcastChannel 广播消息
const bc = new BroadcastChannel('chat_channel');

chat.on(TencentCloudChat.EVENT.MESSAGE_RECEIVED, (event) => {
  bc.postMessage({
    type: 'NEW_MESSAGE',
    data: event.data
  });
});

// 其他 Tab 监听
const bc = new BroadcastChannel('chat_channel');
bc.onmessage = (event) => {
  if (event.data.type === 'NEW_MESSAGE') {
    // 处理新消息
  }
};
```

### 方案三：检测多 Tab 场景并提示用户

监听 `KICKED_OUT` 事件后，给用户一个友好提示，告知已在其他页面登录。

---

## 总结

| 排查项 | 说明 |
|--------|------|
| 被踢下线事件 | 监听 `KICKED_OUT` 事件确认原因 |
| 控制台配置 | 检查 Web 端同时在线实例数限制 |
| SDK 实例独立性 | 确保每个 Tab 独立创建 SDK 实例 |
| WebSocket 连接 | 在 Network 面板观察 WS 连接是否断开 |
| 套餐版本 | 确认当前套餐是否支持多实例在线 |

最根本的解决办法是在 **IM 控制台调整 Web 端允许同时在线的实例数**，这是该问题最直接的解决方案。
