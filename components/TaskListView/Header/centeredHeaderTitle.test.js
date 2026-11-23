/**
 * @jest-environment jsdom
 */

import React from 'react'
import renderer, { act } from 'react-test-renderer'
import { StyleSheet } from 'react-native'
import { useSelector } from 'react-redux'

import { isSelectedProjectHeader, shouldCenterProjectHeaderTitle } from './centeredHeaderTitle'
import AllProjectsLine from './AllProjectsLine/AllProjectsLine'
import ProjectHeader from './ProjectHeader'

jest.mock('react-redux', () => ({ useDispatch: () => jest.fn(), useSelector: jest.fn() }))
jest.mock('../../../redux/store', () => ({ getState: () => ({ loggedUserProjectsMap: {} }) }))
jest.mock('../../../redux/actions', () => ({ setSelectedNavItem: jest.fn(() => ({ type: 'noop' })) }))
jest.mock('../../../utils/NavigationService', () => ({ navigate: jest.fn() }))
jest.mock('./ProjectAndUserData', () => 'ProjectAndUserData')
jest.mock('./TagsArea', () => 'TagsArea')
jest.mock('./ProjectPostponeSwipe', () => props => props.children)
jest.mock('../../RootView/RootSectionNavigation', () => 'RootSectionNavigation')
jest.mock('./AllProjectsLine/AllProjectData', () => 'AllProjectData')
jest.mock('../../Avatar', () => 'Avatar')
jest.mock('../../UIComponents/FloatModals/MorePopupsOfMainViews/Tasks/TaskHeaderMoreButton', () => 'More')
jest.mock('../ToggleByTime', () => 'ToggleByTime')

/**
 * AT-3132: the top header line centres "All projects" / the selected project on the WHOLE line. The
 * actions on the right are mirrored by a spacer of the same measured width on the left, so the
 * title area between them is symmetric and centring inside it centres on the full line.
 */

// The host node carrying the style (the spacer component passes its testID down to it).
const byTestID = (tree, testID) =>
    tree.root.findAll(node => node.props.testID === testID && node.props.style !== undefined, { deep: false })
const style = node => StyleSheet.flatten(node.props.style)

const layout = width => ({ nativeEvent: { layout: { width, height: 32, x: 0, y: 0 } } })

const mockState = state => useSelector.mockImplementation(selector => selector(state))

describe('isSelectedProjectHeader', () => {
    it('is true only for the line of the selected project', () => {
        expect(isSelectedProjectHeader(2, 2)).toBe(true)
        expect(isSelectedProjectHeader(0, 0)).toBe(true)
        expect(isSelectedProjectHeader(2, 3)).toBe(false)
    })

    it('is false for every per-project line of an All projects list', () => {
        // ALL_PROJECTS_INDEX is -1.
        expect(isSelectedProjectHeader(-1, -1)).toBe(false)
        expect(isSelectedProjectHeader(-1, 0)).toBe(false)
        expect(isSelectedProjectHeader(undefined, undefined)).toBe(false)
        expect(isSelectedProjectHeader(null, 0)).toBe(false)
    })
})

describe('shouldCenterProjectHeaderTitle', () => {
    it('centres the selected project line on mobile sizes only', () => {
        expect(shouldCenterProjectHeaderTitle(true, 2, 2)).toBe(true)
        expect(shouldCenterProjectHeaderTitle(false, 2, 2)).toBe(false)
        expect(shouldCenterProjectHeaderTitle(undefined, 2, 2)).toBe(false)
    })

    it('never centres a per-project line, on mobile either', () => {
        expect(shouldCenterProjectHeaderTitle(true, -1, 0)).toBe(false)
        expect(shouldCenterProjectHeaderTitle(true, 2, 3)).toBe(false)
    })
})

describe('AllProjectsLine centres its title block on mobile (AT-3132)', () => {
    beforeEach(() => {
        mockState({
            loggedUser: { uid: 'user-1', photoURL: '', sidebarNavigationMode: 'simple' },
            taskViewToggleSection: 'Open',
            smallScreenNavigation: true,
        })
    })

    it('centres the avatar, title and grouping toggle as one block', () => {
        const tree = renderer.create(<AllProjectsLine />)
        const title = byTestID(tree, 'all-projects-line-title')[0]

        expect(style(title).justifyContent).toBe('center')
        expect(style(title).flex).toBe(1)
        expect(style(title).minWidth).toBe(0)
        expect(title.findAllByType('Avatar')).toHaveLength(1)
        expect(title.findAllByType('AllProjectData')).toHaveLength(1)
        expect(title.findAllByType('ToggleByTime')).toHaveLength(1)
    })

    it('keeps "by project" left aligned under the title inside the centred block', () => {
        const tree = renderer.create(<AllProjectsLine />)
        // The nearest styled ancestor of the title: the title + grouping column.
        let column = tree.root.findByType('AllProjectData').parent
        while (column && !(column.props.style && style(column).flexDirection)) column = column.parent
        expect(column.findAllByType('ToggleByTime')).toHaveLength(1)
        expect(style(column).flexDirection).toBe('column')
        expect(style(column).alignItems).toBe('flex-start')
    })

    it('mirrors the measured width of the actions on the left', () => {
        const tree = renderer.create(<AllProjectsLine />)
        const mirror = () => byTestID(tree, 'all-projects-line-mirror')[0]
        const actions = byTestID(tree, 'all-projects-line-actions')[0]

        expect(style(mirror()).width).toBe(0)
        expect(actions.findAllByType('More')).toHaveLength(1)

        act(() => actions.props.onLayout(layout(41.4)))
        expect(style(mirror()).width).toBe(42)
        expect(style(mirror()).flexShrink).toBe(0)
        expect(mirror().props.pointerEvents).toBe('none')

        // The actions keep their room: the title gives way to them (AT-2263).
        expect(style(actions).flexShrink).toBe(0)
    })

    it('mirrors nothing when the line has no actions', () => {
        const tree = renderer.create(<AllProjectsLine showActions={false} />)
        const actions = byTestID(tree, 'all-projects-line-actions')[0]

        act(() => actions.props.onLayout(layout(0)))
        expect(style(byTestID(tree, 'all-projects-line-mirror')[0]).width).toBe(0)
        expect(tree.root.findAllByType('More')).toHaveLength(0)
    })
})

describe('ProjectHeader centres only the selected project line on mobile (AT-3132)', () => {
    const state = (selectedProjectIndex, mobile = true) => ({
        currentUser: { uid: 'u1' },
        loggedUser: { uid: 'u1' },
        selectedSidebarTab: 'tasks',
        smallScreenNavigation: mobile,
        smallScreenNavSidebarCollapsed: mobile,
        loggedUserProjectsMap: {},
        selectedProjectIndex,
    })

    it('centres the selected project and mirrors its actions', () => {
        mockState(state(3))
        const customRight = React.createElement('CustomRight')
        const tree = renderer.create(
            <ProjectHeader projectIndex={3} projectId="p3" showTaskMore customRight={customRight} />
        )

        expect(tree.root.findByType('ProjectAndUserData').props.centered).toBe(true)

        const actions = byTestID(tree, 'project-line-actions')[0]
        expect(actions.findAllByType('TagsArea')).toHaveLength(1)
        expect(actions.findByType('TagsArea').props.showTaskMore).toBe(true)
        expect(actions.findAllByType('CustomRight')).toHaveLength(1)
        expect(style(actions).flexShrink).toBe(0)

        act(() => actions.props.onLayout(layout(38)))
        expect(style(byTestID(tree, 'project-line-mirror')[0]).width).toBe(38)
    })

    it('keeps the per-project lines of All projects left aligned and unchanged', () => {
        mockState(state(-1))
        const tree = renderer.create(<ProjectHeader projectIndex={3} projectId="p3" showTaskMore />)

        expect(tree.root.findByType('ProjectAndUserData').props.centered).toBe(false)
        expect(byTestID(tree, 'project-line-mirror')).toHaveLength(0)
        expect(byTestID(tree, 'project-line-actions')).toHaveLength(0)
        expect(tree.root.findAllByType('TagsArea')).toHaveLength(1)
    })

    it('keeps the selected project left aligned on desktop, without a spacer', () => {
        mockState(state(3, false))
        const tree = renderer.create(<ProjectHeader projectIndex={3} projectId="p3" showTaskMore />)

        expect(tree.root.findByType('ProjectAndUserData').props.centered).toBe(false)
        expect(byTestID(tree, 'project-line-mirror')).toHaveLength(0)
        expect(byTestID(tree, 'project-line-actions')).toHaveLength(0)
        expect(tree.root.findByType('TagsArea').props.showTaskMore).toBe(true)
    })

    it('does not centre a line of another project', () => {
        mockState(state(1))
        const tree = renderer.create(<ProjectHeader projectIndex={3} projectId="p3" />)

        expect(tree.root.findByType('ProjectAndUserData').props.centered).toBe(false)
        expect(byTestID(tree, 'project-line-mirror')).toHaveLength(0)
    })
})

describe('AllProjectsLine stays left aligned on desktop (AT-3132)', () => {
    beforeEach(() => {
        mockState({
            loggedUser: { uid: 'user-1', photoURL: '', sidebarNavigationMode: 'simple' },
            taskViewToggleSection: 'Open',
            smallScreenNavigation: false,
        })
    })

    it('does not centre the title block and adds no spacer', () => {
        const tree = renderer.create(<AllProjectsLine />)
        const title = byTestID(tree, 'all-projects-line-title')[0]

        expect(style(title).justifyContent).toBeUndefined()
        expect(style(title).flex).toBe(1)
        expect(byTestID(tree, 'all-projects-line-mirror')).toHaveLength(0)
        expect(title.findAllByType('Avatar')).toHaveLength(1)
        expect(title.findAllByType('AllProjectData')).toHaveLength(1)
        expect(title.findAllByType('ToggleByTime')).toHaveLength(1)
    })

    it('keeps the actions on the right, unmeasured', () => {
        const tree = renderer.create(<AllProjectsLine />)
        const actions = byTestID(tree, 'all-projects-line-actions')[0]

        expect(actions.props.onLayout).toBeUndefined()
        expect(actions.findAllByType('More')).toHaveLength(1)
        expect(style(actions).flexShrink).toBe(0)
    })
})
