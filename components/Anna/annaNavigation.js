import { isAnnaWorkspacePath } from '../../functions/Assistant/annaWorkspaceContract'

export function resolveAnnaLink(href, origin) {
    try {
        const url = new URL(href, origin)
        if (
            url.origin !== origin &&
            url.origin !== 'https://my.alldone.app' &&
            url.origin !== 'https://anna.alldone.app'
        )
            return null
        return isAnnaWorkspacePath(url.pathname) ? url.pathname : null
    } catch (_) {
        return null
    }
}

export function shouldDeferPresentation({ pinned, editing }) {
    return pinned || editing
}
