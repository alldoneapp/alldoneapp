import React from 'react'
import { Platform } from 'react-native'
import { useDispatch, useSelector } from 'react-redux'
import renderer from 'react-test-renderer'

import ProjectItem from '../../components/SidebarMenu/ProjectFolding/ProjectItem/ProjectItem'
import { updateShowAllProjectsByTime } from '../../utils/backends/Users/usersFirestore'
import { COLORS_THEME_MODERN } from '../../Themes/Themes'

jest.mock('../../utils/NavigationService')
// The expanded row renders the whole project section subtree - tasks, boards,
// invite people - which reads far more of the store than this suite is about.
jest.mock('../../components/SidebarMenu/ProjectFolding/ProjectSectionList', () => 'ProjectSectionList')
// Selecting a project persists the choice; there is no Firestore here.
jest.mock('../../utils/backends/Users/usersFirestore', () => ({
    updateShowAllProjectsByTime: jest.fn(),
}))
// Something in the row's tree still uses connect(), so keep the real module and
// override only the hooks this suite drives.
jest.mock('react-redux', () => ({
    ...jest.requireActual('react-redux'),
    useDispatch: jest.fn(),
    useSelector: jest.fn(),
}))

// MyPlatform.osType only consults window.navigator off the mobile path,
// and the react-native preset reports ios.
Platform.OS = 'web'

// The component takes the project itself as projectData now, rather than the
// FlatList row shape of { item, index, separators }, and it is a function
// component, so onPress is reached through the rendered row.
const projectData = {
    index: 0,
    id: '-LcRVRo6mhbC0oXCcZ2F',
    color: '#39CCCC',
    name: 'Another one',
    userIds: ['UUKU61Jc7ET8zE5ncN8F61HE19y1'],
}

const dispatch = jest.fn()

const createState = ({ selectedProjectIndex = -1, showShortcuts = false } = {}) => ({
    currentUser: { uid: 'UUKU61Jc7ET8zE5ncN8F61HE19y1' },
    isMiddleScreen: false,
    loggedUser: { themeName: COLORS_THEME_MODERN, uid: 'UUKU61Jc7ET8zE5ncN8F61HE19y1', numberUsersSidebar: 0 },
    selectedProjectIndex,
    shortcutSelectedProjectIndex: -1,
    showShortcuts,
    shownFloatPopup: 0,
    sidebarCollapsed: false,
    sidebarNumbers: { [projectData.id]: {} },
    // The expanded row lists the project's members, so these slices are read too.
    projectUsers: { [projectData.id]: [] },
    projectContacts: { [projectData.id]: [] },
    projectWorkstreams: { [projectData.id]: [] },
    projectAssistants: { [projectData.id]: [] },
})

const render = (state = createState(), props = {}) => {
    useSelector.mockImplementation(selector => selector(state))
    return renderer.create(<ProjectItem itemIndex={0} projectData={projectData} {...props} />)
}

describe('ProjectItem component', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        useDispatch.mockReturnValue(dispatch)
    })

    it('should render correctly', () => {
        expect(render().toJSON()).toMatchSnapshot()
    })

    it('should render correctly when it is the selected project', () => {
        expect(render(createState({ selectedProjectIndex: 0 })).toJSON()).toMatchSnapshot()
    })

    it('should correctly handle navigation with browsing history', () => {
        const navigation = { closeDrawer: jest.fn() }
        const tree = render(createState(), { navigation })

        const [pressable] = tree.root.findAll(node => typeof node.props.onPress === 'function')

        pressable.props.onPress({ preventDefault: () => {} })

        expect(dispatch).toHaveBeenCalled()
        expect(updateShowAllProjectsByTime).toHaveBeenCalled()
    })
})
