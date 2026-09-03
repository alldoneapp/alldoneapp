import Capacitor

final class AlldoneBridgeViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(IosShareExtensionPlugin())
        bridge?.registerPluginInstance(CallAudioSessionPlugin())
    }
}
