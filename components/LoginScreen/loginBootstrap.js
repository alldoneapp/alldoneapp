import { readEmbeddedToolWindow } from '../../utils/embeddedToolWindowUrl'
import { resolveAppAuthReturnUrl } from '../AppAuth/appAuthState'

export const DEFAULT_POST_LOGIN_URL = '/projects/tasks/open'

export const resolveLoginBootstrap = (pathname, search = '', appAuthReturnUrl = resolveAppAuthReturnUrl(pathname)) => {
    const url = pathname + search
    if (readEmbeddedToolWindow(url)) return { initialUrl: url, shouldLoadProjectPreview: false }
    const isNormalLoginPath = pathname.startsWith('/login') || pathname === '/'

    return {
        // A Google redirect login started on Anna's /app-auth comes back to /login: send it back there.
        initialUrl: isNormalLoginPath ? appAuthReturnUrl || DEFAULT_POST_LOGIN_URL : url,
        shouldLoadProjectPreview: !isNormalLoginPath,
    }
}
