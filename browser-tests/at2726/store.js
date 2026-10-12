// Fixture state and navigation boundary; UI, action creators and gestures stay real.
import { createStore } from 'redux'
import { reduxBatch } from '@manaflair/redux-batch'
import { DV_TAB_ROOT_TASKS } from '../../utils/TabNavigationConstants'

const user = { uid: 'u1', isAnonymous: false, language: 'en', showAllProjectsByTime: false }
const milestone = {
    id: 'm1',
    date: Date.now() + 86400000,
    extendedName: 'Milestone alpha',
    hasStar: '#ffffff',
    assigneesCapacityDates: {},
    done: false,
}
export default createStore(
    (
        state = {
            loggedUser: user,
            currentUser: user,
            projectUsers: { p1: [] },
            loggedUserProjectsMap: { p1: { index: 2, name: 'Product' } },
            openMilestonesByProjectInTasks: { p1: [milestone] },
            goalsByProjectInTasks: { p1: {} },
            showSwipeDueDatePopup: { visible: false, data: null },
            selectedSidebarTab: DV_TAB_ROOT_TASKS,
            selectedProjectIndex: 2,
            route: 'Tasks',
            taskViewToggleIndex: 0,
            smallScreenNavigation: window.innerWidth < 600,
            lastSelectedDueDate: Date.now(),
            showFloatPopup: 0,
            blockShortcuts: false,
            showShortcuts: false,
            navigationCount: 0,
        },
        action
    ) => {
        window.__events?.push({ type: 'action', action: action.type })
        switch (action.type) {
            case 'Show swipe due date popup':
                return { ...state, showSwipeDueDatePopup: { ...state.showSwipeDueDatePopup, visible: true } }
            case 'Hide swipe due date popup':
                return { ...state, showSwipeDueDatePopup: { ...state.showSwipeDueDatePopup, visible: false } }
            case 'Set swipe due date data':
                return { ...state, showSwipeDueDatePopup: { ...state.showSwipeDueDatePopup, data: action.data } }
            case 'Set selected sidebar tab':
                return { ...state, selectedSidebarTab: action.tab, navigationCount: state.navigationCount + 1 }
            case 'Switch project':
                return { ...state, selectedProjectIndex: action.index }
            case 'Set last selected due date':
                return { ...state, lastSelectedDueDate: action.date }
            default:
                return state
        }
    },
    reduxBatch
)
