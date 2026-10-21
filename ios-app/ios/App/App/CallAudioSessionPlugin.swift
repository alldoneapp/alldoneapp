import AVFoundation
import Capacitor
import Foundation
import UIKit

/// Configures the host app's audio session around an assistant voice call
/// (AT-2496).
///
/// The call is a WebRTC peer connection inside the WKWebView. WebKit does not
/// own an audio session of its own on iOS: the web content / GPU processes
/// proxy every AVAudioSession call into the host app (RemoteAudioSession), so
/// the session this plugin configures IS the one the web view records and
/// plays through. Two things follow:
///
/// 1. The `audio` entry in `UIBackgroundModes` (Info.plist) is what keeps the
///    app - and with it the web view's capture - alive when the user presses
///    the home button or locks the screen. Without it iOS suspends the app a
///    few seconds after it leaves the foreground and the call dies. `begin`
///    reports whether the running build carries that mode so the web side can
///    log an honest warning instead of promising a background call it cannot
///    deliver.
/// 2. Setting the category to `.playAndRecord` / `.voiceChat` before the web
///    view opens the microphone gives the call the voice-processing chain
///    (echo cancellation, speaker routing, Bluetooth) from the first sample.
///    WebKit would converge on the same category once capture starts; doing it
///    first avoids a route change mid-connection.
///
/// `end` deactivates the session after the web side has stopped its tracks,
/// notifying other apps (music) that they may resume.
@objc(CallAudioSessionPlugin)
final class CallAudioSessionPlugin: CAPInstancePlugin, CAPBridgedPlugin {
    let identifier = "CallAudioSessionPlugin"
    let jsName = "CallAudioSession"
    let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "begin", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "end", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getStatus", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getAudioDevices", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setInput", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setOutput", returnType: CAPPluginReturnPromise)
    ]

    private var sessionActive = false
    private var routeObserver: NSObjectProtocol?
    private var knownInputs = Set<String>()
    private let externalInputTypes: Set<AVAudioSession.Port> = [.bluetoothHFP, .bluetoothLE, .headsetMic, .usbAudio]

    deinit {
        if let routeObserver { NotificationCenter.default.removeObserver(routeObserver) }
    }

    private func hasBackgroundAudioMode() -> Bool {
        let modes = Bundle.main.object(forInfoDictionaryKey: "UIBackgroundModes") as? [String] ?? []
        return modes.contains("audio")
    }

    private func status() -> [String: Any] {
        let session = AVAudioSession.sharedInstance()
        return [
            "active": sessionActive,
            "audioRouting": true,
            "backgroundAudio": hasBackgroundAudioMode(),
            "category": session.category.rawValue,
            "mode": session.mode.rawValue,
            "microphonePermission": describePermission(session.recordPermission)
        ]
    }

    private func audioDevices() -> [String: Any] {
        let session = AVAudioSession.sharedInstance()
        let inputs = session.availableInputs ?? []
        let input = session.currentRoute.inputs.first
        let output = session.currentRoute.outputs.first
        var outputs: [[String: String]] = [["deviceId": "speaker", "labelKey": "Speakerphone"]]
        if UIDevice.current.userInterfaceIdiom == .phone {
            outputs.append(["deviceId": "receiver", "labelKey": "Phone earpiece"])
        }
        for port in inputs where externalInputTypes.contains(port.portType) {
            outputs.append(["deviceId": "input:" + port.uid, "label": port.portName])
        }
        let outputId: String
        if output?.portType == .builtInSpeaker {
            outputId = "speaker"
        } else if output?.portType == .builtInReceiver {
            outputId = "receiver"
        } else if let port = inputs.first(where: {
            externalInputTypes.contains($0.portType) && ($0.uid == output?.uid || $0.portName == output?.portName)
        }) {
            outputId = "input:" + port.uid
        } else {
            outputId = ""
        }
        return [
            "inputs": inputs.map { ["deviceId": $0.uid, "label": $0.portName] },
            "outputs": outputs,
            "inputId": input?.uid ?? "",
            "inputLabel": input?.portName ?? "",
            "outputFollowsInput": input.map { self.externalInputTypes.contains($0.portType) } ?? false,
            "outputId": outputId
        ]
    }

    private func observeRoutes() {
        knownInputs = Set((AVAudioSession.sharedInstance().availableInputs ?? []).map(\.uid))
        if let routeObserver { NotificationCenter.default.removeObserver(routeObserver) }
        routeObserver = NotificationCenter.default.addObserver(
            forName: AVAudioSession.routeChangeNotification,
            object: nil,
            queue: .main
        ) { [weak self] notification in
            guard let self, self.sessionActive else { return }
            let session = AVAudioSession.sharedInstance()
            let inputs = session.availableInputs ?? []
            let added = inputs.first { !self.knownInputs.contains($0.uid) && self.externalInputTypes.contains($0.portType) }
            let reason = (notification.userInfo?[AVAudioSessionRouteChangeReasonKey] as? NSNumber)?.uintValue
            if reason == AVAudioSession.RouteChangeReason.newDeviceAvailable.rawValue ||
                reason == AVAudioSession.RouteChangeReason.oldDeviceUnavailable.rawValue {
                self.knownInputs = Set(inputs.map(\.uid))
            }
            if reason == AVAudioSession.RouteChangeReason.newDeviceAvailable.rawValue, let added {
                // Clear a previous speaker override before choosing newly connected
                // AirPods. iOS moves both HFP input and output as one route.
                do {
                    try session.overrideOutputAudioPort(.none)
                    try session.setPreferredInput(added)
                } catch {
                    // The system route remains usable if an accessory vanishes mid-change.
                }
            } else if reason == AVAudioSession.RouteChangeReason.oldDeviceUnavailable.rawValue,
                      let preferred = session.preferredInput,
                      !inputs.contains(where: { $0.uid == preferred.uid }) {
                try? session.setPreferredInput(nil)
                try? session.overrideOutputAudioPort(.none)
            }
            self.notifyListeners("audioDevicesChanged", data: self.audioDevices())
        }
    }

    private func describePermission(_ permission: AVAudioSession.RecordPermission) -> String {
        switch permission {
        case .granted: return "granted"
        case .denied: return "denied"
        default: return "undetermined"
        }
    }

    @objc func begin(_ call: CAPPluginCall) {
        DispatchQueue.main.async { self.beginSession(call) }
    }

    private func beginSession(_ call: CAPPluginCall) {
        let session = AVAudioSession.sharedInstance()
        do {
            try session.setCategory(
                .playAndRecord,
                mode: .voiceChat,
                options: [.allowBluetooth, .allowBluetoothA2DP, .defaultToSpeaker]
            )
            try session.setActive(true)
            sessionActive = true
            observeRoutes()
            call.resolve(status())
        } catch {
            sessionActive = false
            call.reject("Could not configure the call audio session: \(error.localizedDescription)")
        }
    }

    @objc func end(_ call: CAPPluginCall) {
        DispatchQueue.main.async { self.endSession(call) }
    }

    private func endSession(_ call: CAPPluginCall) {
        guard sessionActive else {
            call.resolve(status())
            return
        }
        sessionActive = false
        if let routeObserver { NotificationCenter.default.removeObserver(routeObserver) }
        routeObserver = nil
        knownInputs.removeAll()
        let session = AVAudioSession.sharedInstance()
        try? session.setPreferredInput(nil)
        try? session.overrideOutputAudioPort(.none)
        do {
            try session.setActive(false, options: [.notifyOthersOnDeactivation])
        } catch {
            // WebKit may still hold the session for a few ms after the tracks
            // stop; a failed deactivation is harmless, the system reclaims it.
        }
        call.resolve(status())
    }

    @objc func getStatus(_ call: CAPPluginCall) {
        DispatchQueue.main.async { call.resolve(self.status()) }
    }

    @objc func getAudioDevices(_ call: CAPPluginCall) {
        DispatchQueue.main.async { call.resolve(self.audioDevices()) }
    }

    @objc func setInput(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard self.sessionActive, let id = call.getString("deviceId") else {
                call.reject("No active call audio session")
                return
            }
            let session = AVAudioSession.sharedInstance()
            let port = (session.availableInputs ?? []).first { $0.uid == id }
            guard id.isEmpty || port != nil else {
                call.reject("Microphone is no longer available")
                return
            }
            do {
                if let port, self.externalInputTypes.contains(port.portType) {
                    try session.overrideOutputAudioPort(.none)
                }
                try session.setPreferredInput(port)
                call.resolve(self.audioDevices())
            } catch {
                call.reject("Could not select call microphone: \(error.localizedDescription)")
            }
        }
    }

    @objc func setOutput(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard self.sessionActive, let id = call.getString("deviceId") else {
                call.reject("No active call audio session")
                return
            }
            let session = AVAudioSession.sharedInstance()
            do {
                if id == "speaker" || id == "receiver" {
                    guard id != "receiver" || UIDevice.current.userInterfaceIdiom == .phone else {
                        call.reject("This device has no phone earpiece")
                        return
                    }
                    var options: AVAudioSession.CategoryOptions = [.allowBluetooth, .allowBluetoothA2DP]
                    if id == "speaker" { options.insert(.defaultToSpeaker) }
                    try session.setCategory(.playAndRecord, mode: .voiceChat, options: options)
                    let builtin = session.availableInputs?.first { $0.portType == .builtInMic }
                    try session.setPreferredInput(builtin)
                    try session.overrideOutputAudioPort(id == "speaker" ? .speaker : .none)
                } else if id.isEmpty {
                    try session.overrideOutputAudioPort(.none)
                    try session.setPreferredInput(nil)
                } else {
                    guard let port = session.availableInputs?.first(where: { "input:" + $0.uid == id }),
                          self.externalInputTypes.contains(port.portType) else {
                        call.reject("Audio output is no longer available")
                        return
                    }
                    try session.overrideOutputAudioPort(.none)
                    try session.setPreferredInput(port)
                }
                call.resolve(self.audioDevices())
            } catch {
                call.reject("Could not select call audio output: \(error.localizedDescription)")
            }
        }
    }
}
