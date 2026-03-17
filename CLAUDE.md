# TRTC AI Integration 知识库

本项目是 TRTC（Tencent Real-Time Communication）的 AI 辅助集成知识库，通过 Claude Code Skills 帮助开发者快速集成和排障。

## 项目结构

```
ai-integration/
├── CLAUDE.md                          # 本文件 — 项目级 AI 指令
├── .claude/skills/trtc/               # Claude Code Skills
│   ├── SKILL.md                       # 路由 skill（入口）
│   ├── search/SKILL.md                # 搜索知识库
│   ├── apply/SKILL.md                 # 应用/校验代码
│   └── topic/SKILL.md                 # 场景引导
├── knowledge-base/
│   ├── index.yaml                     # 全量索引
│   ├── slices/                        # 原子能力片段
│   │   ├── {product}/                 # 按产品分类 (chat/call/rtc-engine/live/room)
│   │   │   ├── {ability}.md           # 产品级概览（跨平台通用）
│   │   │   └── {platform}/            # 按平台分类 (web/android/ios/flutter)
│   │   │       └── {ability}.md       # 平台实现细节
│   └── scenarios/                     # 场景组合
│       └── {scenario-name}.md         # 引用多个 slice 的完整场景
```

## 核心概念

### Slice（原子能力片段）
一个 slice 对应一个原子能力（如「进房」「推流」「多实例登录」）。每个 slice 包含：
- **产品级概览**：功能说明、核心概念、最佳实践、排障指南（跨平台通用）
- **平台实现细节**：具体 API 调用、代码示例、平台特有注意事项

### Scenario（场景组合）
一个 scenario 是完整的使用场景，引用多个 slice 并定义执行顺序。

### 三层架构
```
Layer 3: Skills（用户交互层）— trtc / search / apply / topic
Layer 2: Knowledge Base（结构化知识层）— slices/ + scenarios/ + index.yaml
Layer 1: Claude Code Runtime — .claude/skills/ + CLAUDE.md
```

## AI 行为指令

当用户提出 TRTC 相关问题时：
1. **识别产品**：Chat / Call / RTC Engine / Live / Room
2. **识别平台**：Web / Android / iOS / Flutter / Electron
3. **读取知识库**：先读产品级概览，再读平台实现细节
4. **回答时引用来源**：标明参考的 slice ID 和官方文档链接

## TRTC 产品线

| 产品 | 目录 | 说明 |
|------|------|------|
| Chat | `slices/chat/` | 即时通信（消息、会话、群组） |
| Call | `slices/call/` | 音视频通话（1v1/群组通话） |
| RTC Engine | `slices/rtc-engine/` | 实时音视频引擎（进房/推流/拉流） |
| Live | `slices/live/` | 直播（推流/拉流/连麦） |
| Room | `slices/room/` | 房间管理（创建/销毁/成员管理） |

## 支持的平台

Web / Android / iOS / Flutter / Electron / Unity
