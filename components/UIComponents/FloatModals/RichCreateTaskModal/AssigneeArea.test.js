/**
 * AT-2464 — the assignee row of the add-task popup must survive a project it cannot resolve.
 *
 * This sits one line above the crash pinned in `AssigneeIcon.test.js` and in the SAME render, so
 * it is the next thing to take the app down through the top-level `ErrorBoundary` once the icon
 * stops doing it. An unresolvable project is not hypothetical here: `RichCreateTaskModal`
 * deliberately keeps a bare `{ id: projectId }` when `loggedUserProjectsMap` has no entry
 * (PT-4745), and the automatic-project option can resolve to no host project at all.
 */

import React from 'react'
import renderer, { act } from 'react-test-renderer'

const mockProjectsById = {}

jest.mock('react-redux', () => ({
    useSelector: () => false,
    useDispatch: () => jest.fn(),
    useStore: () => ({ getState: () => ({}), dispatch: jest.fn(), subscribe: jest.fn() }),
    shallowEqual: (a, b) => a === b,
    batch: fn => fn(),
    // `@hello-pangea/dnd` sits in this module's transitive import graph and calls `connect` at
    // load time, so omitting it fails the suite before a single test runs.
    connect: () => component => component,
    Provider: ({ children }) => children,
}))

jest.mock('../../../SettingsView/ProjectsSettings/ProjectHelper', () => ({
    __esModule: true,
    default: { getProjectById: id => mockProjectsById[id] },
}))

jest.mock('./AssigneeIcon', () => 'AssigneeIcon')
jest.mock('./AssigneeShortcut', () => 'AssigneeShortcut')
jest.mock(
    'react-hot-keys',
    () =>
        ({ children }) =>
            children
)

const AssigneeArea = require('./AssigneeArea').default

const render = projectId => {
    let tree
    act(() => {
        tree = renderer.create(
            <AssigneeArea projectId={projectId} task={{ userId: 'user-me' }} showAssignee={jest.fn()} />
        )
    })
    return tree
}

beforeEach(() => {
    Object.keys(mockProjectsById).forEach(key => delete mockProjectsById[key])
    mockProjectsById['project-a'] = { id: 'project-a', parentTemplateId: null }
    mockProjectsById['guide-1'] = { id: 'guide-1', parentTemplateId: 'template-1' }
})

describe('AssigneeArea (AT-2464)', () => {
    it('does not crash when the project cannot be resolved', () => {
        expect(() => render('project-not-in-map')).not.toThrow()
    })

    it('does not crash when there is no project id at all', () => {
        // `getAutomaticHostProjectId()` can resolve to an empty string.
        expect(() => render('')).not.toThrow()
    })

    it('still treats a guide project as a guide', () => {
        // The guard must not have turned the guide check into a constant `false`: `isGuide`
        // disables the assignee picker, and a guide silently becoming editable is a real change.
        const tree = render('guide-1')
        const touchables = tree.root.findAllByProps({ accessible: false }, { deep: false })
        expect(touchables.some(node => node.props.disabled === true)).toBe(true)
    })

    it('leaves the assignee picker of a normal project enabled', () => {
        const tree = render('project-a')
        const touchables = tree.root.findAllByProps({ accessible: false }, { deep: false })
        expect(touchables.some(node => node.props.disabled === false)).toBe(true)
    })
})
