import URLSystem from '../URLSystem'

/**
 * /admin/user
 */
export const URL_ADMIN_PANEL_USER = 'ADMIN_PANEL_USER'

/**
 * /admin/assistants
 */
export const URL_ADMIN_PANEL_ASSISTANTS = 'URL_ADMIN_PANEL_ASSISTANTS'

/**
 * URL System for Admin Panel
 */
class URLsAdminPanel {
    /**
     * Replace the history url
     * @param urlConstant
     * @param data
     * @param params
     */
    static replace = (urlConstant, data = null, ...params) => {
        const originPath = window.location.origin
        let urlPath = URLsAdminPanel.getPath(urlConstant, ...params)

        URLSystem.setLastNavigationScreen(urlPath, true)

        URLsAdminPanel.setTitle(urlConstant, ...params)
        history.replaceState(data, '', `${originPath}/${urlPath}`)
    }

    /**
     * Push a new state into the history url
     * @param urlConstant
     * @param data
     * @param params
     */
    static push = (urlConstant, data = null, ...params) => {
        const originPath = window.location.origin
        let urlPath = URLsAdminPanel.getPath(urlConstant, ...params)

        URLSystem.setLastNavigationScreen(urlPath)

        URLsAdminPanel.setTitle(urlConstant, ...params)
        history.pushState(data, '', `${originPath}/${urlPath}`)
    }

    static getPath = (urlConstant, ...params) => {
        switch (urlConstant) {
            case URL_ADMIN_PANEL_USER:
                return `admin/user`
            case URL_ADMIN_PANEL_ASSISTANTS:
                return `admin/assistants`
        }
    }

    static setTitle = (urlConstant, ...params) => {
        switch (urlConstant) {
            case URL_ADMIN_PANEL_USER:
                document.title = `Alldone.app - Admin Panel - User`
                break
            case URL_ADMIN_PANEL_ASSISTANTS:
                document.title = `Alldone.app - Admin Panel - Assistants`
                break
        }
    }
}

export default URLsAdminPanel
