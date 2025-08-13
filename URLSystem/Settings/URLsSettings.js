import URLSystem from '../URLSystem'

/**
 * /settings/customizations
 */
export const URL_CUSTOMIZATIONS = 'SETTINGS_CUSTOMIZATIONS'

/**
 * /settings/profile
 */
export const URL_SETTINGS_PROFILE = 'SETTINGS_PROFILE'

/**
 * /settings/projects
 */
export const URL_SETTINGS_PROJECTS = 'SETTINGS_PROJECTS'

/**
 * /settings/projects/archived
 */
export const URL_SETTINGS_PROJECTS_ARCHIVED = 'SETTINGS_PROJECTS_ARCHIVED'

/**
 * /settings/projects/community
 */
export const URL_SETTINGS_PROJECTS_GUIDE = 'SETTINGS_PROJECTS_GUIDE'

/**
 * /settings/projects/following
 */
export const URL_SETTINGS_PROJECTS_FOLLOWING = 'SETTINGS_PROJECTS_FOLLOWING'

/**
 * /settings/invitations
 */
export const URL_SETTINGS_INVITATIONS = 'SETTINGS_INVITATIONS'

/**
 * /settings/statistics
 */
export const URL_SETTINGS_STATISTICS = 'SETTINGS_STATISTICS'

/**
 * /settings/shortcuts
 */
export const URL_SETTINGS_SHORTCUTS = 'SETTINGS_SHORTCUTS'

/**
 * /settings/premium
 */
export const URL_SETTINGS_PREMIUM = 'SETTINGS_PREMIUM'

/**
 * /settings/export
 */
export const URL_SETTINGS_EXPORT = 'SETTINGS_EXPORT'

/**
 * URL System for Settings
 */
class URLsSettings {
    /**
     * Replace the history url
     * @param urlConstant
     * @param data
     * @param params
     */
    static replace = (urlConstant, data = null, ...params) => {
        const originPath = window.location.origin
        let urlPath = URLsSettings.getPath(urlConstant, ...params)

        URLSystem.setLastNavigationScreen(urlPath, true)

        URLsSettings.setTitle(urlConstant, ...params)
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
        let urlPath = URLsSettings.getPath(urlConstant, ...params)

        URLSystem.setLastNavigationScreen(urlPath)

        URLsSettings.setTitle(urlConstant, ...params)
        history.pushState(data, '', `${originPath}/${urlPath}`)
    }

    static getPath = (urlConstant, ...params) => {
        switch (urlConstant) {
            case URL_CUSTOMIZATIONS:
                return `settings/customizations`
            case URL_SETTINGS_PROFILE:
                return `settings/profile`
            case URL_SETTINGS_PROJECTS:
                return `settings/projects`
            case URL_SETTINGS_PROJECTS_ARCHIVED:
                return `settings/projects/archived`
            case URL_SETTINGS_PROJECTS_GUIDE:
                return `settings/projects/community`
            case URL_SETTINGS_PROJECTS_FOLLOWING:
                return `settings/projects/following`
            case URL_SETTINGS_INVITATIONS:
                return `settings/invitations`
            case URL_SETTINGS_STATISTICS:
                return `settings/statistics`
            case URL_SETTINGS_SHORTCUTS:
                return `settings/shortcuts`
            case URL_SETTINGS_PREMIUM:
                return `settings/premium`
            case URL_SETTINGS_EXPORT:
                return `settings/export`
        }
    }

    static setTitle = (urlConstant, ...params) => {
        switch (urlConstant) {
            case URL_CUSTOMIZATIONS:
                document.title = `Alldone.app - User customizations`
                break
            case URL_SETTINGS_PROFILE:
                document.title = `Alldone.app - Settings - Profile`
                break
            case URL_SETTINGS_PROJECTS:
                document.title = `Alldone.app - Settings - Project list`
                break
            case URL_SETTINGS_PROJECTS_ARCHIVED:
                document.title = `Alldone.app - Settings - Archived Projects`
                break
            case URL_SETTINGS_PROJECTS_GUIDE:
                document.title = `Alldone.app - Settings - Communities`
                break
            case URL_SETTINGS_PROJECTS_FOLLOWING:
                document.title = `Alldone.app - Settings - Following Projects`
                break
            case URL_SETTINGS_INVITATIONS:
                document.title = `Alldone.app - Settings - Invitations`
                break
            case URL_SETTINGS_STATISTICS:
                document.title = `Alldone.app - Settings - Statistics`
                break
            case URL_SETTINGS_SHORTCUTS:
                document.title = `Alldone.app - Settings - Shortcuts`
                break
            case URL_SETTINGS_PREMIUM:
                document.title = `Alldone.app - Settings - Premium`
                break
            case URL_SETTINGS_EXPORT:
                document.title = `Alldone.app - Settings - Export`
                break
        }
    }
}

export default URLsSettings
