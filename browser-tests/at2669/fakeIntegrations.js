// Browser-only fixture boundaries. The component, hooks, cadence lookup,
// Firestore subscription adapter, translations and RN web rendering stay real.
export function runHttpsCallableFunction() {
    return new Promise(resolve => {
        window.__finishHealth = resolve
    })
}

export function getDb() {
    return {
        collection: () => ({
            where: () => ({
                onSnapshot: next => {
                    const emit = configs =>
                        next({
                            forEach: callback =>
                                Object.entries(configs).forEach(([id, data]) => callback({ id, data: () => data })),
                        })
                    window.__setConfigs = emit
                    emit(window.__configs)
                    return () => {
                        window.__unsubscribed = true
                    }
                },
            }),
        }),
    }
}

export const URL_SETTINGS_INTEGRATIONS = 'SETTINGS_INTEGRATIONS'
export default {
    getPath: () => 'settings/integrations',
    processURLSettingsTab: (navigation, tab) => {
        window.__settingsTab = tab
    },
}
