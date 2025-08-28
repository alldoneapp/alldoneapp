/**
 * /settings/customizations
 */
const URL_CUSTOMIZATIONS = 'SETTINGS_CUSTOMIZATIONS'

/**
 * /settings/projects
 */
const URL_SETTINGS_PROJECTS = 'SETTINGS_PROJECTS'

/**
 * /settings/profile
 */
const URL_SETTINGS_PROFILE = 'SETTINGS_PROFILE'

/**
 * /settings/projects/archived
 */
const URL_SETTINGS_PROJECTS_ARCHIVED = 'SETTINGS_PROJECTS_ARCHIVED'

/**
 * /settings/projects/community
 */
const URL_SETTINGS_PROJECTS_GUIDE = 'SETTINGS_PROJECTS_GUIDE'

/**
 * /settings/projects/following
 */
const URL_SETTINGS_PROJECTS_FOLLOWING = 'SETTINGS_PROJECTS_FOLLOWING'

/**
 * /settings/invitations
 */
const URL_SETTINGS_INVITATIONS = 'SETTINGS_INVITATIONS'

/**
 * /settings/statistics
 */
const URL_SETTINGS_STATISTICS = 'SETTINGS_STATISTICS'

/**
 * /settings/shortcuts
 */
const URL_SETTINGS_SHORTCUTS = 'SETTINGS_SHORTCUTS'

/**
 * /settings/premium
 */
const URL_SETTINGS_PREMIUM = 'SETTINGS_PREMIUM'

/////////////////////////   REGEXP   /////////////////////////

const regexList = {
    [URL_CUSTOMIZATIONS]: new RegExp('^/settings/customizations$'),
    [URL_SETTINGS_PROFILE]: new RegExp('^/settings/profile$'),
    [URL_SETTINGS_PROJECTS]: new RegExp('^/settings/projects$'),
    [URL_SETTINGS_PROJECTS_ARCHIVED]: new RegExp('^/settings/projects/archived$'),
    [URL_SETTINGS_PROJECTS_GUIDE]: new RegExp('^/settings/projects/community$'),
    [URL_SETTINGS_PROJECTS_FOLLOWING]: new RegExp('^/settings/projects/following$'),
    [URL_SETTINGS_INVITATIONS]: new RegExp('^/settings/invitations$'),
    [URL_SETTINGS_STATISTICS]: new RegExp('^/settings/statistics$'),
    [URL_SETTINGS_SHORTCUTS]: new RegExp('^/settings/shortcuts$'),
    [URL_SETTINGS_PREMIUM]: new RegExp('^/settings/premium$'),
}

/////////////////////////   FUNCTIONS   /////////////////////////

const getMetadata = async (admin, urlConstant, params) => {
    const data = { title: '', description: '' }

    switch (urlConstant) {
        case URL_CUSTOMIZATIONS:
            data.title = `Alldone.app - User customizations`
            data.description = 'Alldone.app. User can customize his account'
            break
        case URL_SETTINGS_PROFILE:
            data.title = `Alldone.app - Settings - Profile`
            data.description = 'Alldone.app. User profile.'
            break
        case URL_SETTINGS_PROJECTS:
            data.title = `Alldone.app - Settings - Project list`
            data.description = 'Alldone.app. List of projects that the user is member of.'
            break
        case URL_SETTINGS_PROJECTS_ARCHIVED:
            data.title = `Alldone.app - Settings - Archived Projects`
            data.description = 'Alldone.app. List of archived projects that the user is member of.'
            break
        case URL_SETTINGS_PROJECTS_GUIDE:
            data.title = `Alldone.app - Settings - Communities`
            data.description = 'Alldone.app. List of communities that the user is member of.'
            break
        case URL_SETTINGS_PROJECTS_FOLLOWING:
            data.title = `Alldone.app - Settings - Following Projects`
            data.description = 'Alldone.app. List of projects that the user is following.'
            break
        case URL_SETTINGS_INVITATIONS:
            data.title = `Alldone.app - Settings - Invitations`
            data.description = 'Alldone.app. List of invitations to a projects pending to respond.'
            break
        case URL_SETTINGS_STATISTICS:
            data.title = `Alldone.app - Settings - Statistics`
            data.description = 'Alldone.app. User statistics of Alldone usage.'
            break
        case URL_SETTINGS_SHORTCUTS:
            data.title = `Alldone.app - Settings - Shortcuts`
            data.description = 'Alldone.app. List of Shortcuts in the Alldone app.'
            break
        case URL_SETTINGS_PREMIUM:
            data.title = `Alldone.app - Settings - Premium`
            data.description =
                'Alldone.app. Here the user can upgrade his plan, and start using Alldone without limits.'
            break
    }

    return data
}

module.exports = {
    URL_CUSTOMIZATIONS,
    URL_SETTINGS_PROFILE,
    URL_SETTINGS_PROJECTS,
    URL_SETTINGS_PROJECTS_ARCHIVED,
    URL_SETTINGS_PROJECTS_GUIDE,
    URL_SETTINGS_PROJECTS_FOLLOWING,
    URL_SETTINGS_INVITATIONS,
    URL_SETTINGS_STATISTICS,
    URL_SETTINGS_SHORTCUTS,
    URL_SETTINGS_PREMIUM,
    regexList,
    getMetadata,
}
