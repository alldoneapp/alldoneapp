import { sanitizeAnnaPaneContext } from '../../functions/Assistant/annaPaneContext'
import { vmJobPath } from './useAnnaVmJobs'

const appName = view => view.appName || view.serverLabel || view.toolName || 'App'
const hostOf = url => {
    try {
        return new URL(url).hostname
    } catch (_) {
        return ''
    }
}
const originOf = url => {
    try {
        return new URL(url).origin
    } catch (_) {
        return ''
    }
}

/**
 * AT-2955: what the assistant shell's work pane shows right now, as it is published to the Anna chat
 * (`annaPageContext`) and handed to voice calls. Before this, everything that was not an Alldone page
 * collapsed to `{ path: '/', title: 'Anna' }`, so the assistant answered about the hidden page behind
 * an app or a VM. `path` and `title` stay meaningful on their own for older readers: an app or a VM
 * gets its own title, never the hidden Alldone page's.
 *
 * `appState` is what the app itself reported (untrusted; see utils/annaAppModelContext.js).
 */
export function buildAnnaPaneContext({
    active,
    visibleWorkspace,
    surface,
    page,
    selectedVm,
    selectedAppView,
    appState = null,
    vmCount = 0,
}) {
    if (!active) return page ? sanitizeAnnaPaneContext({ ...page, surface: 'alldone' }) : null
    if (!visibleWorkspace) return sanitizeAnnaPaneContext({ path: '/', title: 'Anna', surface: 'none' })
    if (selectedAppView) {
        const iframe = selectedAppView.kind === 'iframe'
        return sanitizeAnnaPaneContext({
            path: '/',
            title: appName(selectedAppView),
            surface: 'app',
            app: {
                kind: iframe ? 'iframe' : 'mcp',
                name: appName(selectedAppView),
                serverId: iframe ? undefined : selectedAppView.serverId,
                serverLabel: iframe ? undefined : selectedAppView.serverLabel,
                toolName: iframe ? undefined : selectedAppView.toolName,
                serverHost: iframe ? undefined : hostOf(selectedAppView.serverUrl),
                origin: iframe ? originOf(selectedAppView.url) : undefined,
                state: appState,
            },
        })
    }
    if (selectedVm)
        return sanitizeAnnaPaneContext({
            path: vmJobPath(selectedVm),
            title: selectedVm.title,
            surface: 'vm',
            vm: { ...selectedVm, runId: selectedVm.runId },
        })
    if (surface === 'vms' || surface.startsWith('vm:'))
        return sanitizeAnnaPaneContext({ path: '/', title: 'VMs', surface: 'vms', vmCount })
    if (surface === 'browser')
        // The browsed page's own title is third-party text; the browser tools read it when needed.
        return sanitizeAnnaPaneContext({ path: '/', title: 'Browser', surface: 'browser' })
    return page ? sanitizeAnnaPaneContext({ ...page, surface: 'alldone' }) : null
}
