const globalState = {}

function setGlobalState(key, value) {
    globalState[key] = value
}

function getGlobalState() {
    return { ...globalState }
}

function loadFeedsGlobalState(admin, appAdmin, feedCreator, project, users, templateCreator) {
    setGlobalState('admin', admin)
    setGlobalState('appAdmin', appAdmin)
    setGlobalState('feedCreator', feedCreator)
    setGlobalState('project', project)
    setGlobalState('users', users)
    setGlobalState('templateCreator', templateCreator)
}

module.exports = { getGlobalState, loadFeedsGlobalState }
