export const DEFAULT_POST_LOGIN_URL = '/projects/tasks/open'

export const resolveLoginBootstrap = (pathname, search = '') => {
    const isNormalLoginPath = pathname.startsWith('/login') || pathname === '/'

    return {
        initialUrl: isNormalLoginPath ? DEFAULT_POST_LOGIN_URL : pathname + search,
        shouldLoadProjectPreview: !isNormalLoginPath,
    }
}
