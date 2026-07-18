/**
 * @jest-environment jsdom
 */

import React from 'react'
import renderer, { act } from 'react-test-renderer'
import { Text } from 'react-native'

import useShouldAutoFocusChatInput, { hasUnreadChatComments } from './useShouldAutoFocusChatInput'

function TestComponent({ notifications, openedFromUnreadComment = false }) {
    const shouldAutoFocus = useShouldAutoFocusChatInput(notifications, openedFromUnreadComment)
    return <Text testID="focus-result">{String(shouldAutoFocus)}</Text>
}

const getResult = tree => tree.root.findByProps({ testID: 'focus-result' }).props.children

describe('thread input auto focus', () => {
    it('detects followed and unfollowed unread comments', () => {
        expect(hasUnreadChatComments()).toBe(false)
        expect(hasUnreadChatComments({ totalFollowed: 0, totalUnfollowed: 0 })).toBe(false)
        expect(hasUnreadChatComments({ totalFollowed: 1, totalUnfollowed: 0 })).toBe(true)
        expect(hasUnreadChatComments({ totalFollowed: 0, totalUnfollowed: 2 })).toBe(true)
    })

    it('focuses a thread opened without unread comments', () => {
        const tree = renderer.create(<TestComponent notifications={{ totalFollowed: 0, totalUnfollowed: 0 }} />)

        expect(getResult(tree)).toBe('true')
    })

    it('does not focus a thread opened from an unread preview', () => {
        const tree = renderer.create(<TestComponent openedFromUnreadComment />)

        expect(getResult(tree)).toBe('false')
    })

    it('keeps focus suppressed after opening clears the unread state', () => {
        let tree
        act(() => {
            tree = renderer.create(<TestComponent notifications={{ totalFollowed: 1, totalUnfollowed: 0 }} />)
        })
        expect(getResult(tree)).toBe('false')

        act(() => {
            tree.update(<TestComponent notifications={{ totalFollowed: 0, totalUnfollowed: 0 }} />)
        })
        expect(getResult(tree)).toBe('false')
    })

    it('suppresses focus when unread state arrives just after mount', () => {
        let tree
        act(() => {
            tree = renderer.create(<TestComponent />)
        })
        expect(getResult(tree)).toBe('true')

        act(() => {
            tree.update(<TestComponent notifications={{ totalFollowed: 0, totalUnfollowed: 1 }} />)
        })
        expect(getResult(tree)).toBe('false')

        act(() => {
            tree.update(<TestComponent notifications={{ totalFollowed: 0, totalUnfollowed: 0 }} />)
        })
        expect(getResult(tree)).toBe('false')
    })
})
