import { isAnnaWorkspacePath } from '../../functions/Assistant/annaWorkspaceContract'

// User-facing links can also open the followed activity lists. Keep the
// assistant tool's presentation contract separate from these manual links.
export const isAnnaNavigationPath = path =>
    isAnnaWorkspacePath(path) ||
    (typeof path === 'string' &&
        path.length <= 700 &&
        (/^\/(updates\/followed|projects\/chats\/followed)$/.test(path) ||
            // One chat object (a topic, or a thread whose type is resolved on open, AT-2906).
            /^\/projects\/[a-zA-Z0-9_-]+\/chats\/[a-zA-Z0-9_-]+\/chat$/.test(path) ||
            /^\/projects\/[a-zA-Z0-9_-]+\/user\/[a-zA-Z0-9_-]+\/(updates|chats)\/followed$/.test(path)))

export function resolveAnnaLink(href, origin) {
    try {
        const url = new URL(href, origin)
        if (
            url.origin !== origin &&
            url.origin !== 'https://my.alldone.app' &&
            url.origin !== 'https://anna.alldone.app'
        )
            return null
        return isAnnaNavigationPath(url.pathname) ? url.pathname : null
    } catch (_) {
        return null
    }
}

export function shouldDeferPresentation({ pinned, editing }) {
    return pinned || editing
}
