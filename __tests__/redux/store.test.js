import {
    activateSearchForm,
    deactivateSearchForm,
    hideAddProjectOptions,
    hideConfirmPopup,
    hideFloatPopup,
    hideProjectColorPicker,
    hideSwipeDueDatePopup,
    LogOut,
    overrideStore,
    setAddProjectOptionsLayout,
    setAmountTasksByProjects,
    setCurrentProjectColor,
    setDismissibleComponent,
    setProjectColorPickerLayout,
    setSearchText,
    setSelectedNavItem,
    setSubTaskSection,
    setSwipeDueDatePopupData,
    setTaskViewToggleIndex,
    showAddProjectOptions,
    showConfirmPopup,
    showFloatPopup,
    showProjectColorPicker,
    showSwipeDueDatePopup,
    storeCurrentUser,
    storeLoggedUser,
    switchProject,
    toggleDismissibleActive,
    toggleNavPicker,
    toggleSmallScreen,
    toggleSmallScreenNavigation,
    setSelectedTypeOfProject,
    setProjectInvitationData,
    hideProjectInvitation,
    showProjectInvitation,
} from '../../redux/actions'
import theStore, { initialState, resetCircularStructures, theReducer } from '../../redux/store'
import { PROJECT_TYPE_ARCHIVED } from '../../components/SettingsView/ProjectsSettings/ProjectsSettings'

describe('Redux Reducers', () => {
    it('should return the initial state', () => {
        const state = theReducer(undefined, {})
        expect(state).toEqual(initialState)
    })

    it('should log out', () => {
        const state = theReducer({ ...initialState, loggedIn: true, registeredNewUser: true }, LogOut())
        const newState = { ...initialState, loggedIn: false }
        expect(state).toEqual(newState)
    })

    it('should switch projects', () => {
        const state = theReducer(undefined, switchProject(0))
        const newState = { ...initialState, selectedProjectIndex: 0 }
        expect(state).toEqual(newState)
    })

    it('should store the selected type of project', () => {
        const state = theReducer(undefined, setSelectedTypeOfProject(PROJECT_TYPE_ARCHIVED))
        const newState = { ...initialState, selectedTypeOfProject: PROJECT_TYPE_ARCHIVED }
        expect(state).toEqual(newState)
    })

    it('should store logged user', () => {
        const state = theReducer(undefined, storeLoggedUser({ uid: 'user-1' }))

        expect(state.loggedUser.uid).toEqual('user-1')
    })

    it('should store current user', () => {
        const state = theReducer(undefined, storeCurrentUser({ uid: 'user-1' }))

        expect(state.currentUser.uid).toEqual('user-1')
    })

    it('should set selected nav item', () => {
        const state = theReducer(undefined, setSelectedNavItem(0))
        const newState = { ...initialState, selectedNavItem: 0 }
        expect(state).toEqual(newState)
    })

    it('should toggle nav picker', () => {
        const state = theReducer(undefined, toggleNavPicker(true))
        const newState = { ...initialState, expandedNavPicker: true }
        expect(state).toEqual(newState)
    })

    it('should set small screen flag', () => {
        const state = theReducer(undefined, toggleSmallScreen(true))
        const newState = { ...initialState, smallScreen: true }
        expect(state).toEqual(newState)
    })

    it('should set small screen navigation flag', () => {
        const state = theReducer(undefined, toggleSmallScreenNavigation(true))
        const newState = { ...initialState, smallScreenNavigation: true }
        expect(state).toEqual(newState)
    })

    it('should show project color picker', () => {
        const state = theReducer(undefined, showProjectColorPicker())
        const newState = {
            ...initialState,
            showProjectColorPicker: {
                visible: true,
                layout: { x: 0, y: 0, width: 0, height: 0 },
            },
        }
        expect(state).toEqual(newState)
    })

    it('should hide project color picker', () => {
        const state = theReducer(undefined, hideProjectColorPicker())
        const newState = {
            ...initialState,
            showProjectColorPicker: {
                visible: false,
                layout: { x: 0, y: 0, width: 0, height: 0 },
            },
        }
        expect(state).toEqual(newState)
    })

    it('should set current project color', () => {
        const state = theReducer(undefined, setCurrentProjectColor(''))
        const newState = { ...initialState, currentProjectColor: '' }
        expect(state).toEqual(newState)
    })

    it('should show add project options', () => {
        const state = theReducer(undefined, showAddProjectOptions())
        const newState = {
            ...initialState,
            showAddProjectOptions: {
                visible: true,
                layout: { x: 0, y: 0, width: 0, height: 112 },
            },
        }
        expect(state).toEqual(newState)
    })

    it('should hide add project options', () => {
        const state = theReducer(undefined, hideAddProjectOptions())
        const newState = {
            ...initialState,
            showAddProjectOptions: {
                visible: false,
                layout: { x: 0, y: 0, width: 0, height: 112 },
            },
        }
        expect(state).toEqual(newState)
    })

    it('should toggle dismissible active', () => {
        const state = theReducer(undefined, toggleDismissibleActive(false))
        const newState = { ...initialState, dismissibleActive: false }
        expect(state).toEqual(newState)
    })

    it('should set dismissible component', () => {
        const state = theReducer(undefined, setDismissibleComponent({}))
        const newState = { ...initialState, dismissibleComponent: {} }
        expect(state).toEqual(newState)
    })

    it('should override store', () => {
        const state = theReducer(undefined, overrideStore({}))
        const newState = {}
        expect(state).toEqual(newState)
    })

    it('should set project color picker layout', () => {
        const state = theReducer(undefined, setProjectColorPickerLayout({}))
        const newState = {
            ...initialState,
            showProjectColorPicker: { visible: false, layout: {} },
        }
        expect(state).toEqual(newState)
    })

    it('should set add project options layout', () => {
        const state = theReducer(undefined, setAddProjectOptionsLayout({}))
        const newState = {
            ...initialState,
            showAddProjectOptions: { visible: false, layout: {} },
        }
        expect(state).toEqual(newState)
    })

    it('should show confirm popup action', () => {
        const state = theReducer(undefined, showConfirmPopup({ trigger: 'delete_task', object: {} }))

        expect(state.showConfirmPopupData.visible).toEqual(true)
        expect(state.showConfirmPopupData.trigger).toEqual('delete_task')
    })

    it('should hide confirm popup action', () => {
        const state = theReducer(undefined, hideConfirmPopup())

        expect(state.showConfirmPopupData.visible).toEqual(false)
        expect(state.showConfirmPopupData.trigger).toEqual(null)
    })

    it('should show project invitation popup action', () => {
        const state = theReducer(undefined, showProjectInvitation())
        const newState = {
            ...initialState,
            showProjectInvitationPopup: { visible: true, data: { project: null, user: null } },
        }
        expect(state).toEqual(newState)
    })

    it('should hide project invitation popup action', () => {
        const state = theReducer(undefined, hideProjectInvitation())
        const newState = {
            ...initialState,
            showProjectInvitationPopup: { visible: false, data: { project: null, user: null } },
        }
        expect(state).toEqual(newState)
    })

    it('should set project invitation data', () => {
        const state = theReducer(undefined, setProjectInvitationData({}))
        const newState = {
            ...initialState,
            showProjectInvitationPopup: { visible: false, data: {} },
        }
        expect(state).toEqual(newState)
    })

    it('should show swipe due date popup action', () => {
        const state = theReducer(undefined, showSwipeDueDatePopup())
        const newState = {
            ...initialState,
            showSwipeDueDatePopup: { visible: true, data: { projectId: null, task: null } },
        }
        expect(state).toEqual(newState)
    })

    it('should hide swipe due date popup action', () => {
        const state = theReducer(undefined, hideSwipeDueDatePopup())
        const newState = {
            ...initialState,
            showSwipeDueDatePopup: { visible: false, data: { projectId: null, task: null } },
        }
        expect(state).toEqual(newState)
    })

    it('should set swipe due date popup data action', () => {
        const state = theReducer(undefined, setSwipeDueDatePopupData({}))
        const newState = {
            ...initialState,
            showSwipeDueDatePopup: { visible: false, data: {} },
        }
        expect(state).toEqual(newState)
    })

    it('should show float popup', () => {
        const state = theReducer(undefined, showFloatPopup())

        expect(state.showFloatPopup).toEqual(1)
    })

    it('should hide float popup', () => {
        const state = theReducer(undefined, hideFloatPopup())
        const newState = {
            ...initialState,
            showFloatPopup: 0,
        }
        expect(state).toEqual(newState)
    })

    it('should set the dueDate', () => {
        const state = theReducer(undefined, setSubTaskSection('-Asd'))
        const newState = { ...initialState, subTaskSection: '-Asd' }
        expect(state).toEqual(newState)
    })

    it('should set the task view toggle index', () => {
        const state = theReducer(undefined, setTaskViewToggleIndex(1))
        const newState = { ...initialState, taskViewToggleIndex: 1 }
        expect(state).toEqual(newState)
    })

    it('should set the amount tasks by projects', () => {
        const state = theReducer(undefined, setAmountTasksByProjects([{ open: 0, pending: 1, done: 2 }]))
        const newState = { ...initialState, amountTasksByProjects: [{ open: 0, pending: 1, done: 2 }] }
        expect(state).toEqual(newState)
    })

    it('should activate the search form', () => {
        const state = theReducer(undefined, activateSearchForm())
        const newState = { ...initialState, activeSearchForm: true }
        expect(state).toEqual(newState)
    })

    it('should deactivate the search form', () => {
        const state = theReducer(undefined, deactivateSearchForm())
        const newState = { ...initialState, activeSearchForm: false }
        expect(state).toEqual(newState)
    })

    it('should set search text', () => {
        const state = theReducer(undefined, setSearchText('testing'))
        const newState = { ...initialState, searchText: 'testing' }
        expect(state).toEqual(newState)
    })
})
