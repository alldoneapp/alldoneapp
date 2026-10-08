import { writeBrowserHistory } from '../browserHistory'
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
 * /admin/skills
 */
export const URL_ADMIN_PANEL_SKILLS = 'URL_ADMIN_PANEL_SKILLS'

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
        let urlPath = URLsAdminPanel.getPath(urlConstant, ...params)

        URLSystem.setLastNavigationScreen(urlPath, true)

        writeBrowserHistory('replace', data, urlPath, () => URLsAdminPanel.setTitle(urlConstant, ...params))
    }

    /**
     * Push a new state into the history url
     * @param urlConstant
     * @param data
     * @param params
     */
    static push = (urlConstant, data = null, ...params) => {
        let urlPath = URLsAdminPanel.getPath(urlConstant, ...params)

        URLSystem.setLastNavigationScreen(urlPath)

        writeBrowserHistory('push', data, urlPath, () => URLsAdminPanel.setTitle(urlConstant, ...params))
    }

    static getPath = (urlConstant, ...params) => {
        switch (urlConstant) {
            case URL_ADMIN_PANEL_USER:
                return `admin/user`
            case URL_ADMIN_PANEL_ASSISTANTS:
                return `admin/assistants`
            case URL_ADMIN_PANEL_SKILLS:
                return `admin/skills`
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
            case URL_ADMIN_PANEL_SKILLS:
                document.title = `Alldone.app - Admin Panel - Skills`
                break
        }
    }
}

export default URLsAdminPanel
