import AVFoundation
import Capacitor
import Foundation

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
        CAPPluginMethod(name: "getStatus", returnType: CAPPluginReturnPromise)
    ]

    private var sessionActive = false

    private func hasBackgroundAudioMode() -> Bool {
        let modes = Bundle.main.object(forInfoDictionaryKey: "UIBackgroundModes") as? [String] ?? []
        return modes.contains("audio")
    }

    private func status() -> [String: Any] {
        let session = AVAudioSession.sharedInstance()
        return [
            "active": sessionActive,
            "backgroundAudio": hasBackgroundAudioMode(),
            "category": session.category.rawValue,
            "mode": session.mode.rawValue,
            "microphonePermission": describePermission(session.recordPermission)
        ]
    }

    private func describePermission(_ permission: AVAudioSession.RecordPermission) -> String {
        switch permission {
        case .granted: return "granted"
        case .denied: return "denied"
        default: return "undetermined"
        }
    }

    @objc func begin(_ call: CAPPluginCall) {
        let session = AVAudioSession.sharedInstance()
        do {
            try session.setCategory(
                .playAndRecord,
                mode: .voiceChat,
                options: [.allowBluetooth, .allowBluetoothA2DP, .defaultToSpeaker]
            )
            try session.setActive(true)
            sessionActive = true
            call.resolve(status())
        } catch {
            sessionActive = false
            call.reject("Could not configure the call audio session: \(error.localizedDescription)")
        }
    }

    @objc func end(_ call: CAPPluginCall) {
        guard sessionActive else {
            call.resolve(status())
            return
        }
        sessionActive = false
        let session = AVAudioSession.sharedInstance()
        do {
            try session.setActive(false, options: [.notifyOthersOnDeactivation])
        } catch {
            // WebKit may still hold the session for a few ms after the tracks
            // stop; a failed deactivation is harmless, the system reclaims it.
        }
        call.resolve(status())
    }

    @objc func getStatus(_ call: CAPPluginCall) {
        call.resolve(status())
    }
}
