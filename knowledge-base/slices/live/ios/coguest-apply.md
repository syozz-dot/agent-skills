---
id: live/coguest-apply
platform: ios
api_docs:
  - title: CoGuestStore
    url: https://tencent-rtc.github.io/TUIKit_iOS/documentation/atomicxcore/cogueststore/
---

# 观众申请连麦 — iOS 实现

## 前置条件

**通用依赖**：见 [login-auth 平台 slice](../login-auth.md)（SDK 安装、Info.plist 权限声明）

**额外依赖**：无

**前置状态**：
- `LoginStore.shared.isLogin == true`（登录成功）（→ live/login-auth）
- 已进入直播间，持有有效的 `liveID`（→ live/audience-watch）
- `CoGuestStore` 已通过 `create(liveID:)` 初始化

## 代码示例

### 观众端：申请 → 等待 → 开设备 → 连麦 → 断开

```swift
import AtomicXCore
import Combine

final class AudienceCoGuestViewModel: ObservableObject {

    // MARK: 状态

    enum CoGuestStatus {
        case idle           // 未连麦
        case applying       // 申请中
        case connected      // 连麦中
    }

    @Published var status: CoGuestStatus = .idle
    @Published var errorMessage: String?

    private let coGuestStore: CoGuestStore
    private var cancellables = Set<AnyCancellable>()
    private let applyTimeout: TimeInterval = 30

    init(liveID: String) {
        self.coGuestStore = CoGuestStore.create(liveID: liveID)
        observeGuestEvents()
    }

    // MARK: - 观众端事件订阅

    private func observeGuestEvents() {
        coGuestStore.guestEventPublisher
            .receive(on: DispatchQueue.main)
            .sink { [weak self] event in
                guard let self else { return }
                switch event {
                case .onGuestApplicationResponded(let isAccept, let hostUser):
                    if isAccept {
                        // ✅ 申请通过，立即开启设备
                        print("[CoGuest] 主播 \(hostUser.userName) 已同意申请")
                        self.openDevicesAfterAccepted()
                    } else {
                        // 申请被拒绝
                        self.status = .idle
                        self.errorMessage = "连麦申请被主播拒绝"
                    }

                case .onGuestApplicationNoResponse(let reason):
                    // 超时未响应
                    self.status = .idle
                    self.errorMessage = "申请超时，请重试"
                    print("[CoGuest] 申请超时，原因: \(reason)")

                case .onKickedOffSeat(let seatIndex, let hostUser):
                    // 被主播踢下麦位
                    self.closeDevicesAfterDisconnect()
                    self.status = .idle
                    self.errorMessage = "已被主播移出麦位（座位 \(seatIndex)）"
                    print("[CoGuest] 被 \(hostUser.userName) 踢下麦位 \(seatIndex)")

                case .onHostInvitationReceived(let hostUser):
                    // 收到主播邀请，可展示弹窗供用户选择
                    print("[CoGuest] 收到主播 \(hostUser.userName) 的邀请")

                case .onHostInvitationCancelled(let hostUser):
                    // 主播取消邀请
                    print("[CoGuest] 主播 \(hostUser.userName) 取消了邀请")
                }
            }
            .store(in: &cancellables)
    }

    // MARK: - 申请连麦
    // seatIndex: Int 默认 -1 表示自动分配麦位

    func applyForSeat(seatIndex: Int = -1) {
        guard status == .idle else { return }
        status = .applying

        coGuestStore.applyForSeat(
            seatIndex: seatIndex,
            timeout: applyTimeout,
            extraInfo: nil
        ) { [weak self] result in
            guard let self else { return }
            DispatchQueue.main.async {
                switch result {
                case .success:
                    // 申请发送成功，等待主播响应（通过 guestEventPublisher 回调）
                    print("[CoGuest] 申请已发送，等待主播响应...")
                case .failure(let error):
                    self.status = .idle
                    if error.code == -2340 {
                        self.errorMessage = "当前连麦人数已达上限，请稍后再试"
                    } else {
                        self.errorMessage = "申请失败：\(error.message)"
                    }
                }
            }
        }
    }

    // MARK: - 取消申请

    func cancelApplication() {
        guard status == .applying else { return }
        coGuestStore.cancelApplication { [weak self] _ in
            DispatchQueue.main.async {
                self?.status = .idle
            }
        }
    }

    // MARK: - 接受主播邀请（inviterID 为邀请方主播的 userID）

    func acceptInvitation(inviterID: String) {
        coGuestStore.acceptInvitation(inviterID: inviterID) { [weak self] result in
            DispatchQueue.main.async {
                switch result {
                case .success:
                    self?.openDevicesAfterAccepted()
                case .failure(let error):
                    self?.errorMessage = "接受邀请失败：\(error.message)"
                }
            }
        }
    }

    // MARK: - 拒绝主播邀请

    func rejectInvitation(inviterID: String) {
        coGuestStore.rejectInvitation(inviterID: inviterID) { result in
            if case .failure(let error) = result {
                print("[CoGuest] 拒绝邀请失败 code=\(error.code)")
            }
        }
    }

    // MARK: - 申请通过后开设备

    private func openDevicesAfterAccepted() {
        // 前置：设备控制能力（→ live/device-control）
        // 先开麦克风
        DeviceStore.shared.openLocalMicrophone { [weak self] micResult in
            guard let self else { return }
            switch micResult {
            case .failure(let error):
                print("[CoGuest] 麦克风打开失败 code=\(error.code)")
                self.errorMessage = "麦克风打开失败，请检查权限"
                // 麦克风失败，断开连麦
                self.coGuestStore.disConnect(completion: nil)
                DispatchQueue.main.async { self.status = .idle }
            case .success:
                // 再开摄像头
                DeviceStore.shared.openLocalCamera(isFront: true) { cameraResult in
                    DispatchQueue.main.async {
                        if case .failure(let error) = cameraResult {
                            print("[CoGuest] 摄像头打开失败 code=\(error.code)，以纯音频模式连麦")
                        }
                        self.status = .connected
                    }
                }
            }
        }
    }

    // MARK: - 主动断开连麦

    func disconnect() {
        guard status == .connected else { return }
        coGuestStore.disConnect { [weak self] _ in
            self?.closeDevicesAfterDisconnect()
            DispatchQueue.main.async { self?.status = .idle }
        }
    }

    // MARK: - 断开后关闭设备

    private func closeDevicesAfterDisconnect() {
        // 前置：设备控制能力（→ live/device-control）
        DeviceStore.shared.closeLocalCamera()
        DeviceStore.shared.closeLocalMicrophone()
        print("[CoGuest] 连麦已断开，设备已关闭")
    }
}
```

---

### 主播端：监听申请 → 同意 / 拒绝 → 邀请 → 管理连麦

```swift
import AtomicXCore
import Combine

final class HostCoGuestViewModel: ObservableObject {

    // MARK: 状态

    @Published var pendingApplicants: [LiveUserInfo] = []   // 待审批申请列表
    @Published var connectedGuests: [SeatUserInfo]  = []    // 当前连麦列表

    private let coGuestStore: CoGuestStore
    private var cancellables = Set<AnyCancellable>()

    init(liveID: String) {
        self.coGuestStore = CoGuestStore.create(liveID: liveID)
        observeHostEvents()
        observeState()
    }

    // MARK: - 主播端事件订阅

    private func observeHostEvents() {
        coGuestStore.hostEventPublisher
            .receive(on: DispatchQueue.main)
            .sink { [weak self] event in
                guard let self else { return }
                switch event {
                case .onGuestApplicationReceived(let guestUser):
                    // 新收到观众申请，添加到待审批列表
                    if !self.pendingApplicants.contains(where: { $0.userID == guestUser.userID }) {
                        self.pendingApplicants.append(guestUser)
                    }

                case .onGuestApplicationCancelled(let guestUser):
                    // 观众撤回了申请
                    self.pendingApplicants.removeAll { $0.userID == guestUser.userID }

                case .onGuestApplicationProcessedByOtherHost(let guestUser, let hostUser):
                    // 申请被其他主播处理（多主播场景）
                    self.pendingApplicants.removeAll { $0.userID == guestUser.userID }
                    print("[Host] \(guestUser.userName) 的申请已被 \(hostUser.userName) 处理")

                case .onHostInvitationResponded(let isAccept, let guestUser):
                    if isAccept {
                        print("[Host] \(guestUser.userName) 接受了邀请")
                    } else {
                        print("[Host] \(guestUser.userName) 拒绝了邀请")
                    }

                case .onHostInvitationNoResponse(let guestUser, let reason):
                    print("[Host] \(guestUser.userName) 未响应邀请，原因: \(reason)")
                }
            }
            .store(in: &cancellables)
    }

    // MARK: - 状态订阅（实时同步连麦列表）

    private func observeState() {
        coGuestStore.state
            .map(\.connected)
            .receive(on: DispatchQueue.main)
            .assign(to: &$connectedGuests)
    }

    // MARK: - 同意申请

    func acceptApplication(userID: String) {
        coGuestStore.acceptApplication(userID: userID) { [weak self] result in
            DispatchQueue.main.async {
                switch result {
                case .success:
                    self?.pendingApplicants.removeAll { $0.userID == userID }
                    print("[Host] 已同意 \(userID) 的连麦申请")
                case .failure(let error):
                    print("[Host] 同意申请失败 code=\(error.code) msg=\(error.message)")
                }
            }
        }
    }

    // MARK: - 拒绝申请

    func rejectApplication(userID: String) {
        coGuestStore.rejectApplication(userID: userID) { [weak self] result in
            DispatchQueue.main.async {
                switch result {
                case .success:
                    self?.pendingApplicants.removeAll { $0.userID == userID }
                    print("[Host] 已拒绝 \(userID) 的连麦申请")
                case .failure(let error):
                    print("[Host] 拒绝申请失败 code=\(error.code) msg=\(error.message)")
                }
            }
        }
    }

    // MARK: - 主播邀请观众上麦

    func inviteToSeat(userID: String, seatIndex: Int = -1) {
        coGuestStore.inviteToSeat(
            userID: userID,
            seatIndex: seatIndex,
            timeout: 30,
            extraInfo: nil
        ) { result in
            if case .failure(let error) = result {
                print("[Host] 邀请失败 code=\(error.code) msg=\(error.message)")
            }
        }
    }

    // MARK: - 主播踢出已连麦观众

    func disconnectGuest() {
        coGuestStore.disConnect { result in
            DispatchQueue.main.async {
                if case .failure(let error) = result {
                    print("[Host] 断开失败 code=\(error.code) msg=\(error.message)")
                }
            }
        }
    }
}
```

## 调用时序

```
【观众端】
用户点击"申请连麦"
        │
        ▼
coGuestStore.applyForSeat(seatIndex: -1, timeout: 30, extraInfo: nil)
        │
        ├─ .failure(code: -2340) → 麦位满，提示用户
        ├─ .failure(ErrorInfo) → 展示 error.message
        │
        └─ .success（申请发出，等待主播响应）
                │
                ▼（guestEventPublisher 回调）
        .onGuestApplicationResponded(isAccept:hostUser:)
                │
                ├─ isAccept == false → 提示被拒，status = .idle
                │
                └─ isAccept == true
                        │
                        ▼
                openLocalMicrophone()
                        │
                        ├─ .failure → disConnect，提示权限问题
                        └─ .success
                                │
                                ▼
                        openLocalCamera(isFront: true)
                                └─ status = .connected（连麦中）

        .onKickedOffSeat(seatIndex:hostUser:) → closeDevices() → status = .idle
        .onGuestApplicationNoResponse(reason:) → status = .idle，提示超时

【主播端（并行）】
订阅 hostEventPublisher
        │
        ▼
.onGuestApplicationReceived(guestUser:) → 加入待审批列表
        │
        ├─ 主播点击"同意" → acceptApplication(userID:)
        │       └─ 从 pendingApplicants 移除
        └─ 主播点击"拒绝" → rejectApplication(userID:)
                └─ 从 pendingApplicants 移除

.onGuestApplicationCancelled(guestUser:) → 从待审批列表移除
```

## 平台特有注意事项

### 1. seatIndex 参数
`applyForSeat` 包含 `seatIndex: Int` 参数（默认值 `-1`），`-1` 表示由系统自动分配麦位。若业务有固定麦位布局（如卡拉 OK 多人），可传具体的麦位索引（从 0 开始）。
```swift
// ✅ 自动分配麦位
coGuestStore.applyForSeat(seatIndex: -1, timeout: 30, extraInfo: nil)

// ✅ 指定麦位（如卡拉 OK 场景，固定 6 个座位）
coGuestStore.applyForSeat(seatIndex: 2, timeout: 30, extraInfo: nil)
```

### 2. acceptInvitation / rejectInvitation 参数为 inviterID
观众接受/拒绝主播邀请时，参数名为 `inviterID`（邀请方），不是 `userID`。不要与 `acceptApplication(userID:)` 混淆，两者语义不同。
```swift
// ✅ 正确：传主播的 userID 作为 inviterID
coGuestStore.acceptInvitation(inviterID: hostUserID, completion: nil)

// ❌ 错误：传了观众自己的 userID，接受邀请永远失败
coGuestStore.acceptInvitation(inviterID: selfUserID, completion: nil)
```

### 3. Combine cancellable 生命周期管理
`hostEventPublisher` 和 `guestEventPublisher` 是 Combine Publisher。订阅时返回的 `AnyCancellable` 必须存储到 ViewModel/ViewController 的属性中（如 `Set<AnyCancellable>`），否则订阅会立即被释放，导致主播收不到任何申请事件。

### 4. 连麦中 App 进入后台
iOS 系统进入后台时会挂起摄像头采集，但麦克风仍可持续（需在 `Info.plist` 开启 `audio` 后台模式）。连麦场景建议在 App 进入后台时关闭摄像头（`closeLocalCamera()`），避免观众看到定格画面。
```swift
// ✅ 监听进入后台，主动关闭摄像头
NotificationCenter.default.addObserver(
    forName: UIApplication.didEnterBackgroundNotification,
    object: nil, queue: .main
) { _ in
    DeviceStore.shared.closeLocalCamera()
}

// ❌ 不处理后台切换，观众看到定格黑屏画面
```

### 5. `-2340` 麦位超限
错误码 `-2340` 由服务端返回，表示当前直播间连麦人数已达上限。此时应禁用"申请连麦"按钮，并订阅 `CoGuestState.connected` 列表变化：当连麦人数减少时，自动重新启用按钮。
```swift
// ✅ 区分 -2340 给出有意义的提示
case .failure(let error):
    if error.code == -2340 {
        self.errorMessage = "当前连麦人数已达上限，请稍后再试"
        self.isApplyButtonDisabled = true
    }

// ❌ 所有错误统一提示，用户不知道为什么失败
case .failure(let error):
    self.errorMessage = "操作失败"
```

## 代码生成约束

本 section 供 AI 在生成/验证代码时使用，定义了此 slice 在 iOS 平台上的硬性约束。

### 编译必要条件

- **通用条件**：见 [login-auth 平台 slice](login-auth.md)（pod 安装、Info.plist 权限）
- **额外导入**: `import Combine` — 事件订阅依赖 Combine 框架
- **最低平台版本**: iOS 15.0+（Combine `store(in: &$published)` 语法要求，高于 login-auth 的 iOS 13.0+ 基线）

### 生成规则

#### MUST（生成时必须包含）

1. **所有 Combine sink 必须 `[weak self]`** — `CoGuestStore` 的 publisher 生命周期可能长于 ViewModel/ViewController。不用 `[weak self]` 导致循环引用，ViewModel 永远不释放，连带整个直播间页面泄漏。
2. **`AnyCancellable` 必须存储为实例属性** — `var cancellables = Set<AnyCancellable>()`。如果声明为局部变量，订阅在方法返回时立即取消，主播端收不到任何申请事件（最常见的"主播无响应"排障原因）。
3. **UI 更新必须 `receive(on: DispatchQueue.main)`** — `hostEventPublisher` / `guestEventPublisher` 的回调线程不确定。不切主线程更新 `@Published` 属性会触发 SwiftUI/UIKit 线程安全 crash。
4. **`applyForSeat` 的 completion failure 必须处理 `-2340`** — 麦位满错误需要特殊 UI 提示（区别于通用错误），否则用户看不到有意义的反馈。
5. **`acceptInvitation` 参数必须用 `inviterID`，不是 `userID`** — 这是 SDK API 设计的参数名。用 `userID` 编译通过但逻辑错误（传了观众自己的 ID），导致接受邀请永远失败。

#### MUST NOT（生成时绝不能出现）

1. **不要在 `deinit` 中做事件取消/清理** — iOS 中 ViewController 的 `deinit` 可能因循环引用永远不被调用。清理逻辑放在 `viewDidDisappear` 或显式 `cleanup()` 方法中。
2. **不要在 `applyForSeat` 成功回调中开设备** — `.success` 仅表示申请发送成功（信令发出），不是主播同意。开设备必须等 `.onGuestApplicationResponded(isAccept: true)`。混淆这两步会导致观众在未获批时就推流。
3. **不要自行构造 `CoGuestStore()` 实例** — 必须通过 `CoGuestStore.create(liveID:)` 工厂方法创建。直接构造缺少内部初始化，所有 API 调用静默失败。
4. **不要省略 `errorMessage` 的用户可见处理** — 每个 `.failure` 分支都必须有面向用户的提示（`@Published var errorMessage` 或 alert），不能只 `print`。只 print 的错误用户完全感知不到。

### 集成检查点

- **SDK 初始化**: 确认项目的 AppDelegate/SceneDelegate 中已完成 `LoginStore` 初始化和登录。本 slice 依赖 `LoginStore.shared.isLogin == true`（参考 slice: `live/login`）
- **已有直播间页面**: 如果项目已有直播间 ViewController，`AudienceCoGuestViewModel` / `HostCoGuestViewModel` 应作为该页面的属性注入，不要创建新的 ViewController
- **设备管理冲突**: 如果项目已有 `DeviceStore` 相关调用（如美颜 slice 的 camera 控制），确认 `openLocalCamera` / `closeLocalCamera` 不会和已有逻辑互相覆盖。建议统一通过一个设备管理层调用
- **Combine 版本**: 如果项目混用 RxSwift 和 Combine，确认不会出现两套订阅管理。本 slice 的代码纯 Combine 实现
- **文件组织**: 本 slice 生成 2 个新文件（`AudienceCoGuestViewModel.swift` + `HostCoGuestViewModel.swift`），不修改已有文件。但需要在已有的直播间页面中 import 和初始化这两个 ViewModel

### 可运行验证

- **编译验证**: `xcodebuild build -workspace {Project}.xcworkspace -scheme {Scheme} -destination 'platform=iOS Simulator,name=iPhone 16' -quiet` — 预期 exit code 0
- **最小运行时验证**:
  1. 启动 App → 进入直播间
  2. 观众端点击"申请连麦" → 控制台应输出 `[CoGuest] 申请已发送，等待主播响应...`
  3. 主播端控制台应输出 `onGuestApplicationReceived` 事件
  4. 如果主播未订阅（故意测试错误路径），30 秒后观众端应显示"申请超时，请重试"
