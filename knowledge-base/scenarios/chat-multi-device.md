---
id: scenario/chat-multi-device
name: 多设备/多端并发登录
product: chat
slices:
  - chat/multi-instance
  - chat/login
  - chat/event-listener
tags: [multi-device, multi-instance, login, session-management]
difficulty: intermediate
---

# 场景：多设备/多端并发登录

## 场景描述

用户希望在多个设备（手机、电脑、平板）或多个浏览器 Tab 中同时使用 Chat 功能，需要实现：
- 同一账号多端同时在线
- 消息在所有端实时同步
- 当超出设备上限时优雅处理互踢
- 用户切换设备时无缝衔接

## 前置条件

- [ ] 已开通 TRTC 专业版或以上套餐
- [ ] 已在 [TRTC 控制台](https://console.trtc.io/) 配置多端登录策略
- [ ] 已了解各平台实例上限（Web 10 个，Native 3 个）

## 实施步骤

### Step 1: 配置控制台

在 TRTC 控制台中设置多端登录策略：

1. 进入「应用配置」→「功能配置」→「多端登录」
2. 选择适合的策略（推荐「多端登录」以获得最大灵活性）
3. 配置是否返回互踢错误码 6208
4. 等待配置生效（通常几分钟内）

> 📖 详细参考：[chat/multi-instance](../slices/chat/multi-instance.md) — 核心概念 > 多端登录策略

### Step 2: 初始化 SDK 并注册监听

**关键点**：必须在 `login` 之前注册好所有事件监听，尤其是 `onKickedOffline`。

```
初始化 SDK
  → 注册 onKickedOffline 回调     ← 必须在 login 之前
  → 注册 onUserSigExpired 回调
  → 注册消息接收回调
  → 调用 login
```

> 📖 详细参考：[chat/event-listener](../slices/chat/event-listener.md)（planned）

### Step 3: 实现登录（含状态检查）

登录前务必检查当前状态，避免重复登录：

```
检查 getLoginStatus
  ├─ LOGINED → 跳过，已登录
  ├─ LOGINING → 等待，正在登录
  └─ LOGOUT → 执行 login(userID, userSig)
```

> 📖 详细参考：[chat/login](../slices/chat/login.md)（planned）

### Step 4: 处理互踢

当用户在新设备登录导致旧设备被踢时：

```
收到 onKickedOffline
  → 展示提示 UI（"您的账号在其他设备登录"）
  → 提供选项：
      ├─ "重新登录" → 调用 login（此时会踢掉新设备）
      └─ "退出" → 清理状态，跳转登录页
```

> ⚠️ **绝对不要**在 onKickedOffline 中自动重新登录，会造成两端互踢死循环！

> 📖 详细参考：[chat/multi-instance](../slices/chat/multi-instance.md) — 最佳实践

### Step 5: 处理 UserSig 过期

UserSig 有有效期，需要在过期时自动续期：

```
收到错误码 6206 / 70001
  → 调用业务后端获取新的 UserSig
  → 使用新 UserSig 调用 login
```

## 完整时序图

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

## 验证清单

- [ ] 多端同时登录成功，消息同步正常
- [ ] 超出实例上限时，旧实例收到 onKickedOffline
- [ ] 互踢后 UI 正确提示，用户可选择重新登录或退出
- [ ] UserSig 过期后自动续期
- [ ] 页面刷新后能自动恢复登录状态（Web）
- [ ] 网络断开重连后状态正确

## 平台特有注意事项

| 平台 | 注意事项 |
|------|----------|
| **Web** | 多 Tab 场景需额外处理；最多 10 个实例；页面刷新需重新初始化 |
| **Android** | 最多 3 个设备；注意 Activity 生命周期中的 SDK 状态管理 |
| **iOS** | 最多 3 个设备；注意 App 进入后台时的连接保持 |

> 📖 各平台详细实现请参考对应的平台 slice（如 [chat/web/multi-instance](../slices/chat/web/multi-instance.md)）
