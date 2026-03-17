---
id: chat/multi-instance
name: 多实例/多端并发
product: chat
tags: [multi-instance, login, session, kick-offline, multi-device]
platforms: [web, android, ios, flutter, electron]
related:
  - chat/login
  - chat/event-listener
docs:
  - title: 多端登录与互踢
    url: https://trtc.io/zh/document/47971?product=chat
  - title: 控制台多端登录配置
    url: https://console.trtc.io/
---

# 多实例/多端并发（产品级概览）

## 功能说明

多实例/多端并发是指同一个用户账号在多个设备或同一设备多个实例上同时在线使用 Chat SDK 的能力。

### 典型场景
- 用户同时在手机和电脑上使用 IM
- Web 端用户在多个浏览器 Tab 中打开应用
- 同一用户在平板和手机上同时接收消息

### 版本要求
> ⚠️ 多端登录功能需要 **专业版（Professional Edition）、专业版增强（Professional Plus）或旗舰版（Enterprise Edition）**。

---

## 核心概念

### 多端登录策略

多端登录策略在 [TRTC 控制台](https://console.trtc.io/) 中配置，支持以下模式：

| 策略 | 说明 |
|------|------|
| 单端登录 | 同一时间只允许一个设备在线，新登录会踢掉旧登录 |
| 双端登录 | 移动端 + PC端各一台设备在线 |
| 三端登录 | 移动端 + PC端 + Web端各一台设备在线 |
| 多端登录 | 移动端 + PC端 + Pad端 + Web端各可在线，每个平台可多实例 |

### 同平台实例数上限

| 平台 | 最大同时在线实例数 |
|------|---------------------|
| **Web** | **10 个实例** |
| Android | 3 个设备 |
| iPhone | 3 个设备 |
| iPad | 3 个设备 |
| Windows | 3 个设备 |
| Mac | 3 个设备 |

### 互踢机制

当同平台在线实例数超过上限时，**最早登录的实例会被踢下线**：

```
时间线: T1 登录实例A → T2 登录实例B → T3 登录实例C → ... 超过上限
结果: 实例A 收到 onKickedOffline 回调，被强制下线
```

被踢下线的实例会收到 `onKickedOffline` 回调（前提是已通过 `addIMSDKListener` 注册了 SDK 监听器）。

### 登录状态

通过 `getLoginStatus` 可查询当前登录状态：

| 状态 | 含义 |
|------|------|
| `V2TIM_STATUS_LOGINED` | 已登录 |
| `V2TIM_STATUS_LOGINING` | 登录中 |
| `V2TIM_STATUS_LOGOUT` | 未登录 |

---

## 最佳实践

### ✅ ALWAYS（必须做的）

1. **始终在登录前检查登录状态**
   - 调用 `getLoginStatus` 确认当前状态
   - 如果已经是 `LOGINED` 状态，不要重复调用 `login`
   - 如果是 `LOGINING` 状态，等待登录完成

2. **始终注册 onKickedOffline 回调**
   - 在 SDK 初始化后立即注册
   - 在回调中提示用户并引导重新登录或退出
   - 确保在调用 `login` 之前注册好监听

3. **始终处理 UserSig 过期**
   - 监听错误码 `ERR_USER_SIG_EXPIRED (6206)` 和 `ERR_SVR_ACCOUNT_USERSIG_EXPIRED (70001)`
   - 在回调中重新获取 UserSig 并调用 `login` 续期

4. **始终在控制台配置合适的多端策略**
   - 根据业务需求选择策略
   - 注意策略变更需要等待生效

5. **切换账号时直接调用 login**
   - 无需先调用 `logout` 再 `login`
   - 直接使用新的 UserID 调用 `login` 即可

### ❌ NEVER（绝不要做的）

1. **不要在同一个 App 中同时登录多个账号**
   - SDK 不支持单个 App 实例多账号同时在线
   - 必须先切换/登出当前账号再登录新账号

2. **不要频繁重复调用 login**
   - 已经是 `LOGINED` 状态时重复登录会造成不必要的资源开销
   - 特别是在循环或定时器中避免无条件调用 `login`

3. **不要忽略互踢回调**
   - 未处理 `onKickedOffline` 会导致用户在不知情的情况下断线
   - 消息无法正常收发但用户不知道

4. **不要在 onKickedOffline 回调中自动重新登录**
   - 会造成两端不断互踢的死循环
   - 应该提示用户选择是否重新登录

---

## 排障指南

### 常见错误码

| 错误码 | 名称 | 原因 | 解决方案 |
|--------|------|------|----------|
| **6206** | `ERR_USER_SIG_EXPIRED` | UserSig 过期 | 重新生成 UserSig 并调用 `login` |
| **70001** | `ERR_SVR_ACCOUNT_USERSIG_EXPIRED` | 服务端检测到 UserSig 过期 | 同上 |
| **6208** | `ERR_LOGIN_KICKED_OFF_BY_OTHER` | 被其他实例踢下线 | 需在控制台开启互踢错误码返回；处理 onKickedOffline 回调 |

### 排障流程

```
问题：用户突然掉线
  ├─ 检查是否收到 onKickedOffline 回调
  │   ├─ 是 → 多端互踢，检查控制台策略配置
  │   └─ 否 → 检查网络连接或 UserSig 是否过期
  │
问题：login 调用失败
  ├─ 错误码 6206/70001 → UserSig 过期，重新生成
  ├─ 错误码 6208 → 被互踢，检查其他在线设备
  └─ 其他 → 检查 SDKAppID、UserID、UserSig 是否正确

问题：多端消息不同步
  ├─ 检查控制台多端登录策略是否开启
  ├─ 确认所有端都成功登录（getLoginStatus = LOGINED）
  └─ 检查消息监听是否正确注册
```

### 控制台配置检查清单

- [ ] 确认已开通专业版或以上套餐
- [ ] 确认多端登录策略已正确配置
- [ ] 确认互踢错误码返回已开启（如需返回 6208）
- [ ] 确认同平台实例数上限设置合理

---

## 关联知识

- **chat/login** — 登录与认证的完整流程
- **chat/event-listener** — 事件监听机制（包括 onKickedOffline 的注册方式）
