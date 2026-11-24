import { createStore } from 'redux'

const initialState = {
    loggedIn: true,
    loggedUser: {
        uid: 'user-1',
        language: 'en',
        projectIds: ['product', 'client', 'home'],
        guideProjectIds: [],
        archivedProjectIds: [],
        templateProjectIds: [],
        inFocusTaskId: null,
        inFocusTaskProjectId: null,
    },
    currentUser: { uid: 'user-1' },
    loggedUserProjectsMap: {
        product: { id: 'product', name: 'Alldone Product', color: '#4c6ef5' },
        client: { id: 'client', name: 'Client work', color: '#e8590c' },
        home: { id: 'home', name: 'Home & family', color: '#2b8a3e' },
    },
    openTasksMap: {},
    taskPriorityFilters: [],
    smallScreenNavigation: false,
    isMiddleScreen: false,
    showShortcuts: false,
    blockShortcuts: false,
    showFloatPopup: 0,
}

export default createStore((state = initialState, action) => {
    switch (action.type) {
        case 'Set task priority filters':
            return { ...state, taskPriorityFilters: action.priorities }
        case 'Clear task priority filters':
            return { ...state, taskPriorityFilters: [] }
        case 'harness/openTasksMap':
            return { ...state, openTasksMap: action.openTasksMap }
        case 'harness/merge':
            return { ...state, ...action.state }
        default:
            return state
    }
})
