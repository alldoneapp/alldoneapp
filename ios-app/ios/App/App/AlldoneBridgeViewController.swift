import Capacitor
import WebKit

final class AlldoneBridgeViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        installMainFrameBridgeFilter()
        bridge?.registerPluginInstance(IosShareExtensionPlugin())
        bridge?.registerPluginInstance(CallAudioSessionPlugin())
    }

    // security audit 2026-11 (NV-33): Capacitor registers its "bridge" script message handler with
    // `WKUserContentController.add(_:name:)`, which WebKit exposes to EVERY frame of the page, and
    // dispatches any message to a plugin without looking at who sent it. An HTML artifact framed
    // inside the app (model- or member-written code) could therefore call native plugins, e.g.
    // IosShareExtension.setCredential to redirect every later share to its own server. The
    // handler is swapped for a filter that forwards only messages from the main frame of the
    // app's own origin. Capacitor's JS runtime is injected into the main frame only, so nothing
    // legitimate is lost.
    private func installMainFrameBridgeFilter() {
        guard let capacitorBridge = bridge as? CapacitorBridge else { return }
        let handler = capacitorBridge.webViewDelegationHandler
        let controller = handler.contentController
        controller.removeScriptMessageHandler(forName: MainFrameBridgeMessageFilter.handlerName)
        controller.add(
            MainFrameBridgeMessageFilter(target: handler, appURL: capacitorBridge.config.serverURL),
            name: MainFrameBridgeMessageFilter.handlerName
        )
    }
}

final class MainFrameBridgeMessageFilter: NSObject, WKScriptMessageHandler {
    static let handlerName = "bridge"

    // Weak: the content controller retains this filter, and the target owns the content controller.
    private weak var target: WKScriptMessageHandler?
    private let appScheme: String
    private let appHost: String
    private let appPort: Int

    init(target: WKScriptMessageHandler, appURL: URL) {
        self.target = target
        self.appScheme = (appURL.scheme ?? "").lowercased()
        self.appHost = (appURL.host ?? "").lowercased()
        self.appPort = appURL.port ?? 0
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        let origin = message.frameInfo.securityOrigin
        guard message.frameInfo.isMainFrame,
              origin.protocol.lowercased() == appScheme,
              origin.host.lowercased() == appHost,
              origin.port == appPort else {
            CAPLog.print("⚡️  Dropped a bridge message from a frame that is not the app's main frame")
            return
        }
        target?.userContentController(userContentController, didReceive: message)
    }
}
