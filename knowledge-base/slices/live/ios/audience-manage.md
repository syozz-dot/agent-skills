---
id: live/audience-manage
platform: ios
---

# 观众管理 — iOS 实现

## 前置条件

**依赖安装（Podfile）**
```ruby
pod 'AtomicXCore', '~> 4.0'
```

**前置状态**：
- `LoginStore.shared.isLogin == true`
- 已成功进入直播间
- 当前用户为房主（执行 `setAdministrator` / `revokeAdministrator`）或管理员（执行 `kickUserOutOfRoom`）

## API 调用

```swift
// 踢出观众（需房主或管理员权限）
liveAudienceStore.kickUserOutOfRoom(
    userID: String,
    completion: ((Result<Void, Error>) -> Void)?
)

// 设置管理员（仅房主）
liveAudienceStore.setAdministrator(
    userID: String,
    completion: ((Result<Void, Error>) -> Void)?
)

// 撤销管理员（仅房主）
liveAudienceStore.revokeAdministrator(
    userID: String,
    completion: ((Result<Void, Error>) -> Void)?
)
```

| 参数 | 类型 | 说明 |
|------|------|------|
| `userID` | `String` | 目标用户的唯一标识 |
| `completion` | `Result<Void, Error>?` | 异步回调，主线程返回 |

## 代码示例

### 完整管理操作集成

```swift
import AtomicXCore
import Combine

final class AudienceManageManager {

    // MARK: - 属性

    private let audienceStore: LiveAudienceStore
    private var cancellables = Set<AnyCancellable>()

    /// 当前用户角色（从 LiveStore 获取）
    private var currentUserRole: UserRole = .audience

    // MARK: - 初始化

    init(audienceStore: LiveAudienceStore) {
        self.audienceStore = audienceStore
        subscribeKickEvent()
    }

    // MARK: - 监听被踢事件（所有用户都需监听）

    private func subscribeKickEvent() {
        audienceStore.onKickedOutOfLive
            .receive(on: DispatchQueue.main)
            .sink { [weak self] in
                // 步骤: 收到被踢通知，立即退出直播间
                self?.handleKickedOut()
            }
            .store(in: &cancellables)
    }

    private func handleKickedOut() {
        // 1. 展示提示
        showToast("您已被主播移出直播间")
        // 2. 退出房间
        exitLiveRoom()
    }

    // MARK: - 权限校验

    /// 校验是否有踢人权限
    private func canKick(targetRole: UserRole) -> Bool {
        switch currentUserRole {
        case .owner:
            // 房主可以踢任何人
            return true
        case .admin:
            // 管理员只能踢普通观众，不能踢其他管理员或房主
            return targetRole == .audience
        case .audience:
            return false
        }
    }

    /// 校验是否有设置/撤销管理员权限
    private func canManageAdmin() -> Bool {
        return currentUserRole == .owner
    }

    // MARK: - 踢出观众

    func kickUser(_ userID: String,
                  targetRole: UserRole,
                  completion: ((Result<Void, Error>) -> Void)? = nil) {
        // 步骤1: 调用前校验权限
        guard canKick(targetRole: targetRole) else {
            let error = ManageError.insufficientPermission
            print("[AudienceManage] 权限不足，无法踢出用户: \(userID)")
            completion?(.failure(error))
            return
        }

        // 步骤2: 踢出用户
        audienceStore.kickUserOutOfRoom(userID: userID) { result in
            DispatchQueue.main.async {
                switch result {
                case .success:
                    print("[AudienceManage] 已踢出用户: \(userID)")
                    completion?(.success(()))
                case .failure(let error):
                    print("[AudienceManage] 踢出失败: \(error)")
                    completion?(.failure(error))
                }
            }
        }
    }

    // MARK: - 管理员设置（仅房主）

    func setAdministrator(_ userID: String,
                          completion: ((Result<Void, Error>) -> Void)? = nil) {
        // 步骤3: 校验房主权限
        guard canManageAdmin() else {
            completion?(.failure(ManageError.insufficientPermission))
            return
        }

        audienceStore.setAdministrator(userID: userID) { result in
            DispatchQueue.main.async {
                switch result {
                case .success:
                    print("[AudienceManage] 已设置管理员: \(userID)")
                    completion?(.success(()))
                case .failure(let error):
                    print("[AudienceManage] 设置管理员失败: \(error)")
                    completion?(.failure(error))
                }
            }
        }
    }

    func revokeAdministrator(_ userID: String,
                             completion: ((Result<Void, Error>) -> Void)? = nil) {
        guard canManageAdmin() else {
            completion?(.failure(ManageError.insufficientPermission))
            return
        }

        audienceStore.revokeAdministrator(userID: userID) { result in
            DispatchQueue.main.async {
                switch result {
                case .success:
                    print("[AudienceManage] 已撤销管理员: \(userID)")
                    completion?(.success(()))
                case .failure(let error):
                    print("[AudienceManage] 撤销管理员失败: \(error)")
                    completion?(.failure(error))
                }
            }
        }
    }

    // MARK: - 错误处理

    func handleManageError(_ error: Error, for operation: String) {
        let code = (error as? LiveError)?.code ?? -1
        switch code {
        case -2300:
            showAlert(title: "权限不足", message: "该操作仅房主可执行")
        case -2301:
            showAlert(title: "权限不足", message: "该操作需要管理员或房主权限")
        case -2302:
            showToast("该用户已不在直播间")
        default:
            showToast("\(operation)失败：\(error.localizedDescription)")
        }
    }
}

// MARK: - 错误类型

enum ManageError: LocalizedError {
    case insufficientPermission

    var errorDescription: String? {
        switch self {
        case .insufficientPermission:
            return "权限不足，无法执行此操作"
        }
    }
}

// MARK: - 用户角色

enum UserRole {
    case owner      // 房主
    case admin      // 管理员
    case audience   // 普通观众
}
```

### 观众列表操作菜单

```swift
// 观众列表 Cell 上的操作菜单（权限判断）
func showAudienceActionMenu(for audience: AudienceInfo,
                            currentRole: UserRole) {
    var actions: [UIAlertAction] = []

    // 仅房主或管理员可踢人（管理员只能踢普通观众）
    let canKick = (currentRole == .owner) ||
                  (currentRole == .admin && audience.role == .audience)
    if canKick {
        actions.append(UIAlertAction(title: "踢出直播间", style: .destructive) { [weak self] _ in
            self?.confirmKick(userID: audience.userID)
        })
    }

    // 仅房主可设置/撤销管理员
    if currentRole == .owner {
        if audience.role == .audience {
            actions.append(UIAlertAction(title: "设为管理员", style: .default) { [weak self] _ in
                self?.manageManager.setAdministrator(audience.userID) { result in
                    if case .failure(let error) = result {
                        self?.manageManager.handleManageError(error, for: "设为管理员")
                    }
                }
            })
        } else if audience.role == .admin {
            actions.append(UIAlertAction(title: "撤销管理员", style: .default) { [weak self] _ in
                self?.manageManager.revokeAdministrator(audience.userID) { result in
                    if case .failure(let error) = result {
                        self?.manageManager.handleManageError(error, for: "撤销管理员")
                    }
                }
            })
        }
    }

    guard !actions.isEmpty else { return }

    let sheet = UIAlertController(
        title: audience.userName,
        message: nil,
        preferredStyle: .actionSheet
    )
    actions.forEach { sheet.addAction($0) }
    sheet.addAction(UIAlertAction(title: "取消", style: .cancel))
    present(sheet, animated: true)
}

private func confirmKick(userID: String) {
    // 二次确认，防止误操作
    let alert = UIAlertController(
        title: "踢出直播间",
        message: "确定要将该用户移出直播间吗？",
        preferredStyle: .alert
    )
    alert.addAction(UIAlertAction(title: "确定", style: .destructive) { [weak self] _ in
        self?.manageManager.kickUser(userID, targetRole: .audience) { result in
            if case .failure(let error) = result {
                self?.manageManager.handleManageError(error, for: "踢出用户")
            }
        }
    })
    alert.addAction(UIAlertAction(title: "取消", style: .cancel))
    present(alert, animated: true)
}
```

## 调用时序

```
进入直播间
    │
    ▼
订阅 onKickedOutOfLive                 // ⚠️ 所有角色都须监听，确保被踢时正确退出
    │
    ├─ 房主操作流程
    │       │
    │       ├─ setAdministrator(userID:)
    │       │       ├─ .success → 更新观众列表角色标记
    │       │       └─ .failure(-2300) → 非房主，隐藏入口
    │       │
    │       └─ revokeAdministrator(userID:)
    │               ├─ .success → 更新观众列表角色标记
    │               └─ .failure(-2300) → 非房主，隐藏入口
    │
    ├─ 房主/管理员踢人流程
    │       │
    │       ├─ 权限校验（canKick）
    │       ├─ 二次确认弹窗
    │       └─ kickUserOutOfRoom(userID:)
    │               ├─ .success → 刷新观众列表
    │               ├─ .failure(-2301) → 权限不足
    │               └─ .failure(-2302) → 用户已离开，刷新列表
    │
    └─ 被踢用户收到 onKickedOutOfLive
            │
            ▼
        展示提示 → 退出直播间 → 返回上一页
```

## 平台特有注意事项

### 1. `onKickedOutOfLive` 线程安全
`onKickedOutOfLive` 回调可能在非主线程触发。使用 `.receive(on: DispatchQueue.main)` 确保 UI 操作在主线程执行，避免界面异常。

### 2. 管理员权限 UI 实时刷新
当房主撤销某用户的管理员权限时，该用户应立即看到操作按钮的变化（如隐藏踢人按钮）。通过订阅观众列表状态变化来驱动 UI 更新，不要依赖本地缓存的角色信息。

### 3. iPad 上的 ActionSheet
在 iPad 上，`UIAlertController` 的 `.actionSheet` 样式需要设置 `popoverPresentationController` 的 `sourceView` 和 `sourceRect`，否则会崩溃。

```swift
if let popover = sheet.popoverPresentationController {
    popover.sourceView = cell
    popover.sourceRect = cell.bounds
}
```
