export const getContactItemStoreUpdate = (currentState, storeState) => {
    const update = {}

    if (currentState.loggedUserProjects !== storeState.loggedUserProjects) {
        update.loggedUserProjects = storeState.loggedUserProjects
    }
    if (currentState.smallScreenNavigation !== storeState.smallScreenNavigation) {
        update.smallScreenNavigation = storeState.smallScreenNavigation
    }
    if (currentState.isMiddleScreen !== storeState.isMiddleScreen) {
        update.isMiddleScreen = storeState.isMiddleScreen
    }

    return Object.keys(update).length > 0 ? update : null
}

export const getContactBacklinksWatcherKey = (projectId, contactId, instanceId) =>
    `contact:${projectId}:${contactId}:${instanceId}`

export const CONTACT_INFO_PREVIEW_MAX_LENGTH = 320

export const getContactInfoPreview = value => {
    if (typeof value !== 'string' || value.length <= CONTACT_INFO_PREVIEW_MAX_LENGTH) return value
    return `${value.slice(0, CONTACT_INFO_PREVIEW_MAX_LENGTH - 1).trimEnd()}…`
}

export const getContactPresentationData = (contact, projectPrivacy) =>
    projectPrivacy ? { ...contact, ...projectPrivacy } : contact
