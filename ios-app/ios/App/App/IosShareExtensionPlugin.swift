import Capacitor
import Foundation

private enum IosShareExtensionStorage {
    static let appGroup = "group.app.alldone.ios"
    static let installationId = "iosShare.installationId"
    static let userId = "iosShare.userId"
    static let token = "iosShare.token"
    static let endpointUrl = "iosShare.endpointUrl"
}

@objc(IosShareExtensionPlugin)
final class IosShareExtensionPlugin: CAPInstancePlugin, CAPBridgedPlugin {
    let identifier = "IosShareExtensionPlugin"
    let jsName = "IosShareExtension"
    let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getCredential", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setCredential", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clearCredential", returnType: CAPPluginReturnPromise)
    ]

    private func sharedDefaults() -> UserDefaults? {
        UserDefaults(suiteName: IosShareExtensionStorage.appGroup)
    }

    private func ensureInstallationId(in defaults: UserDefaults) -> String {
        if let value = defaults.string(forKey: IosShareExtensionStorage.installationId), !value.isEmpty {
            return value
        }
        let value = UUID().uuidString
        defaults.set(value, forKey: IosShareExtensionStorage.installationId)
        return value
    }

    @objc func getCredential(_ call: CAPPluginCall) {
        guard let defaults = sharedDefaults() else {
            call.reject("The Alldone App Group is unavailable")
            return
        }
        call.resolve([
            "installationId": ensureInstallationId(in: defaults),
            "userId": defaults.string(forKey: IosShareExtensionStorage.userId) ?? "",
            "token": defaults.string(forKey: IosShareExtensionStorage.token) ?? "",
            "endpointUrl": defaults.string(forKey: IosShareExtensionStorage.endpointUrl) ?? ""
        ])
    }

    @objc func setCredential(_ call: CAPPluginCall) {
        guard let defaults = sharedDefaults(),
              let userId = call.getString("userId"), !userId.isEmpty,
              let token = call.getString("token"), !token.isEmpty,
              let endpointUrl = call.getString("endpointUrl"), !endpointUrl.isEmpty else {
            call.reject("The iOS share credential is incomplete")
            return
        }

        _ = ensureInstallationId(in: defaults)
        defaults.set(userId, forKey: IosShareExtensionStorage.userId)
        defaults.set(token, forKey: IosShareExtensionStorage.token)
        defaults.set(endpointUrl, forKey: IosShareExtensionStorage.endpointUrl)
        call.resolve()
    }

    @objc func clearCredential(_ call: CAPPluginCall) {
        guard let defaults = sharedDefaults() else {
            call.resolve()
            return
        }
        defaults.removeObject(forKey: IosShareExtensionStorage.userId)
        defaults.removeObject(forKey: IosShareExtensionStorage.token)
        defaults.removeObject(forKey: IosShareExtensionStorage.endpointUrl)
        call.resolve()
    }
}
