/**
 * @jest-environment jsdom
 */

import React from 'react'
import renderer, { act } from 'react-test-renderer'
import { Provider } from 'react-redux'
import { createStore } from 'redux'
import { findAssistantAuthor } from '../../../utils/backends/Assistants/assistantAuthorLookup'
import { watchUserData } from '../../../utils/backends/firestore'
import useGetUserPresentationData from './useGetUserPresentationData'

let mockUser
let mockStore
const mockGetPresentation = jest.fn()
jest.mock('../../../utils/backends/Assistants/assistantAuthorLookup', () => ({ findAssistantAuthor: jest.fn() }))
jest.mock('../../../utils/backends/firestore', () => ({
    watchUserData: jest.fn(),
    unwatch: jest.fn(),
}))

jest.mock('./ContactsHelper', () => ({
    getUnknownUserData: () => ({ displayName: 'Unknown user', isUnknownUser: true }),
    getUserPresentationData: id => mockGetPresentation(id),
    getAssistantPresentationData: assistant => ({ ...assistant, isAssistant: true }),
}))

const Profile = ({ userId, fromAssistant }) => {
    const user = useGetUserPresentationData(userId, { fromAssistant })
    return <span>{user.displayName}</span>
}

const renderProfile = props => {
    mockStore = createStore((state, action) => (action.type === 'replace' ? action.state : state), {
        loggedUser: mockUser,
        loggedUserProjectsMap: { private: {}, team: {} },
        projectAssistants: {},
        globalAssistants: [],
    })
    return renderer.create(
        <Provider store={mockStore}>
            <Profile {...props} />
        </Provider>
    )
}

beforeEach(() => {
    findAssistantAuthor.mockResolvedValue(null)
})

describe('shared-view user presentation', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        mockGetPresentation.mockReturnValue({ displayName: 'Unknown user', isUnknownUser: true })
    })

    it('does not watch private user profiles for anonymous chat messages', () => {
        mockUser = { uid: 'shared-viewer', isAnonymous: true }

        let tree
        act(() => {
            tree = renderProfile({ userId: 'private-message-author' })
        })

        expect(tree.root.findByType('span').children).toEqual(['Unknown user'])
        expect(watchUserData).not.toHaveBeenCalled()
        expect(findAssistantAuthor).not.toHaveBeenCalled()
        act(() => tree.unmount())
    })

    it('keeps the profile watcher for authenticated users', () => {
        mockUser = { uid: 'member', isAnonymous: false }

        let tree
        act(() => {
            tree = renderProfile({ userId: 'other-member' })
        })

        expect(watchUserData).toHaveBeenCalledWith('other-member', false, expect.any(Function), expect.any(String))
        act(() => tree.unmount())
    })
})

it('uses the cached author on the very first render before effects run', () => {
    jest.clearAllMocks()
    mockUser = { uid: 'member', isAnonymous: false }
    mockGetPresentation.mockReturnValue({ displayName: 'Karsten', isUnknownUser: false })
    const renders = []
    const Author = () => {
        renders.push(useGetUserPresentationData('member').displayName)
        return null
    }
    let tree
    act(() => {
        mockStore = createStore(() => ({ loggedUser: mockUser }))
        tree = renderer.create(
            <Provider store={mockStore}>
                <Author />
            </Provider>
        )
    })
    expect(renders[0]).toBe('Karsten')
    expect(watchUserData).not.toHaveBeenCalled()
    act(() => tree.unmount())
})

describe('assistant authors from other projects', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        mockUser = { uid: 'member' }
        mockGetPresentation.mockReturnValue({ displayName: 'Unknown user', isUnknownUser: true })
    })

    it('also searches accessible projects not yet loaded in the sidebar', async () => {
        mockUser = { uid: 'member', projectIds: ['not-loaded'], archivedProjectIds: ['archive'] }
        let tree
        await act(async () => {
            tree = renderProfile({ userId: 'cto', fromAssistant: true })
        })
        expect(findAssistantAuthor).toHaveBeenCalledWith('cto', ['archive', 'not-loaded', 'private', 'team'], 'member')
        act(() => tree.unmount())
    })

    it('replaces Unknown user when the cross-project profile resolves without watching users/', async () => {
        let finish
        findAssistantAuthor.mockReturnValue(
            new Promise(resolve => {
                finish = resolve
            })
        )
        let tree
        act(() => {
            tree = renderProfile({ userId: 'cto', fromAssistant: true })
        })
        expect(tree.root.findByType('span').children).toEqual(['Unknown user'])
        expect(findAssistantAuthor).toHaveBeenCalledWith('cto', ['private', 'team'], 'member')
        expect(watchUserData).not.toHaveBeenCalled()
        await act(async () => {
            finish({ uid: 'cto', displayName: 'Alldone Team CTO' })
        })
        expect(tree.root.findByType('span').children).toEqual(['Alldone Team CTO'])
        act(() => tree.unmount())
    })

    it('refreshes an already-rendered author when Redux receives or renames the profile', async () => {
        let finish
        findAssistantAuthor.mockReturnValue(
            new Promise(resolve => {
                finish = resolve
            })
        )
        let tree
        act(() => {
            tree = renderProfile({ userId: 'cto', fromAssistant: true })
        })
        const loadProfile = name =>
            act(() =>
                mockStore.dispatch({
                    type: 'replace',
                    state: {
                        ...mockStore.getState(),
                        projectAssistants: {
                            team: [{ uid: 'cto', displayName: name }],
                        },
                    },
                })
            )
        loadProfile('CTO')
        expect(tree.root.findByType('span').children).toEqual(['CTO'])
        loadProfile('Renamed CTO')
        await act(async () => {
            finish({ uid: 'cto', displayName: 'Stale CTO' })
        })
        expect(tree.root.findByType('span').children).toEqual(['Renamed CTO'])
        act(() => tree.unmount())
    })

    it('does not erase a legacy assistant name after a late missing-user snapshot', async () => {
        findAssistantAuthor.mockResolvedValue({ uid: 'cto', displayName: 'CTO' })
        let tree
        await act(async () => {
            tree = renderProfile({ userId: 'cto' })
        })
        act(() => watchUserData.mock.calls[0][2](null))
        expect(tree.root.findByType('span').children).toEqual(['CTO'])
        act(() => tree.unmount())
    })

    it('ignores a previous author lookup after switching messages', async () => {
        let finish
        findAssistantAuthor.mockReturnValueOnce(
            new Promise(resolve => {
                finish = resolve
            })
        )
        let tree
        act(() => {
            tree = renderProfile({ userId: 'cto', fromAssistant: true })
        })
        act(() =>
            tree.update(
                <Provider store={mockStore}>
                    <Profile userId="anna" fromAssistant />
                </Provider>
            )
        )
        await act(async () => {
            finish({ uid: 'cto', displayName: 'CTO' })
        })
        expect(tree.root.findByType('span').children).toEqual(['Unknown user'])
        act(() => tree.unmount())
    })

    it('forgets resolved data on logout and ignores in-flight profiles', async () => {
        let tree
        findAssistantAuthor.mockResolvedValue({ uid: 'cto', displayName: 'CTO' })
        await act(async () => {
            tree = renderProfile({ userId: 'cto', fromAssistant: true })
        })
        act(() =>
            mockStore.dispatch({
                type: 'replace',
                state: {
                    loggedUser: { uid: 'anonymous', isAnonymous: true },
                    projectAssistants: {},
                    loggedUserProjectsMap: {},
                },
            })
        )
        expect(tree.root.findByType('span').children).toEqual(['Unknown user'])
        expect(findAssistantAuthor).toHaveBeenCalledTimes(1)
        act(() => tree.unmount())
    })
})
