/**
 * @jest-environment jsdom
 */

import React from 'react'
import renderer, { act } from 'react-test-renderer'
import { watchUserData } from '../../../utils/backends/firestore'
import useGetUserPresentationData from './useGetUserPresentationData'

let mockUser
const mockGetPresentation = jest.fn()
jest.mock('react-redux', () => ({ useSelector: selector => selector({ loggedUser: mockUser }) }))
jest.mock('../../../utils/backends/firestore', () => ({
    watchUserData: jest.fn(),
    unwatch: jest.fn(),
}))

jest.mock('./ContactsHelper', () => ({
    getUnknownUserData: () => ({ displayName: 'Unknown user', isUnknownUser: true }),
    getUserPresentationData: id => mockGetPresentation(id),
}))

const Profile = ({ userId }) => {
    const user = useGetUserPresentationData(userId)
    return <span>{user.displayName}</span>
}

describe('shared-view user presentation', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        mockGetPresentation.mockReturnValue({ displayName: 'Unknown user', isUnknownUser: true })
    })

    it('does not watch private user profiles for anonymous chat messages', () => {
        mockUser = { uid: 'shared-viewer', isAnonymous: true }

        let tree
        act(() => {
            tree = renderer.create(<Profile userId="private-message-author" />)
        })

        expect(tree.root.findByType('span').children).toEqual(['Unknown user'])
        expect(watchUserData).not.toHaveBeenCalled()
        act(() => tree.unmount())
    })

    it('keeps the profile watcher for authenticated users', () => {
        mockUser = { uid: 'member', isAnonymous: false }

        let tree
        act(() => {
            tree = renderer.create(<Profile userId="other-member" />)
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
        tree = renderer.create(<Author />)
    })
    expect(renders[0]).toBe('Karsten')
    expect(watchUserData).not.toHaveBeenCalled()
    act(() => tree.unmount())
})
