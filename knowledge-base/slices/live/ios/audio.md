---
id: live/audio
platform: ios
---

# 音效管理 — iOS 实现

## 前置条件

**依赖安装（Podfile）**
```ruby
pod 'AtomicXCore', '~> 4.0'
```

**前置状态**：
- `LoginStore.shared.isLogin == true`（登录成功后才可调用音效接口）
- `DeviceStore.shared.openLocalMicrophone` 已成功回调（麦克风打开后音效才生效）
- 耳返功能须插入耳机；通过 `AVAudioSession.currentRoute.outputs` 检查当前音频路由

## API 调用

```swift
// ── 采集音量（DeviceStore）──────────────────────────────────────
// 设置麦克风采集音量；范围 0–150，默认 100（影响观众收到的音量）
DeviceStore.shared.setCaptureVolume(volume: Int)

// ── 耳返（AudioEffectStore）────────────────────────────────────
// 开启 / 关闭耳返（需插入耳机）
AudioEffectStore.shared.setVoiceEarMonitorEnable(enable: Bool)

// 设置耳返音量；范围 0–150，默认 100（仅主播本人通过耳机听到）
AudioEffectStore.shared.setVoiceEarMonitorVolume(volume: Int)

// ── 变声（AudioEffectStore）────────────────────────────────────
// 设置变声类型；传 .none 还原原声
AudioEffectStore.shared.setAudioChangerType(type: AudioChangerType)

// ── 混响（AudioEffectStore）────────────────────────────────────
// 设置混响类型；传 .none 还原
AudioEffectStore.shared.setAudioReverbType(type: AudioReverbType)

// ── 重置（直播结束时必须调用）──────────────────────────────────
AudioEffectStore.shared.reset()
```

| 参数 | 类型 | 说明 |
|------|------|------|
| `volume` | `Int` | 音量值，范围 `0–150`，默认 `100` |
| `enable` | `Bool` | `true` 开启耳返，`false` 关闭 |
| `type` (AudioChangerType) | `AudioChangerType` | `.none` / `.child` / `.littleGirl` / `.uncle` 等 |
| `type` (AudioReverbType) | `AudioReverbType` | `.none` / `.ktv` / `.theater` / `.metallic` / `.resonant` 等 |

## 代码示例

```swift
import AtomicXCore
import AVFoundation
import Combine

// MARK: - 音效面板 ViewModel

final class AudioEffectPanelViewModel: ObservableObject {

    // MARK: Published 状态（与 UI 双向绑定）

    @Published var captureVolume: Int = 100         // 采集音量 (0–150)
    @Published var earMonitorEnabled: Bool = false  // 耳返开关
    @Published var earMonitorVolume: Int = 100      // 耳返音量 (0–150)
    @Published var changerType: AudioChangerType = .none    // 变声
    @Published var reverbType: AudioReverbType = .none      // 混响
    @Published var isHeadphoneConnected: Bool = false       // 耳机连接状态

    private var cancellables = Set<AnyCancellable>()

    init() {
        syncStateFromStore()
        observeAudioRoute()
    }

    // MARK: - 状态同步（从 Store 读取当前值）

    private func syncStateFromStore() {
        // 从 DeviceStore 同步采集音量
        DeviceStore.shared.$state
            .map(\.captureVolume)
            .receive(on: DispatchQueue.main)
            .assign(to: &$captureVolume)

        // 从 AudioEffectStore 同步音效状态
        AudioEffectStore.shared.$state
            .receive(on: DispatchQueue.main)
            .sink { [weak self] state in
                guard let self else { return }
                self.earMonitorEnabled = state.isEarMonitorEnabled
                self.earMonitorVolume  = state.earMonitorVolume
                self.changerType       = state.audioChangerType
                self.reverbType        = state.audioReverbType
            }
            .store(in: &cancellables)
    }

    // MARK: - 耳机路由监听

    private func observeAudioRoute() {
        isHeadphoneConnected = checkHeadphoneConnected()

        NotificationCenter.default
            .publisher(for: AVAudioSession.routeChangeNotification)
            .receive(on: DispatchQueue.main)
            .sink { [weak self] _ in
                guard let self else { return }
                self.isHeadphoneConnected = self.checkHeadphoneConnected()
                // 耳机断开时自动关闭耳返
                if !self.isHeadphoneConnected && self.earMonitorEnabled {
                    self.setEarMonitorEnabled(false)
                }
            }
            .store(in: &cancellables)
    }

    private func checkHeadphoneConnected() -> Bool {
        let outputs = AVAudioSession.sharedInstance().currentRoute.outputs
        return outputs.contains { $0.portType == .headphones || $0.portType == .bluetoothA2DP }
    }

    // MARK: - 采集音量控制

    func setCaptureVolume(_ volume: Int) {
        let clamped = max(0, min(150, volume))
        DeviceStore.shared.setCaptureVolume(volume: clamped)
    }

    // MARK: - 耳返控制

    func setEarMonitorEnabled(_ enable: Bool) {
        guard !enable || isHeadphoneConnected else {
            // 未接耳机时禁止开启，通知 UI 展示提示
            print("[AudioEffect] 耳返需要插入耳机")
            return
        }
        AudioEffectStore.shared.setVoiceEarMonitorEnable(enable: enable)
    }

    func setEarMonitorVolume(_ volume: Int) {
        let clamped = max(0, min(150, volume))
        AudioEffectStore.shared.setVoiceEarMonitorVolume(volume: clamped)
    }

    // MARK: - 变声控制

    func setChangerType(_ type: AudioChangerType) {
        AudioEffectStore.shared.setAudioChangerType(type: type)
    }

    // MARK: - 混响控制

    func setReverbType(_ type: AudioReverbType) {
        AudioEffectStore.shared.setAudioReverbType(type: type)
    }

    // MARK: - 重置（直播结束时调用）

    func resetAll() {
        AudioEffectStore.shared.reset()
        // 采集音量也恢复默认
        DeviceStore.shared.setCaptureVolume(volume: 100)
    }
}

// MARK: - 音效面板 ViewController

final class AudioEffectPanelViewController: UIViewController {

    private let viewModel = AudioEffectPanelViewModel()
    private var cancellables = Set<AnyCancellable>()

    // MARK: UI 元素

    private let captureVolumeSlider = UISlider()
    private let earMonitorSwitch    = UISwitch()
    private let earMonitorSlider    = UISlider()
    private let changerSegment      = UISegmentedControl(items: ["原声", "儿童", "萝莉", "大叔"])
    private let reverbSegment       = UISegmentedControl(items: ["无", "KTV", "剧院", "金属"])
    private let resetButton         = UIButton(type: .system)

    override func viewDidLoad() {
        super.viewDidLoad()
        setupUI()
        bindViewModel()
    }

    // MARK: - UI 绑定

    private func bindViewModel() {
        // 采集音量
        viewModel.$captureVolume
            .map { Float($0) }
            .receive(on: DispatchQueue.main)
            .assign(to: \.value, on: captureVolumeSlider)
            .store(in: &cancellables)

        // 耳返开关
        viewModel.$earMonitorEnabled
            .receive(on: DispatchQueue.main)
            .assign(to: \.isOn, on: earMonitorSwitch)
            .store(in: &cancellables)

        // 耳返 Slider 启用状态（未连耳机时置灰）
        viewModel.$isHeadphoneConnected
            .receive(on: DispatchQueue.main)
            .assign(to: \.isEnabled, on: earMonitorSwitch)
            .store(in: &cancellables)

        // 耳返音量
        viewModel.$earMonitorVolume
            .map { Float($0) }
            .receive(on: DispatchQueue.main)
            .assign(to: \.value, on: earMonitorSlider)
            .store(in: &cancellables)
    }

    // MARK: - 控件回调

    @objc private func captureVolumeChanged(_ slider: UISlider) {
        viewModel.setCaptureVolume(Int(slider.value))
    }

    @objc private func earMonitorSwitchChanged(_ sw: UISwitch) {
        viewModel.setEarMonitorEnabled(sw.isOn)
    }

    @objc private func earMonitorVolumeChanged(_ slider: UISlider) {
        viewModel.setEarMonitorVolume(Int(slider.value))
    }

    @objc private func changerSegmentChanged(_ segment: UISegmentedControl) {
        let types: [AudioChangerType] = [.none, .child, .littleGirl, .uncle]
        guard segment.selectedSegmentIndex < types.count else { return }
        viewModel.setChangerType(types[segment.selectedSegmentIndex])
    }

    @objc private func reverbSegmentChanged(_ segment: UISegmentedControl) {
        let types: [AudioReverbType] = [.none, .ktv, .theater, .metallic]
        guard segment.selectedSegmentIndex < types.count else { return }
        viewModel.setReverbType(types[segment.selectedSegmentIndex])
    }

    @objc private func resetTapped() {
        viewModel.resetAll()
    }

    // MARK: - 基础 UI 搭建（省略 AutoLayout 细节）

    private func setupUI() {
        view.backgroundColor = .systemBackground

        captureVolumeSlider.minimumValue = 0
        captureVolumeSlider.maximumValue = 150
        captureVolumeSlider.addTarget(self, action: #selector(captureVolumeChanged), for: .valueChanged)

        earMonitorSwitch.addTarget(self, action: #selector(earMonitorSwitchChanged), for: .valueChanged)

        earMonitorSlider.minimumValue = 0
        earMonitorSlider.maximumValue = 150
        earMonitorSlider.addTarget(self, action: #selector(earMonitorVolumeChanged), for: .valueChanged)

        changerSegment.selectedSegmentIndex = 0
        changerSegment.addTarget(self, action: #selector(changerSegmentChanged), for: .valueChanged)

        reverbSegment.selectedSegmentIndex = 0
        reverbSegment.addTarget(self, action: #selector(reverbSegmentChanged), for: .valueChanged)

        resetButton.setTitle("重置音效", for: .normal)
        resetButton.addTarget(self, action: #selector(resetTapped), for: .touchUpInside)

        // 添加视图（省略具体 AutoLayout）
        [captureVolumeSlider, earMonitorSwitch, earMonitorSlider,
         changerSegment, reverbSegment, resetButton].forEach { view.addSubview($0) }
    }
}
```

**直播结束时重置（在主播下播回调中调用）**：
```swift
func onAnchorStopBroadcast() {
    // 重置所有音效，防止残留到下一场直播
    AudioEffectStore.shared.reset()
    DeviceStore.shared.setCaptureVolume(volume: 100)
}
```

## 调用时序

```
主播开播，麦克风打开成功
        │
        ▼
【可选】预设音效
        ├─ DeviceStore.shared.setCaptureVolume(volume: 100)   // 采集音量
        ├─ AudioEffectStore.shared.setAudioChangerType(.ktv)  // 变声
        └─ AudioEffectStore.shared.setAudioReverbType(.ktv)   // 混响
        │
        ▼
主播开播中：用户通过面板实时调整
        ├─ 采集音量：setCaptureVolume(volume:)
        ├─ 耳返：setVoiceEarMonitorEnable / setVoiceEarMonitorVolume
        ├─ 变声：setAudioChangerType(type:)
        └─ 混响：setAudioReverbType(type:)
        │
        ▼
主播下播 / 退出直播间
        │
        ├─ AudioEffectStore.shared.reset()     ← ✅ 必须调用
        └─ DeviceStore.shared.setCaptureVolume(volume: 100)

耳机连接监听（贯穿整个直播生命周期）
        ├─ AVAudioSession.routeChangeNotification 触发
        ├─ 耳机拔出 → 自动关闭耳返
        └─ 耳机插入 → 可允许用户开启耳返
```

## 平台特有注意事项

### 1. 耳返依赖音频会话路由
iOS 的耳返需要通过 `AVAudioSession.currentRoute.outputs` 确认存在 `.headphones` 或 `.bluetoothA2DP` 输出。蓝牙耳机受协议限制（如 A2DP 与 HFP 切换），耳返延迟可能较高；建议优先提示用户使用有线耳机以获得最佳耳返体验。

### 2. AVAudioSession 配置
音效功能依赖 SDK 内部的 `AVAudioSession` 配置（通常为 `.playAndRecord` + `.allowBluetooth`）。若 App 自行修改了 `AVAudioSession.category`，可能导致耳返或混响失效。建议将音频会话管理统一交给 SDK，不要在直播期间手动调用 `AVAudioSession.setCategory`。

### 3. 变声与混响可叠加使用
`setAudioChangerType` 与 `setAudioReverbType` 互不干扰，可同时生效（如"萝莉音 + KTV 混响"）。需要单独还原某一项时，传入对应的 `.none` 即可，不影响另一项设置。

### 4. reset() 仅重置音效，不关闭设备
`AudioEffectStore.shared.reset()` 只还原音效参数（变声、混响、耳返、音量），**不会**关闭麦克风或摄像头。设备的关闭须单独调用 `DeviceStore.shared.closeLocalMicrophone()` 等方法。
