/**
 * @jest-environment jsdom
 */

import React from 'react'
import renderer, { act } from 'react-test-renderer'
import { Provider } from 'react-redux'
import store from '../../../redux/store'
import { seedLoggedUser } from '../../../testUtils/seedStore'
import { watchUserData } from '../../../utils/backends/firestore'
import useGetUserPresentationData from './useGetUserPresentationData'

jest.mock('../../../utils/backends/firestore', () => ({
    ...jest.createMockFromModule('../../../utils/backends/firestore'),
    watchUserData: jest.fn(),
    unwatch: jest.fn(),
}))

jest.mock('./ContactsHelper', () => ({
    getUnknownUserData: () => ({ displayName: 'Unknown user', isUnknownUser: true }),
    getUserPresentationData: () => ({ displayName: 'Unknown user', isUnknownUser: true }),
}))

const Profile = ({ userId }) => {
    const user = useGetUserPresentationData(userId)
    return <span>{user.displayName}</span>
}

describe('shared-view user presentation', () => {
    beforeEach(() => {
        jest.clearAllMocks()
    })

    it('does not watch private user profiles for anonymous chat messages', () => {
        store.dispatch(seedLoggedUser({ uid: 'shared-viewer', isAnonymous: true }))

        let tree
        act(() => {
            tree = renderer.create(
                <Provider store={store}>
                    <Profile userId="private-message-author" />
                </Provider>
            )
        })

        expect(tree.root.findByType('span').children).toEqual(['Unknown user'])
        expect(watchUserData).not.toHaveBeenCalled()
        act(() => tree.unmount())
    })

    it('keeps the profile watcher for authenticated users', () => {
        store.dispatch(seedLoggedUser({ uid: 'member', isAnonymous: false }))

        let tree
        act(() => {
            tree = renderer.create(
                <Provider store={store}>
                    <Profile userId="other-member" />
                </Provider>
            )
        })

        expect(watchUserData).toHaveBeenCalledWith('other-member', false, expect.any(Function), expect.any(String))
        act(() => tree.unmount())
    })
})
