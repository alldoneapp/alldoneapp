import {
    activateSearchForm,
    deactivateSearchForm,
    hideAddProjectOptions,
    hideConfirmPopup,
    hideFloatPopup,
    hideProjectColorPicker,
    hideSideMenuUser,
    hideSwipeDueDatePopup,
    LogIn,
    LogOut,
    overrideStore,
    setAddProjectOptionsLayout,
    setAmountTasksByProjects,
    setConfirmPopupAction,
    setCurrentProjectColor,
    setDismissibleComponent,
    setDueDate,
    setOnline,
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
    showSideMenuUser,
    showSwipeDueDatePopup,
    startStoreUpdate,
    storeCurrentUser,
    storeLoggedUser,
    storeLoggedUserProjects,
    storeSelectedProjectUsers,
    switchProject,
    toggleDismissibleActive,
    toggleNavPicker,
    toggleSmallScreen,
    toggleSmallScreenNavigation,
    setSelectedTypeOfProject,
    showProjectInvitation,
    hideProjectInvitation,
    setProjectInvitationData,
    showMessagePopup,
    hideMessagePopup,
    setMessagePopupAction,
    setProjectsContacts,
} from '../../redux/actions'
import { PROJECT_TYPE_ARCHIVED } from '../../components/SettingsView/ProjectsSettings/ProjectsSettings'

jest.mock('firebase', () => ({ firestore: {} }));

describe('Redux Actions', () => {
    it('should create an action to log in', () => {
        const expectedAction = {
            type: 'Log in',
        }
        expect(LogIn()).toEqual(expectedAction)
    })

    it('should create an action to log out', () => {
        const expectedAction = {
            type: 'Log out',
        }
        expect(LogOut()).toEqual(expectedAction)
    })

    it('should create an action to switch projects', () => {
        const expectedAction = {
            type: 'Switch project',
            index: 5,
        }
        expect(switchProject(5)).toEqual(expectedAction)
    })

    it('should create an action to store the users of a project', () => {
        const expectedAction = {
            type: 'Store project users',
            users: [],
        }
        expect(storeSelectedProjectUsers([])).toEqual(expectedAction)
    })

    it('should create an action to store the selected type of project', () => {
        const expectedAction = {
            type: 'Set selected type of project',
            selectedTypeOfProject: PROJECT_TYPE_ARCHIVED,
        }
        expect(setSelectedTypeOfProject(PROJECT_TYPE_ARCHIVED)).toEqual(expectedAction)
    })

    it('should create an action to store the projects of the logged user', () => {
        const expectedAction = {
            type: 'Store logged user projects',
            projects: [],
        }
        expect(storeLoggedUserProjects([])).toEqual(expectedAction)
    })

    it('should create an action to store the logged user', () => {
        const expectedAction = {
            type: 'Store logged user',
            user: {},
        }
        expect(storeLoggedUser({})).toEqual(expectedAction)
    })

    it('should create an action to store the current user', () => {
        const expectedAction = {
            type: 'Store current user',
            user: {},
        }
        expect(storeCurrentUser({})).toEqual(expectedAction)
    })

    it('should create an action to hide the logged user from the side menu', () => {
        const expectedAction = {
            type: 'Hide side menu user',
        }
        expect(hideSideMenuUser()).toEqual(expectedAction)
    })

    it('should create an action to show the logged user from the side menu', () => {
        const expectedAction = {
            type: 'Show side menu user',
        }
        expect(showSideMenuUser()).toEqual(expectedAction)
    })

    it('should create an action to set the selected navigation bar item', () => {
        const expectedAction = {
            type: 'Set selected nav item',
            navItem: 0,
        }
        expect(setSelectedNavItem(0)).toEqual(expectedAction)
    })

    it('should create an action to toggle the navigation bar picker', () => {
        const expectedAction = {
            type: 'Toggle nav picker',
            expanded: true,
        }
        expect(toggleNavPicker(true)).toEqual(expectedAction)
    })

    it('should create an action to toggle a small screen flag', () => {
        const expectedAction = {
            type: 'Toggle small screen',
            smallScreen: false,
        }
        expect(toggleSmallScreen(false)).toEqual(expectedAction)
    })

    it('should create an action to toggle a small screen navigation flag', () => {
        const expectedAction = {
            type: 'Toggle small screen navigation',
            smallScreenNavigation: false,
        }
        expect(toggleSmallScreenNavigation(false)).toEqual(expectedAction)
    })

    it('should create an action to show the project color picker', () => {
        const expectedAction = {
            type: 'Show project color picker',
        }
        expect(showProjectColorPicker()).toEqual(expectedAction)
    })

    it('should create an action to hide the project color picker', () => {
        const expectedAction = {
            type: 'Hide project color picker',
        }
        expect(hideProjectColorPicker()).toEqual(expectedAction)
    })

    it('should create an action to set the current project color', () => {
        const expectedAction = {
            type: 'Set current project color',
            newColor: '',
        }
        expect(setCurrentProjectColor('')).toEqual(expectedAction)
    })

    it('should create an action to toggle the active status of the dismissible', () => {
        const expectedAction = {
            type: 'Toggle dismissible active',
            dismissibleActive: true,
        }
        expect(toggleDismissibleActive(true)).toEqual(expectedAction)
    })

    it('should create an action to set the dismissible component', () => {
        const expectedAction = {
            type: 'Set dismissible component',
            dismissibleComponent: {},
        }
        expect(setDismissibleComponent({})).toEqual(expectedAction)
    })

    it('should create an action to show the add project options', () => {
        const expectedAction = {
            type: 'Show add project options',
        }
        expect(showAddProjectOptions()).toEqual(expectedAction)
    })

    it('should create an action to hide the add project options', () => {
        const expectedAction = {
            type: 'Hide add project options',
        }
        expect(hideAddProjectOptions()).toEqual(expectedAction)
    })

    it('should create an action to override the store with a new one', () => {
        const expectedAction = {
            type: 'Override store',
            store: {},
        }
        expect(overrideStore({})).toEqual(expectedAction)
    })

    it('should create an action to set the value of the online status flag', () => {
        const expectedAction = {
            type: 'Set online',
            status: false,
        }
        expect(setOnline(false)).toEqual(expectedAction)
    })

    it('should create an action to set the store update flag', () => {
        const expectedAction = {
            type: 'Start store update',
        }
        expect(startStoreUpdate()).toEqual(expectedAction)
    })

    it('should create an action to set the project color picker layout', () => {
        const expectedAction = {
            type: 'Set project color picker layout',
        }
        expect(setProjectColorPickerLayout()).toEqual(expectedAction)
    })

    it('should create an action to set the add project options layout', () => {
        const expectedAction = {
            type: 'Set add project options layout',
        }
        expect(setAddProjectOptionsLayout()).toEqual(expectedAction)
    })

    it('should create an action to show the confirm popup', () => {
        const expectedAction = {
            type: 'Show confirm popup',
        }
        expect(showConfirmPopup()).toEqual(expectedAction)
    })

    it('should create an action to hide the confirm popup', () => {
        const expectedAction = {
            type: 'Hide confirm popup',
        }
        expect(hideConfirmPopup()).toEqual(expectedAction)
    })

    it('should create an action to set the confirm popup action', () => {
        const expectedAction = {
            type: 'Set confirm popup action',
        }
        expect(setConfirmPopupAction()).toEqual(expectedAction)
    })

    it('should create an action to show the message popup', () => {
        const expectedAction = {
            type: 'Show message popup',
        }
        expect(showMessagePopup()).toEqual(expectedAction)
    })

    it('should create an action to hide the message popup', () => {
        const expectedAction = {
            type: 'Hide message popup',
        }
        expect(hideMessagePopup()).toEqual(expectedAction)
    })

    it('should create an action to set the message popup action', () => {
        const expectedAction = {
            type: 'Set message popup action',
        }
        expect(setMessagePopupAction()).toEqual(expectedAction)
    })

    it('should create an action to show the project invitation popup', () => {
        const expectedAction = {
            type: 'Show project invitation popup',
        }
        expect(showProjectInvitation()).toEqual(expectedAction)
    })

    it('should create an action to hide the project invitation popup', () => {
        const expectedAction = {
            type: 'Hide project invitation popup',
        }
        expect(hideProjectInvitation()).toEqual(expectedAction)
    })

    it('should create an action to set the project invitation data', () => {
        const expectedAction = {
            type: 'Set project invitation data',
        }
        expect(setProjectInvitationData()).toEqual(expectedAction)
    })

    it('should create an action to show the swipe due date popup', () => {
        const expectedAction = {
            type: 'Show swipe due date popup',
        }
        expect(showSwipeDueDatePopup()).toEqual(expectedAction)
    })

    it('should create an action to hide the swipe due date popup', () => {
        const expectedAction = {
            type: 'Hide swipe due date popup',
        }
        expect(hideSwipeDueDatePopup()).toEqual(expectedAction)
    })

    it('should create an action to set the swipe due date popup data', () => {
        const expectedAction = {
            type: 'Set swipe due date data',
        }
        expect(setSwipeDueDatePopupData()).toEqual(expectedAction)
    })

    it('should create an action to show the float popup', () => {
        const expectedAction = {
            type: 'Show float popup',
        }
        expect(showFloatPopup()).toEqual(expectedAction)
    })

    it('should create an action to hide the float popup', () => {
        const expectedAction = {
            type: 'Hide float popup',
        }
        expect(hideFloatPopup()).toEqual(expectedAction)
    })

    it('should create an action to set the dueDate', () => {
        const expectedAction = {
            type: 'Set dueDate',
            dueDate: 1579410000000,
        }
        expect(setDueDate(1579410000000)).toEqual(expectedAction)
    })

    it('should create an action to set sub task section', () => {
        const expectedAction = {
            type: 'Set sub task section',
            subTaskSection: '-Asd',
        }
        expect(setSubTaskSection('-Asd')).toEqual(expectedAction)
    })

    it('should create an action to set projects contacts', () => {
        const expectedAction = {
            type: 'Set projects contacts',
            contacts: [],
        }
        expect(setProjectsContacts([])).toEqual(expectedAction)
    })

    it('should create an action to set task view toggle index', () => {
        const expectedAction = {
            type: 'Set task view toggle index',
            taskViewToggleIndex: 1,
        }
        expect(setTaskViewToggleIndex(1)).toEqual(expectedAction)
    })

    it('should create an action to set amount tasks by projects', () => {
        const expectedAction = {
            type: 'Set amount tasks by projects',
            amountTasksByProjects: [],
        }
        expect(setAmountTasksByProjects([])).toEqual(expectedAction)
    })

    it('should activate the search form', () => {
        const expectedAction = {
            type: 'Activate search form',
        }
        expect(activateSearchForm()).toEqual(expectedAction)
    })

    it('should deactivate the search form', () => {
        const expectedAction = {
            type: 'Deactivate search form',
        }
        expect(deactivateSearchForm()).toEqual(expectedAction)
    })

    it('should set search text', () => {
        const expectedAction = {
            type: 'Set search text',
            searchText: 'testing',
        }
        expect(setSearchText('testing')).toEqual(expectedAction)
    })
})
