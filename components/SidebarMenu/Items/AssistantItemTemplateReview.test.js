import React from 'react'
import renderer from 'react-test-renderer'

const mockDispatch = jest.fn()
let mockState
let mockExpanded = true

jest.mock('react-redux', () => ({
    useDispatch: () => mockDispatch,
    useSelector: selector => selector(mockState),
}))
jest.mock('../../../redux/store', () => ({ getState: () => mockState }))
jest.mock('../../../redux/actions', () => ({
    hideWebSideBar: () => ({ type: 'hide sidebar' }),
    setSelectedSidebarTab: tab => ({ type: 'set sidebar tab', tab }),
    setSelectedTypeOfProject: projectType => ({ type: 'set project type', projectType }),
    setTaskViewToggleIndex: index => ({ type: 'set task view index', index }),
    setTaskViewToggleSection: section => ({ type: 'set task view section', section }),
    storeCurrentShortcutUser: user => ({ type: 'store shortcut user', user }),
    storeCurrentUser: user => ({ type: 'store current user', user }),
    setSelectedNavItem: item => ({ type: 'set nav item', item }),
}))
jest.mock('../../../utils/NavigationService', () => ({ navigate: jest.fn() }))
jest.mock('../Themes', () => ({
    getUserItemTheme: () => ({ container: () => ({}), containerActive: () => ({}) }),
}))
jest.mock('../Collapsible/UseCollapsibleSidebar', () => () => ({ expanded: mockExpanded }))
jest.mock('../../../hooks/UseOnHover', () => () => ({ hover: false, onHover: jest.fn(), offHover: jest.fn() }))
jest.mock('./Common/AssistantData', () => 'AssistantData')
// assistantsHelper transitively drags in ProjectsSettings -> react-native-gesture-handler,
// which cannot initialise under jsdom; only the constant is needed here.
jest.mock('../../AdminPanel/Assistants/assistantsHelper', () => ({ GLOBAL_PROJECT_ID: 'globalProject' }))
jest.mock('../../../utils/backends/Assistants/assistantsFirestore', () => ({
    setAssistantLastVisitedBoardDate: jest.fn(),
}))
// Only `translate` is stubbed: the module is also pulled in transitively for
// `getDeviceLanguage` (utils/SharedHelper), and replacing it wholesale breaks the
// import chain before this component is even reached.
jest.mock('../../../i18n/TranslationService', () => ({
    ...jest.requireActual('../../../i18n/TranslationService'),
    translate: key => key,
}))

const AssistantItem = require('./AssistantItem').default

const LINKED = 'template-1'

const renderItem = assistant => {
    const tree = renderer.create(
        <AssistantItem
            assistant={assistant}
            projectType="normal"
            projectId="project-1"
            projectColor="#FF5274"
            isShared={false}
            navItem="tasks"
        />
    )
    return tree.root
}

const icons = root => root.findAllByProps({ name: 'alert-circle' }, { deep: true })
const cpuIcons = root => root.findAllByProps({ name: 'cpu' }, { deep: true })

describe('sidebar assistant template review marker (AT-2358)', () => {
    beforeEach(() => {
        mockExpanded = true
        mockState = {
            loggedUser: { themeName: 'dark' },
            currentUser: { uid: 'other' },
            shortcutCurrentUserUid: null,
            route: 'tasks',
            smallScreenNavigation: false,
            globalAssistants: [],
            selectedNavItem: 'tasks',
        }
    })

    it('marks an assistant with pending template reviews instead of the type icon', () => {
        const root = renderItem({
            uid: 'assistant-1',
            displayName: 'Anna Alldone',
            copiedFromTemplateAssistantId: LINKED,
            templateSyncConflicts: [{ field: 'instructions' }, { field: 'model' }],
        })

        expect(icons(root)).toHaveLength(1)
        // The decorative cpu icon gives up the single right-hand slot.
        expect(cpuIcons(root)).toHaveLength(0)
        expect(icons(root)[0].props.accessibilityLabel).toBe('2 template changes need review')
    })

    it('keeps the plain type icon when nothing is pending', () => {
        const root = renderItem({
            uid: 'assistant-1',
            displayName: 'Anna Alldone',
            copiedFromTemplateAssistantId: LINKED,
            templateSyncConflicts: [],
        })

        expect(icons(root)).toHaveLength(0)
        expect(cpuIcons(root)).toHaveLength(1)
    })

    it('uses the singular label for a single pending review', () => {
        const root = renderItem({
            uid: 'assistant-1',
            displayName: 'Anna Alldone',
            copiedFromTemplateAssistantId: LINKED,
            templateSyncConflicts: [{ field: 'model' }],
        })

        expect(icons(root)[0].props.accessibilityLabel).toBe('1 template change needs review')
    })

    it('falls back to a compact dot in the 56px collapsed sidebar', () => {
        mockExpanded = false
        const root = renderItem({
            uid: 'assistant-1',
            displayName: 'Anna Alldone',
            copiedFromTemplateAssistantId: LINKED,
            templateSyncConflicts: [{ field: 'model' }],
        })

        // No 20px icon, which would overflow the collapsed width.
        expect(icons(root)).toHaveLength(0)
        const dots = root.findAllByProps({ accessibilityLabel: '1 template change needs review' }, { deep: true })
        expect(dots.length).toBeGreaterThan(0)
    })

    it('shows nothing for an assistant that is not linked to a template', () => {
        mockExpanded = false
        const root = renderItem({ uid: 'assistant-1', displayName: 'Local assistant' })

        expect(icons(root)).toHaveLength(0)
        expect(cpuIcons(root)).toHaveLength(0)
    })
})
