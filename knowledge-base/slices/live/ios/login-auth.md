---
id: live/login-auth
platform: ios
---

# 登录与鉴权 — iOS 实现

## 前置条件

**依赖安装（Podfile）**
```ruby
pod 'AtomicXCore', '~> 4.0'
```

**Info.plist 权限声明**（推流场景必须配置，否则 iOS 14+ 设备调用设备接口时崩溃）
```xml
<key>NSCameraUsageDescription</key>
<string>需要访问摄像头以进行视频直播</string>
<key>NSMicrophoneUsageDescription</key>
<string>需要访问麦克风以进行语音直播</string>
```

**最低系统要求**：iOS 13.0+，Xcode 14.0+

## API 调用

```swift
// 登录
LoginStore.shared.login(
    sdkAppID: Int,
    userID: String,
    userSig: String,
    completion: ((Result<UserInfo, LoginError>) -> Void)?
)

// 登出
LoginStore.shared.logout(
    completion: ((Result<Void, LoginError>) -> Void)?
)

// 当前登录状态
LoginStore.shared.isLogin: Bool

// 当前登录用户信息
LoginStore.shared.loginUserInfo: UserInfo?
```

| 参数 | 类型 | 说明 |
|------|------|------|
| `sdkAppID` | `Int` | 腾讯云控制台的应用 ID |
| `userID` | `String` | 用户唯一标识，ASCII 字母/数字/`-`/`_`，≤ 32 字节 |
| `userSig` | `String` | 后端签发的鉴权票据 |
| `completion` | `Result<UserInfo, LoginError>?` | 异步回调，在主线程返回 |

## 代码示例

```swift
import AtomicXCore

/// 全局登录管理器，封装 LoginStore 调用
final class LiveManager {

    static let shared = LiveManager()
    private init() {}

    // MARK: - 登录

    /// 使用后端签发的 UserSig 完成 SDK 登录
    /// - Parameters:
    ///   - sdkAppID: 腾讯云控制台 SDKAppID
    ///   - userID:   业务用户 ID（ASCII，≤32字节）
    ///   - userSig:  后端接口返回的鉴权票据
    ///   - completion: 主线程回调
    func login(sdkAppID: Int,
               userID: String,
               userSig: String,
               completion: @escaping (Result<Void, Error>) -> Void) {

        // 1. 基本参数校验
        guard sdkAppID > 0 else {
            completion(.failure(LiveError.invalidSDKAppID))
            return
        }
        guard !userID.isEmpty, userID.count <= 32 else {
            completion(.failure(LiveError.invalidUserID))
            return
        }
        guard !userSig.isEmpty else {
            completion(.failure(LiveError.emptyUserSig))
            return
        }

        // 2. 调用 SDK 登录
        LoginStore.shared.login(sdkAppID: sdkAppID,
                                userID: userID,
                                userSig: userSig) { [weak self] result in
            switch result {
            case .success(let userInfo):
                print("[LiveManager] 登录成功, userID: \(userInfo.userID)")
                completion(.success(()))

            case .failure(let error):
                print("[LiveManager] 登录失败, code: \(error.code), msg: \(error.message)")
                completion(.failure(error))
            }
        }
    }

    // MARK: - 登出

    /// 退出登录并释放 SDK 资源
    func logout(completion: ((Result<Void, Error>) -> Void)? = nil) {
        LoginStore.shared.logout { result in
            switch result {
            case .success:
                print("[LiveManager] 登出成功")
                completion?(.success(()))
            case .failure(let error):
                print("[LiveManager] 登出失败, code: \(error.code)")
                completion?(.failure(error))
            }
        }
    }

    // MARK: - 状态查询

    var isLoggedIn: Bool {
        LoginStore.shared.isLogin
    }

    var currentUserID: String? {
        LoginStore.shared.loginUserInfo?.userID
    }
}

// MARK: - 错误类型

enum LiveError: LocalizedError {
    case invalidSDKAppID
    case invalidUserID
    case emptyUserSig

    var errorDescription: String? {
        switch self {
        case .invalidSDKAppID: return "SDKAppID 不合法，请检查控制台配置"
        case .invalidUserID:   return "UserID 为空或超过 32 字节"
        case .emptyUserSig:    return "UserSig 不能为空，请从后端获取"
        }
    }
}
```

**使用示例（ViewController）**：
```swift
// 典型调用流程：从后端获取 UserSig 后登录
func startLiveSession() {
    // Step 1: 从业务后端获取 UserSig（伪代码）
    YourAPI.fetchUserSig(userID: currentUserID) { [weak self] userSig in
        guard let self = self, let userSig = userSig else { return }

        // Step 2: 登录 SDK
        LiveManager.shared.login(
            sdkAppID: 1400000001,   // 替换为真实 SDKAppID
            userID: currentUserID,
            userSig: userSig
        ) { result in
            switch result {
            case .success:
                // Step 3: 登录成功后再操作设备/进房
                self.setupDevices()
            case .failure(let error):
                self.showAlert(message: error.localizedDescription)
            }
        }
    }
}
```

## 调用时序

```
App 启动
    │
    ▼
从业务后端获取 UserSig
    │
    ├─ 失败 ──→ 展示网络错误，引导重试
    │
    ▼
LoginStore.shared.login(sdkAppID:userID:userSig:)
    │
    ├─ .failure(error)
    │       ├─ code -1000 → 核查 SDKAppID
    │       ├─ code -1001 → 检查 UserSig 有效期 / UserID 格式
    │       └─ 其他      → 上报日志，提示用户
    │
    └─ .success(userInfo)
            │
            ▼
        进入主功能流程
        （设备初始化 / 进入房间 / 开始推流）
```

## 平台特有注意事项

### 1. Info.plist 权限缺失导致崩溃
iOS 14+ 系统在首次访问相机/麦克风时，若未在 `Info.plist` 中声明 `NSCameraUsageDescription` 或 `NSMicrophoneUsageDescription`，App **直接崩溃**（不返回错误码）。务必在集成 SDK 时同步添加权限描述。

### 2. 进入后台后网络断连
App 切入后台超过约 30 秒后，iOS 系统可能中断 TCP 长连接，导致 `LoginStore` 登录态失效。建议：
- 监听 `UIApplication.willEnterForegroundNotification`
- 在前台恢复时通过 `LoginStore.shared.isLogin` 检查状态
- 如已失效，重新调用 `login`（UserSig 仍在有效期内则无需重新获取）

### 3. UserSig 刷新策略
UserSig 有有效期（建议后端配置 7 天），客户端应：
- 在签发时记录过期时间戳（`exp` 字段）
- App 启动或前台恢复时检查是否在有效期内
- 距离过期 ≤ 1 小时时主动向后端刷新，避免直播中途 UserSig 失效中断推流
