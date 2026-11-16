import React from 'react'
import renderer, { act } from 'react-test-renderer'

import useCollapsibleTaskSection from './useCollapsibleTaskSection'
import { clearSectionExpansionRequestsForTests } from './collapsibleTaskSection'
import { dismissAllPopups } from '../../../utils/HelperFunctions'

let mockState
const mockDispatch = jest.fn()

jest.mock('react-redux', () => ({
    useSelector: selector => selector(mockState),
    useDispatch: () => mockDispatch,
}))
jest.mock('../../../redux/actions', () => ({
    hideFloatPopup: () => ({ type: 'hideFloatPopup' }),
    hideWebSideBar: () => ({ type: 'hideWebSideBar' }),
    setSelectedSidebarTab: tab => ({ type: 'setSelectedSidebarTab', tab }),
    setSelectedTypeOfProject: projectType => ({ type: 'setSelectedTypeOfProject', projectType }),
    switchProject: index => ({ type: 'switchProject', index }),
}))
jest.mock('../../../redux/store', () => ({ getState: () => mockState }))
jest.mock('../../SettingsView/ProjectsSettings/ProjectHelper', () => ({
    __esModule: true,
    default: { getTypeOfProject: () => 'active' },
    checkIfSelectedProject: index => index > -1,
}))
jest.mock('../../../utils/HelperFunctions', () => ({ dismissAllPopups: jest.fn() }))
jest.mock('../../../utils/TabNavigationConstants', () => ({ DV_TAB_ROOT_TASKS: 'tasks-root' }))

const ALL_PROJECTS = -1

let results
function Probe(props) {
    results[props.sectionKey] = useCollapsibleTaskSection(props)
    return null
}

const renderProbes = (probes, tree) => {
    const element = (
        <>
            {probes.map(props => (
                <Probe key={props.sectionKey} projectId="project-1" projectIndex={2} {...props} />
            ))}
        </>
    )
    act(() => {
        if (tree) tree.update(element)
        else tree = renderer.create(element)
    })
    return tree
}

// AT-3027 - expand / collapse state of the Messages and Calendar sections.
describe('useCollapsibleTaskSection', () => {
    beforeEach(() => {
        jest.useFakeTimers()
        results = {}
        mockState = { selectedProjectIndex: 2, smallScreenNavigation: false, currentUser: { uid: 'user-1' } }
        mockDispatch.mockClear()
        dismissAllPopups.mockClear()
        clearSectionExpansionRequestsForTests()
    })

    afterEach(() => {
        jest.useRealTimers()
    })

    it('starts collapsed and toggles in place inside a project', () => {
        renderProbes([{ dateKey: 'TODAY', sectionKey: 'messages' }])
        expect(results.messages.expanded).toBe(false)

        act(() => results.messages.expand())
        expect(results.messages.expanded).toBe(true)

        act(() => results.messages.contract())
        expect(results.messages.expanded).toBe(false)
        expect(mockDispatch).not.toHaveBeenCalled()
    })

    it('keeps Messages and Calendar independent', () => {
        renderProbes([
            { dateKey: 'TODAY', sectionKey: 'messages' },
            { dateKey: 'TODAY', sectionKey: 'calendar' },
        ])

        act(() => results.calendar.expand())

        expect(results.calendar.expanded).toBe(true)
        expect(results.messages.expanded).toBe(false)
    })

    it('does not carry an expansion over to another day', () => {
        const tree = renderProbes([{ dateKey: 'TODAY', sectionKey: 'messages' }])
        act(() => results.messages.expand())

        renderProbes([{ dateKey: 'TOMORROW', sectionKey: 'messages' }], tree)

        expect(results.messages.expanded).toBe(false)
    })

    it('jumps into the project from All projects and arrives with the pressed section expanded', () => {
        mockState.selectedProjectIndex = ALL_PROJECTS
        const tree = renderProbes([
            { dateKey: 'TODAY', sectionKey: 'messages' },
            { dateKey: 'TODAY', sectionKey: 'calendar' },
        ])

        act(() => results.messages.expand())
        expect(results.messages.expanded).toBe(false)
        act(() => jest.runAllTimers())

        expect(dismissAllPopups).toHaveBeenCalledWith(true, true, true)
        expect(mockDispatch).toHaveBeenCalledWith([
            { type: 'hideFloatPopup' },
            { type: 'setSelectedSidebarTab', tab: 'tasks-root' },
            { type: 'switchProject', index: 2 },
            { type: 'setSelectedTypeOfProject', projectType: 'active' },
        ])

        // The reducer switched the project; the same sections now render inside it.
        mockState.selectedProjectIndex = 2
        renderProbes(
            [
                { dateKey: 'TODAY', sectionKey: 'messages' },
                { dateKey: 'TODAY', sectionKey: 'calendar' },
            ],
            tree
        )

        expect(results.messages.expanded).toBe(true)
        expect(results.calendar.expanded).toBe(false)
    })

    it('arrives expanded when the project board mounts fresh sections', () => {
        mockState.selectedProjectIndex = ALL_PROJECTS
        const allProjectsTree = renderProbes([{ dateKey: 'TODAY', sectionKey: 'calendar' }])
        act(() => results.calendar.expand())
        act(() => jest.runAllTimers())
        act(() => allProjectsTree.unmount())

        mockState.selectedProjectIndex = 2
        renderProbes([{ dateKey: 'TODAY', sectionKey: 'calendar' }])

        expect(results.calendar.expanded).toBe(true)
    })

    it('also closes the sidebar on small screens', () => {
        mockState.selectedProjectIndex = ALL_PROJECTS
        mockState.smallScreenNavigation = true
        renderProbes([{ dateKey: 'TODAY', sectionKey: 'messages' }])

        act(() => results.messages.expand())
        act(() => jest.runAllTimers())

        expect(mockDispatch.mock.calls[0][0]).toContainEqual({ type: 'hideWebSideBar' })
    })
})
