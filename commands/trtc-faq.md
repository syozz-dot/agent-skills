---
description: 直接查询 TRTC 文档 / FAQ — 跳过 dispatcher，强制走 docs 路径
---

用户已经显式选择了 docs 检索路径。**直接调用 `trtc-docs` skill** 来回答下面的问题，不要走 `trtc/SKILL.md` 的 dispatcher，也不要进入 onboarding / topic / apply 的任何分支。

## 调用约定

把用户问题作为 `query` 传给 `trtc-docs`，其余入参按下面的规则填：

- `product` — 从 query 中识别（`chat` / `call` / `rtc-engine` / `live` / `conference`），无法识别则置 `null`，由 `trtc-docs` 自行追问
- `platform` — 从 query 中识别（`web` / `android` / `ios` / `flutter` / `electron`），无法识别则置 `null`
- `intent` — 默认 `fact-lookup`；若 query 含 "vs" / "对比" / "哪个" / "选哪" 则用 `decision-lookup`；若含 "迁移" / "升级" / "migrate" 则用 `path-lookup`；若含错误码 / "正确用法" / "怎么实现" 则用 `slice-lookup`

## 边界

- 即使 query 看起来像 "搭建一个 X"、"集成 X"、"我要做一个 X"，也**不要**路由到 onboarding。用户用 `/trtc-faq` 已经表达了"我只想要文档答案"。
- 如果 `trtc-docs` 自身返回 "需要更多上下文"（例如 product 未识别），按它的提示追问，不要回退到 dispatcher。

---

用户问题：$ARGUMENTS
