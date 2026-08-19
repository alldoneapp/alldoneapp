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

export const getContactPresentationData = (contact, projectPrivacy) =>
    projectPrivacy ? { ...contact, ...projectPrivacy } : contact
