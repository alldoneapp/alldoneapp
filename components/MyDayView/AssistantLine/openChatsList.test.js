import { openChatsList } from './openChatsList'
import { DV_TAB_ROOT_CHATS, DV_TAB_ROOT_TASKS } from '../../../utils/TabNavigationConstants'
import { ALL_TAB } from '../../Feeds/Utils/FeedsConstants'

let mockState
const mockDispatch = jest.fn()
const mockNavigate = jest.fn()

jest.mock('../../../redux/store', () => ({
    __esModule: true,
    default: { getState: () => mockState, dispatch: (...args) => mockDispatch(...args) },
}))
jest.mock('../../../redux/actions', () => ({
    hideFloatPopup: () => ({ type: 'hide float popup' }),
    hideWebSideBar: () => ({ type: 'hide sidebar' }),
    setChatsActiveTab: tab => ({ type: 'chats tab', tab }),
    setSelectedSidebarTab: tab => ({ type: 'sidebar tab', tab }),
    setSelectedTypeOfProject: type => ({ type: 'project type', value: type }),
    storeCurrentShortcutUser: user => ({ type: 'shortcut user', user }),
    switchProject: index => ({ type: 'switch project', index }),
}))
jest.mock('../../../utils/NavigationService', () => ({
    __esModule: true,
    default: { navigate: (...args) => mockNavigate(...args) },
}))
jest.mock('../../SettingsView/ProjectsSettings/ProjectHelper', () => ({
    __esModule: true,
    default: { getTypeOfProject: () => 'active' },
}))

describe('openChatsList', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        mockState = { route: DV_TAB_ROOT_TASKS, selectedProjectIndex: 2, loggedUser: {}, smallScreenNavigation: false }
    })

    const dispatched = () => mockDispatch.mock.calls[0][0]

    it('opens the All tab of the Chats list in the project already selected', () => {
        openChatsList({ id: 'p', index: 2 })

        expect(dispatched()).toEqual([
            { type: 'chats tab', tab: ALL_TAB },
            { type: 'sidebar tab', tab: DV_TAB_ROOT_CHATS },
            { type: 'hide float popup' },
        ])
        expect(mockNavigate).not.toHaveBeenCalled()
    })

    it('switches to the line project first when it is not the selected one', () => {
        openChatsList({ id: 'other', index: 5 })

        expect(dispatched()).toEqual(expect.arrayContaining([{ type: 'switch project', index: 5 }]))
    })

    it('stays in All projects for the All projects line', () => {
        mockState.selectedProjectIndex = -1
        openChatsList(null)

        expect(dispatched().some(action => action.type === 'switch project')).toBe(false)
    })

    it('leaves a detail view for the root first, and closes the sidebar on phones', () => {
        mockState.route = 'TaskDetailedView'
        mockState.smallScreenNavigation = true
        openChatsList(null)

        expect(mockNavigate).toHaveBeenCalledWith('Root')
        expect(dispatched()).toEqual(expect.arrayContaining([{ type: 'hide sidebar' }]))
    })
})
