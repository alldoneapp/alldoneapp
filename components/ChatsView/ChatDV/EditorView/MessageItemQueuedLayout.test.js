/**
 * @jest-environment jsdom
 */

// AT-2963 — a queued chat message (AT-2922) showed the green "Quote" swipe layer through itself.
//
// Every message row sits on top of a `SwipeAreasContainer` (the green, half-width "Quote" area
// revealed by swiping right), and it is the row's own opaque background that hides it. AT-2922
// dimmed a queued message by setting `opacity: 0.6` on that same row, which made its background
// translucent too, so the layer showed through and the "Quote" label lay over the avatar and the
// author name. The rule pinned here: the row that covers the swipe layer stays fully opaque, and
// only what is drawn on top of it (header + content) is dimmed.

import React from 'react'
import { Animated, StyleSheet } from 'react-native'
import renderer, { act } from 'react-test-renderer'

import MessageItem, { QUEUED_CONTENT_STYLE } from './MessageItem'

jest.mock('react-native-gesture-handler/Swipeable', () => {
    const React = require('react')
    const { View } = require('react-native')
    return React.forwardRef(function Swipeable({ children }, ref) {
        React.useImperativeHandle(ref, () => ({ close: () => {} }))
        return <View testID="swipeable">{children}</View>
    })
})
jest.mock('react-redux', () => ({
    useDispatch: () => jest.fn(),
    useSelector: selector =>
        selector({
            loggedUser: { uid: 'user-1', isAnonymous: false },
            showFloatPopup: 0,
            activeChatMessageId: '',
        }),
}))
jest.mock('../../../../redux/actions', () => ({
    setQuotedText: jest.fn(),
    setActiveChatMessageId: jest.fn(),
}))
jest.mock('../../../../utils/SharedHelper', () => ({ accessGranted: () => true }))
jest.mock('../../../ContactsView/Utils/useGetUserPresentationData', () => () => ({
    displayName: 'Karsten Wysk',
    photoURL: { uri: 'avatar.png' },
    isProjectUser: true,
}))
jest.mock('../../Utils/ChatHelper', () => ({ getTimestampInMilliseconds: value => value }))
jest.mock('./messageLoadingState', () => ({ resolveEffectiveMessageLoading: () => false }))
jest.mock('../../../TaskListView/SwipeAreasContainer', () => 'SwipeAreasContainer')
jest.mock('./MessageItemHeader', () => 'MessageItemHeader')
jest.mock('./MessageItemContent', () => 'MessageItemContent')

const renderMessage = message => {
    let tree
    act(() => {
        tree = renderer.create(
            <MessageItem
                chat={{ id: 'chat-1' }}
                projectId="project-1"
                message={{
                    id: 'comment-1',
                    creatorId: 'user-1',
                    commentText: 'Was sollte mein Pitch sein?',
                    lastChangeDate: 1,
                    ...message,
                }}
                serverTime={1}
                objectType="tasks"
            />
        )
    })
    return tree
}

const opacityOf = instance => {
    const opacity = StyleSheet.flatten(instance.props.style || {}).opacity
    return opacity === undefined ? 1 : opacity
}

// Every element between the swipe layer's parent and the header that is drawn over the layer.
const ancestorsOf = (instance, stopAt) => {
    const chain = []
    let node = instance.parent
    while (node && node !== stopAt) {
        chain.push(node)
        node = node.parent
    }
    return chain
}

const queuedPendingSend = { id: 'pending-1', userId: 'user-1', status: 'queued' }

describe('MessageItem queued layout (AT-2963)', () => {
    it('keeps the row that covers the swipe-to-quote layer fully opaque while a message is queued', () => {
        const tree = renderMessage({ pendingSend: queuedPendingSend })
        const row = tree.root.findByType(Animated.View)

        expect(opacityOf(row)).toBe(1)
        // Its background is what hides the green layer: it must be a solid colour at rest.
        expect(StyleSheet.flatten(row.props.style).backgroundColor).toBeTruthy()
    })

    it('dims the header and the message text of a queued message', () => {
        const tree = renderMessage({ pendingSend: queuedPendingSend })
        const foreground = tree.root.findByProps({ testID: 'message-item-foreground' })

        expect(opacityOf(foreground)).toBe(QUEUED_CONTENT_STYLE.opacity)
        expect(QUEUED_CONTENT_STYLE.opacity).toBeLessThan(1)
        expect(foreground.findAllByType('MessageItemHeader')).toHaveLength(1)
        expect(foreground.findAllByType('MessageItemContent')).toHaveLength(1)
    })

    it('never makes anything translucent between the swipe layer and the message except the content wrapper', () => {
        const tree = renderMessage({ pendingSend: queuedPendingSend })
        const swipeLayer = tree.root.findByType('SwipeAreasContainer')
        const header = tree.root.findByType('MessageItemHeader')
        const foreground = tree.root.findByProps({ testID: 'message-item-foreground' })

        const translucent = ancestorsOf(header, swipeLayer.parent).filter(node => opacityOf(node) < 1)
        // Only the content wrapper (the View and the DOM node react-native-web renders for it)
        // may be translucent.
        expect(translucent.length).toBeGreaterThan(0)
        expect(
            translucent.every(node => (node.props.testID || node.props['data-testid']) === 'message-item-foreground')
        ).toBe(true)
        // And the swipe layer itself is not inside the dimmed subtree.
        expect(foreground.findAllByType('SwipeAreasContainer')).toHaveLength(0)
    })

    it('does not dim a sent message or one only waiting to sync', () => {
        for (const pendingSend of [undefined, { id: 'pending-2', userId: 'user-1', status: 'pending' }]) {
            const tree = renderMessage({ pendingSend })
            expect(opacityOf(tree.root.findByType(Animated.View))).toBe(1)
            expect(opacityOf(tree.root.findByProps({ testID: 'message-item-foreground' }))).toBe(1)
        }
    })

    it('still renders the queued status through the header so Send now / Remove stay reachable', () => {
        const tree = renderMessage({ pendingSend: queuedPendingSend })
        const header = tree.root.findByType('MessageItemHeader')

        expect(header.props.message.pendingSend).toBe(queuedPendingSend)
        expect(header.props.editDisabled).toBe(true)
    })
})
