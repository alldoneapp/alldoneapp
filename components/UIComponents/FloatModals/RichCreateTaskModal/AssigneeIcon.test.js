/**
 * AT-2464 — "click add task, get the pop-up, then switch projects, sometimes the app crashes".
 *
 * The crash was `TypeError: Cannot destructure property 'photoURL' of 'r' as it is undefined` in
 * this component, and it took the ENTIRE APP down: a throw during render escapes to the top-level
 * `ErrorBoundary` in `App.js`, which swaps every screen for `ErrorBoundaryPage`.
 *
 * The trigger is the popup's own project switcher. It changes `projectId` without remounting, so
 * this avatar re-resolves its person against the new project — whose people are loaded ON DEMAND
 * since AT-2386. That is the whole of "sometimes": a project visited earlier in the session already
 * has its users in redux and renders fine; any other one resolves to `undefined` and threw.
 *
 * These tests therefore drive the REAL lookup helpers against a REAL redux store. Stubbing the
 * lookup to return a user cannot express this defect at all — the defect IS the miss.
 */

import React from 'react'
import { createStore } from 'redux'
import { Provider } from 'react-redux'
import renderer, { act } from 'react-test-renderer'

const mockRequestProjectDataOnLookupMiss = jest.fn()

// The real loader arms live Firestore watchers. Its CONTRACT is what matters here: a lookup miss
// asks for the project's data, and the avatar fills in when it lands (driven explicitly below).
jest.mock('../../../../utils/InitialLoad/projectDataLoader', () => ({
    requestProjectDataOnLookupMiss: (...args) => mockRequestProjectDataOnLookupMiss(...args),
    ensureProjectDataLoaded: jest.fn(() => Promise.resolve(true)),
    PROJECT_DATA_USERS: 'users',
    PROJECT_DATA_CONTACTS: 'contacts',
    PROJECT_DATA_WORKSTREAMS: 'workstreams',
    PROJECT_DATA_ASSISTANTS: 'assistants',
}))

const initialState = {
    projectUsers: {},
    projectContacts: {},
    projectWorkstreams: {},
    projectAssistants: {},
    globalAssistants: [],
    loggedUserProjectsMap: { 'project-a': { id: 'project-a', index: 0 }, 'project-b': { id: 'project-b', index: 1 } },
}

const reducer = (state = initialState, action) => (action.type === 'SET' ? { ...state, ...action.payload } : state)

let mockStore = createStore(reducer)

jest.mock('../../../../redux/store', () => ({
    __esModule: true,
    default: {
        getState: () => mockStore.getState(),
        dispatch: (...args) => mockStore.dispatch(...args),
        subscribe: (...args) => mockStore.subscribe(...args),
    },
}))

const AssigneeIcon = require('./AssigneeIcon').default
// The real prefix, not a literal: a test that guesses it silently exercises the person branch
// instead of the workstream one and asserts nothing about workstreams at all.
const { WORKSTREAM_ID_PREFIX } = require('../../../Workstreams/WorkstreamConstants')

const ME = 'user-me'
const PHOTO = 'https://example.com/me.png'

const setPeople = payload => act(() => void mockStore.dispatch({ type: 'SET', payload }))

const render = props => {
    let tree
    act(() => {
        tree = renderer.create(
            <Provider store={mockStore}>
                <AssigneeIcon {...props} />
            </Provider>
        )
    })
    return tree
}

// react-native-web renders `Image` down to a real `<img>`, so this asserts on what the user would
// actually see rather than on the props we passed in.
const avatarUri = tree => {
    const images = tree.root.findAllByType('img')
    return images.length ? images[0].props.src : null
}

const hasGenericAvatar = tree => tree.root.findAllByProps({ svgid: 'ci_p_rich_assignee_project-b' }).length > 0

beforeEach(() => {
    mockStore = createStore(reducer)
    mockRequestProjectDataOnLookupMiss.mockClear()
})

describe('AssigneeIcon (AT-2464)', () => {
    it('does not crash when the switched-to project has no people loaded yet', () => {
        // Exactly the reported state: the popup opened on project-a (loaded), the user picked
        // project-b in the switcher, and project-b's users have not been fetched. Before the fix
        // this threw "Cannot destructure property 'photoURL' of 'undefined'" during render, which
        // the app-level ErrorBoundary turned into a full-screen crash.
        setPeople({ projectUsers: { 'project-a': [{ uid: ME, photoURL: PHOTO }], 'project-b': [] } })

        expect(() => render({ projectId: 'project-b', userId: ME })).not.toThrow()
    })

    it('renders the generic avatar - not a broken image - while the people are missing', () => {
        setPeople({ projectUsers: { 'project-b': [] } })

        const tree = render({ projectId: 'project-b', userId: ME })

        expect(hasGenericAvatar(tree)).toBe(true)
        expect(avatarUri(tree)).toBeNull()
    })

    it('asks the on-demand loader for the project it could not resolve', () => {
        // Without this the avatar would be generic forever: nothing else in the popup requests
        // the switched-to project's people.
        setPeople({ projectUsers: { 'project-b': [] } })

        render({ projectId: 'project-b', userId: ME })

        expect(mockRequestProjectDataOnLookupMiss).toHaveBeenCalledWith('project-b', expect.anything())
    })

    it('fills the real photo in silently once the project people land', () => {
        // The second half of the AT-2386 contract, and the reason this component subscribes at all:
        // the lookups read the store directly, so a fix that only stopped the crash would leave a
        // permanently generic avatar for every switched-to project.
        setPeople({ projectUsers: { 'project-b': [] } })
        const tree = render({ projectId: 'project-b', userId: ME })
        expect(hasGenericAvatar(tree)).toBe(true)

        setPeople({ projectUsers: { 'project-b': [{ uid: ME, photoURL: PHOTO }] } })

        expect(avatarUri(tree)).toBe(PHOTO)
        expect(hasGenericAvatar(tree)).toBe(false)
    })

    it('resolves an assignee who is a project CONTACT rather than a member', () => {
        setPeople({
            projectUsers: { 'project-b': [] },
            projectContacts: { 'project-b': [{ uid: ME, photoURL: PHOTO }] },
        })

        expect(avatarUri(render({ projectId: 'project-b', userId: ME }))).toBe(PHOTO)
    })

    it('does not crash on a workstream assignee whose project is not loaded', () => {
        // Same defect, other branch: `getWorkstreamById` returns null on a miss, and destructuring
        // null throws just as hard as destructuring undefined.
        setPeople({ projectWorkstreams: { 'project-b': [] } })

        let tree
        expect(() => {
            tree = render({ projectId: 'project-b', userId: `${WORKSTREAM_ID_PREFIX}stream-1` })
        }).not.toThrow()
        expect(tree.root.findAllByProps({ name: 'workstream' }).length).toBeGreaterThan(0)
    })

    it('does not crash on a draft that has no assignee at all', () => {
        // `userId.startsWith(...)` is reached before either lookup, so an absent assignee crashed
        // the app by the same route.
        expect(() => render({ projectId: 'project-b', userId: undefined })).not.toThrow()
    })
})
