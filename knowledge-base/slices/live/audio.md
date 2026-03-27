---
id: live/audio
name: 音效管理
product: live
tags: [audio, voice, effect, changer, reverb, ear-monitor, AudioEffectStore]
platforms: [ios, android, web, flutter]
related: [live/anchor-preview, live/device-control]
docs:
  - title: 音效管理
    url: https://trtc.io/zh/document/74608
---

# 音效管理

## 功能说明

`AudioEffectStore` 是全局单例，统一管理主播端的音效能力，包括采集音量、耳返、变声、混响四大功能模块。所有音效设置在整个直播生命周期内持续生效，直播结束后须调用 `reset()` 恢复默认值。

采集音量（`setCaptureVolume`）通过 `DeviceStore.shared` 控制，影响观众收到的音量；耳返音量（`setVoiceEarMonitorVolume`）仅影响主播本人通过耳机听到的声音，两者相互独立。

## 核心概念

| 方法 / 属性 | 归属 | 说明 |
|-------------|------|------|
| `AudioEffectStore.shared` | `AudioEffectStore` | 全局单例，整个 App 生命周期内唯一实例 |
| `DeviceStore.shared` | `DeviceStore` | 全局单例；采集音量由此控制 |
| `setCaptureVolume(volume:)` | `DeviceStore` | 设置麦克风采集音量；范围 `0–150`，默认 `100` |
| `setVoiceEarMonitorEnable(enable:)` | `AudioEffectStore` | 开启 / 关闭耳返；需插入耳机才有效 |
| `setVoiceEarMonitorVolume(volume:)` | `AudioEffectStore` | 设置耳返音量；范围 `0–150`，默认 `100` |
| `setAudioChangerType(type:)` | `AudioEffectStore` | 设置变声效果；传 `.none` 还原 |
| `setAudioReverbType(type:)` | `AudioEffectStore` | 设置混响效果；传 `.none` 还原 |
| `reset()` | `AudioEffectStore` | 重置所有音效参数为默认值 |

### AudioChangerType 枚举

| 值 | 说明 |
|----|------|
| `.none` | 原声（无变声） |
| `.child` | 儿童音 |
| `.littleGirl` | 萝莉音 |
| `.uncle` | 大叔音 |
| 其他值 | 详见 SDK 枚举定义 |

### AudioReverbType 枚举

| 值 | 说明 |
|----|------|
| `.none` | 无混响 |
| `.ktv` | KTV |
| `.theater` | 剧院 |
| `.metallic` | 金属感 |
| `.resonant` | 共鸣 |
| 其他值 | 详见 SDK 枚举定义 |

## 最佳实践

### ✅ ALWAYS

1. **直播结束后调用 `reset()`** — `AudioEffectStore` 是全局单例，音效参数在 App 整个生命周期内持久存在。若不在直播结束时重置，下一次开播或其他场景会复用上次的变声/混响配置，导致意外的音效污染。
2. **两个 Store 都是全局单例，各司其职** — 采集音量走 `DeviceStore.shared.setCaptureVolume`，其余音效走 `AudioEffectStore.shared`。不要混淆两个单例的职责。
3. **耳返功能前检查耳机状态** — 开启耳返时，先通过 `AVAudioSession` 确认当前输出路由包含耳机，否则开启后无声音，应向用户提示"请插入耳机"。
4. **音量范围 0–150，超出范围截断** — 设置 `setCaptureVolume` 或 `setVoiceEarMonitorVolume` 时，确保传入值在 `0–150` 范围内；默认值为 `100`（即原始音量）。

### ❌ NEVER

1. **直播结束不调 `reset()`** — 遗漏重置会导致变声/混响效果"残留"到下次开播，造成无法预期的用户体验问题，且难以排查。
2. **在未插耳机时向用户展示耳返开关** — 耳返在没有耳机时无效，应先检测音频输出路由再决定是否展示该控件，避免用户困惑。
3. **将采集音量和耳返音量混用** — 两个音量控制的是不同端点（观众听到的 vs 主播自己听到的），不要用同一个 Slider 同时控制两者。

## 排障指南

### 常见错误码

音效模块通常不返回业务错误码，异常表现为效果不生效。常见排障场景：

| 现象 | 可能原因 | 处理建议 |
|------|----------|----------|
| 耳返无声 | 未插入耳机 / 耳机输出路由未激活 | 检查 `AVAudioSession.currentRoute.outputs`，确认含 `AVAudioSessionPortHeadphones` |
| 采集音量异常（观众听到音量过大/过小） | `setCaptureVolume` 值偏差或未调用 | 检查是否已调用 `DeviceStore.shared.setCaptureVolume(volume:)`，默认值 100 |
| 变声/混响在新一场直播中意外生效 | 直播结束时未调 `reset()` | 在直播结束（下播/退房）时调用 `AudioEffectStore.shared.reset()` |
| 变声效果不生效 | 麦克风未打开 | 确保 `DeviceStore.shared.openLocalMicrophone` 已成功回调 `.success` |

### 排障流程

```
耳返无声
├── 是否已调用 setVoiceEarMonitorEnable(enable: true)？
│       └─ 否 → 补充调用
├── 当前音频路由是否含耳机？
│       └─ AVAudioSession.currentRoute.outputs 检查
│               ├─ 无耳机输出 → 提示用户插入耳机
│               └─ 有耳机但仍无声 → 检查 EarMonitorVolume 是否为 0
└── 重置后重新开启
        └─ reset() → setVoiceEarMonitorEnable(true) → setVoiceEarMonitorVolume(100)

变声/混响上次直播残留
├── 确认直播结束时未调 reset()
└─ 在下播/退房回调中补充 AudioEffectStore.shared.reset()

采集音量过大/过小
├── 检查 DeviceStore.shared 的 state.captureVolume 当前值
├── 调用 setCaptureVolume(volume: 100) 恢复默认
└── 若仍异常 → 检查是否有其他地方覆盖写入了 captureVolume
```

## 关联知识

- **[live/device-control](live/device-control.md)** — `DeviceStore` 管理麦克风开关，音效须在麦克风打开后才生效
- **[live/anchor-preview](live/anchor-preview.md)** — 主播预览阶段可预设音效，开播后立即生效
