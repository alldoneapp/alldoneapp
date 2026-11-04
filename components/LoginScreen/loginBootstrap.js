import { readEmbeddedToolWindow } from '../../utils/embeddedToolWindowUrl'

export const DEFAULT_POST_LOGIN_URL = '/projects/tasks/open'

export const resolveLoginBootstrap = (pathname, search = '') => {
    const url = pathname + search
    if (readEmbeddedToolWindow(url)) return { initialUrl: url, shouldLoadProjectPreview: false }
    const isNormalLoginPath = pathname.startsWith('/login') || pathname === '/'

    return {
        initialUrl: isNormalLoginPath ? DEFAULT_POST_LOGIN_URL : url,
        shouldLoadProjectPreview: !isNormalLoginPath,
    }
}
