/**
 * @jest-environment jsdom
 */

import React from 'react'
import renderer, { act } from 'react-test-renderer'
import { Text } from 'react-native'

import useCommentPopupAutoFocus, {
    COMMENT_POPUP_FOCUS_BLUR,
    COMMENT_POPUP_FOCUS_DELAYED,
    COMMENT_POPUP_FOCUS_MOUNT_ONLY,
    COMMENT_POPUP_FOCUS_NONE,
    hasUnreadChatComments,
    resolveCommentPopupFocusAction,
    shouldSuppressCommentPopupAutoFocus,
} from './commentPopupAutoFocus'

function TestComponent({ mobile = false, chatNotifications = null, openedFromUnreadComment = false }) {
    const shouldAutoFocus = useCommentPopupAutoFocus({ mobile, chatNotifications, openedFromUnreadComment })
    return <Text testID="focus-result">{String(shouldAutoFocus)}</Text>
}

const getResult = tree => tree.root.findByProps({ testID: 'focus-result' }).props.children

const READ = { totalFollowed: 0, totalUnfollowed: 0 }
const UNREAD = { totalFollowed: 1, totalUnfollowed: 0 }

describe('comment pop-up unread detection', () => {
    it('detects followed and unfollowed unread comments', () => {
        expect(hasUnreadChatComments()).toBe(false)
        expect(hasUnreadChatComments(READ)).toBe(false)
        expect(hasUnreadChatComments(UNREAD)).toBe(true)
        expect(hasUnreadChatComments({ totalFollowed: 0, totalUnfollowed: 2 })).toBe(true)
    })
})

describe('comment pop-up auto focus (AT-2269)', () => {
    it('focuses on mobile so the software keyboard opens', () => {
        const tree = renderer.create(<TestComponent mobile chatNotifications={READ} />)

        expect(getResult(tree)).toBe('true')
    })

    it('focuses on mobile when the thread has no notification data at all', () => {
        const tree = renderer.create(<TestComponent mobile />)

        expect(getResult(tree)).toBe('true')
    })

    it('does not focus on mobile when there are unread comments to read', () => {
        const tree = renderer.create(<TestComponent mobile chatNotifications={UNREAD} />)

        expect(getResult(tree)).toBe('false')
    })

    it('does not focus on mobile when opened from an unread comment', () => {
        const tree = renderer.create(<TestComponent mobile chatNotifications={READ} openedFromUnreadComment />)

        expect(getResult(tree)).toBe('false')
    })

    // Desktop is untouched by AT-2269: it focused unconditionally before and still
    // does, including for unread threads.
    it.each([
        ['read', READ, false],
        ['unread', UNREAD, false],
        ['opened from an unread comment', READ, true],
    ])('always focuses on desktop (%s)', (_label, chatNotifications, openedFromUnreadComment) => {
        const tree = renderer.create(
            <TestComponent chatNotifications={chatNotifications} openedFromUnreadComment={openedFromUnreadComment} />
        )

        expect(getResult(tree)).toBe('true')
    })

    // The pop-up marks the thread read on mount, so the unread flag disappears a
    // beat after opening. Without stickiness the keyboard would pop up late, over
    // the comment the user tapped in to read.
    it('keeps the keyboard down after opening clears the unread state', () => {
        let tree
        act(() => {
            tree = renderer.create(<TestComponent mobile chatNotifications={UNREAD} />)
        })
        expect(getResult(tree)).toBe('false')

        act(() => {
            tree.update(<TestComponent mobile chatNotifications={READ} />)
        })
        expect(getResult(tree)).toBe('false')
    })

    it('keeps the keyboard down when unread state arrives just after mount', () => {
        let tree
        act(() => {
            tree = renderer.create(<TestComponent mobile chatNotifications={READ} />)
        })
        expect(getResult(tree)).toBe('true')

        act(() => {
            tree.update(<TestComponent mobile chatNotifications={{ totalFollowed: 0, totalUnfollowed: 1 }} />)
        })
        expect(getResult(tree)).toBe('false')

        act(() => {
            tree.update(<TestComponent mobile chatNotifications={READ} />)
        })
        expect(getResult(tree)).toBe('false')
    })

    it('keeps focus suppressed when responsive state settles after opening', () => {
        let tree
        act(() => {
            tree = renderer.create(<TestComponent mobile chatNotifications={UNREAD} />)
        })

        act(() => {
            tree.update(<TestComponent mobile={false} chatNotifications={UNREAD} />)
        })
        expect(getResult(tree)).toBe('false')
    })

    it('exposes the same rule as a pure function', () => {
        expect(shouldSuppressCommentPopupAutoFocus({ mobile: true, chatNotifications: UNREAD })).toBe(true)
        expect(shouldSuppressCommentPopupAutoFocus({ mobile: true, chatNotifications: READ })).toBe(false)
        expect(shouldSuppressCommentPopupAutoFocus({ mobile: false, chatNotifications: UNREAD })).toBe(false)
        expect(shouldSuppressCommentPopupAutoFocus()).toBe(false)
    })
})

describe('comment pop-up focus effect action', () => {
    it('leaves the suggested-tasks surface alone', () => {
        expect(resolveCommentPopupFocusAction({ inSuggested: true, shouldAutoFocus: true })).toBe(
            COMMENT_POPUP_FOCUS_NONE
        )
        expect(resolveCommentPopupFocusAction({ inSuggested: true, shouldAutoFocus: false, mobile: true })).toBe(
            COMMENT_POPUP_FOCUS_NONE
        )
    })

    it('blurs and dismisses the keyboard when focus is suppressed', () => {
        expect(resolveCommentPopupFocusAction({ shouldAutoFocus: false, mobile: true })).toBe(COMMENT_POPUP_FOCUS_BLUR)
        expect(resolveCommentPopupFocusAction({ shouldAutoFocus: false })).toBe(COMMENT_POPUP_FOCUS_BLUR)
    })

    // The delayed re-focus is the desktop belt-and-braces pass. On mobile it cannot
    // raise the keyboard (it is outside the opening gesture) and could only re-open
    // one the user had just dismissed.
    it('never re-focuses on mobile', () => {
        expect(resolveCommentPopupFocusAction({ shouldAutoFocus: true, mobile: true })).toBe(
            COMMENT_POPUP_FOCUS_MOUNT_ONLY
        )
    })

    it('keeps the delayed re-focus on desktop', () => {
        expect(resolveCommentPopupFocusAction({ shouldAutoFocus: true, mobile: false })).toBe(
            COMMENT_POPUP_FOCUS_DELAYED
        )
    })
})
