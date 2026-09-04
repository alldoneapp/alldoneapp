/**
 * @jest-environment jsdom
 */

import React from 'react'
import { StyleSheet, Text, TouchableOpacity } from 'react-native'
import renderer, { act } from 'react-test-renderer'

import LastUserOrAssistantCommentContainer from './LastUserOrAssistantCommentContainer'
import LastAssistantCommentWrapper from './LastAssistantCommentWrapper'
import LastAssistantComment, { LAST_COMMENT_PREVIEW_HEIGHT } from './LastAssistantComment'
import UnreadCommentsBadge from './UnreadCommentsBadge'
import { watchComments } from '../../../../utils/backends/Chats/chatsComments'
import { resetLastCommentArrivals } from './lastCommentArrival'

const mockState = {
    loggedUser: { uid: 'user-1' },
    defaultAssistant: { uid: 'assistant-default' },
    projectChatNotifications: {},
    selectedProjectIndex: 0,
    smallScreenNavigation: true,
}

// `requireActual` spread, not a bare `useSelector`: this suite renders the REAL card, which pulls
// in the redux store graph, and that needs `connect` to exist on the module.
jest.mock('react-redux', () => ({
    ...jest.requireActual('react-redux'),
    useSelector: selector => selector(mockState),
}))

jest.mock('../../../../utils/backends/Chats/chatsFirestore', () => ({
    watchChat: jest.fn((projectId, objectId, watcherKey, callback) => {
        callback({ title: 'A topic', assistantId: 'assistant-1' })
    }),
}))

jest.mock('../../../../utils/backends/Chats/chatsComments', () => ({
    watchComments: jest.fn(),
}))

jest.mock('../../../../utils/backends/firestore', () => ({
    unwatch: jest.fn(),
}))

jest.mock('./LastAssistantCommentWrapper', () => {
    const React = require('react')
    const { View } = require('react-native')
    return props => <View testID="last-assistant-comment" {...props} />
})

jest.mock('../AssistantLineSkeleton', () => {
    const React = require('react')
    const { View } = require('react-native')
    return {
        LastCommentPreviewSkeleton: props => <View testID="assistant-last-comment-loading-skeleton" {...props} />,
    }
})

jest.mock('../../../SettingsView/ProjectsSettings/ProjectHelper', () => ({
    checkIfSelectedAllProjects: () => false,
}))

jest.mock('./ProjectTagIndicator', () => () => null)

const project = { id: 'project-1', assistantId: 'assistant-project' }

const emitComment = (commentText, id = commentText) => {
    const handler = watchComments.mock.calls[watchComments.mock.calls.length - 1][5]
    act(() => {
        handler([{ id, commentText }])
    })
}

const renderContainer = ({ objectId = 'chat-1', scopeKey = 'user-1:project-1:' } = {}) => {
    let tree
    act(() => {
        tree = renderer.create(
            <LastUserOrAssistantCommentContainer
                project={project}
                objectId={objectId}
                objectType="topics"
                setAModalIsOpen={jest.fn()}
                scopeKey={scopeKey}
            />
        )
    })
    return {
        tree,
        arrivalId: () => tree.root.findByType(LastAssistantCommentWrapper).props.arrivalId,
        unmount: () => act(() => tree.unmount()),
    }
}

describe('AT-2511 — the arrival signal reaches the card', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        localStorage.clear()
        resetLastCommentArrivals()
    })

    it('does not announce the comment the slot loads with', () => {
        const container = renderContainer()
        emitComment('The first thing this slot ever showed')

        expect(container.arrivalId()).toBeNull()
        container.unmount()
    })

    it('announces a comment that lands while the slot is on screen', () => {
        const container = renderContainer()
        emitComment('The first thing this slot ever showed')
        emitComment('A brand new answer from the assistant')

        expect(container.arrivalId()).toEqual(expect.any(Number))
        container.unmount()
    })

    it('does not re-announce the same comment when the watcher re-delivers it', () => {
        const container = renderContainer()
        emitComment('First')
        emitComment('Second')
        const announced = container.arrivalId()

        emitComment('Second')
        expect(container.arrivalId()).toBe(announced)
        container.unmount()
    })

    /**
     * The case a component-local "previous value" ref structurally cannot see: `LastComment` keys
     * its child on the chat, so a comment arriving in ANOTHER chat — a heartbeat, a VM result, the
     * AT-2504 pending → reply handoff — replaces this subtree with a fresh mount.
     */
    it('announces a comment that arrives in a different chat, across the remount', () => {
        const first = renderContainer({ objectId: 'chat-1' })
        emitComment('Answer in the chat that was on screen')
        first.unmount()

        const second = renderContainer({ objectId: 'chat-2' })
        emitComment('Answer in a completely different chat')

        expect(second.arrivalId()).toEqual(expect.any(Number))
        second.unmount()
    })

    it('stays quiet when navigation remounts the slot onto the same comment', () => {
        const first = renderContainer()
        emitComment('Unchanged answer')
        first.unmount()

        const second = renderContainer()
        emitComment('Unchanged answer')

        expect(second.arrivalId()).toBeNull()
        second.unmount()
    })

    // Two slots that are not the same slot must not spend each other's first paint.
    it('keeps separate slots independent', () => {
        const mine = renderContainer({ scopeKey: 'user-1:project-1:' })
        emitComment('Answer')
        mine.unmount()

        const other = renderContainer({ scopeKey: 'user-1:allProjects:' })
        emitComment('Answer')

        expect(other.arrivalId()).toBeNull()
        other.unmount()
    })

    it('is inert for a slot that was given no scope', () => {
        const container = renderContainer({ scopeKey: null })
        emitComment('First')
        emitComment('Second')

        expect(container.arrivalId()).toBeNull()
        container.unmount()
    })
})

describe('AT-2511 — the card rolls the old comment away', () => {
    const OLD = 'The comment that was already on screen'
    const NEW = 'The answer that just landed'

    const cardElement = props => (
        <LastAssistantComment projectId="project-1" objectName="A chat title" onPress={() => {}} {...props} />
    )
    const renderCard = props => renderer.create(cardElement(props))

    const cardStyle = tree => StyleSheet.flatten(tree.root.findByType(TouchableOpacity).props.style)
    // `SocialText`-style rendering splits a comment into one <Text> per word, and each carries a
    // trailing space as a second child — so the words have to be flattened and re-joined before any
    // phrase is findable.
    const rowTexts = (tree, testID) => {
        const row = tree.root.findAllByProps({ testID })[0]
        if (!row) return ''
        return row
            .findAllByType(Text)
            .flatMap(node => [].concat(node.props.children))
            .filter(child => typeof child === 'string')
            .join('')
            .replace(/\s+/g, ' ')
            .trim()
    }

    /**
     * jest keeps every animation in this codebase inert, so the roll has to be opted into to be
     * observable at all — otherwise "there is no outgoing row" passes because there is never one.
     */
    const withAnimationsEnabled = fn => {
        const previous = process.env.NODE_ENV
        process.env.NODE_ENV = 'development'
        try {
            return fn()
        } finally {
            process.env.NODE_ENV = previous
        }
    }

    it('reserves the same height whether or not a comment just arrived', () => {
        expect(cardStyle(renderCard({ commentText: NEW, arrivalId: null })).height).toBe(LAST_COMMENT_PREVIEW_HEIGHT)
        expect(cardStyle(renderCard({ commentText: NEW, arrivalId: 7 })).height).toBe(LAST_COMMENT_PREVIEW_HEIGHT)
    })

    it('keeps the compact chip at its own fixed height during an arrival', () => {
        expect(cardStyle(renderCard({ commentText: NEW, arrivalId: 7, compact: true })).height).toBe(24)
    })

    it('mounts no outgoing row at rest', () => {
        const tree = renderCard({ commentText: NEW, arrivalId: null })
        expect(tree.root.findAllByProps({ testID: 'last-comment-outgoing-row' })).toHaveLength(0)
    })

    // The house convention: animations are inert under jest unless a suite opts out.
    it('mounts no outgoing row under jest', () => {
        const tree = renderCard({ commentText: NEW, arrivalId: 7 })
        expect(tree.root.findAllByProps({ testID: 'last-comment-outgoing-row' })).toHaveLength(0)
    })

    /**
     * The whole feature in one assertion: on the frame an arrival lands, the card shows BOTH
     * comments — the previous one on its way out, the new one on its way in. It is also the case
     * that proves the previous comment is captured from what was PAINTED rather than from props,
     * since by this point the props only carry the new one.
     */
    it('renders the previous comment and the new one together while rolling', () => {
        withAnimationsEnabled(() => {
            let tree
            act(() => {
                tree = renderer.create(cardElement({ commentText: OLD, arrivalId: null }))
            })
            act(() => {
                tree.update(cardElement({ commentText: NEW, arrivalId: 1 }))
            })

            expect(rowTexts(tree, 'last-comment-outgoing-row')).toContain('already on screen')
            expect(rowTexts(tree, 'last-comment-incoming-row')).toContain('just landed')
        })
    })

    it('never lets the outgoing comment take a press', () => {
        withAnimationsEnabled(() => {
            let tree
            act(() => {
                tree = renderer.create(cardElement({ commentText: OLD, arrivalId: null }))
            })
            act(() => {
                tree.update(cardElement({ commentText: NEW, arrivalId: 1 }))
            })

            expect(tree.root.findByProps({ testID: 'last-comment-outgoing-row' }).props.pointerEvents).toBe('none')
        })
    })

    /**
     * The roll has to be clipped by a viewport INSIDE the card rather than by the card itself: the
     * unread badge sits at `top/right: -5`, outside the card's own box, so clipping the card would
     * cut the badge off.
     */
    it('clips the roll with a viewport that does not contain the badge', () => {
        const tree = renderCard({ commentText: NEW, arrivalId: null, isNew: true, unreadComments: 2 })
        const viewport = tree.root.findAllByProps({ testID: 'last-comment-roll-viewport' })[0]
        const viewportStyle = StyleSheet.flatten(viewport.props.style)

        expect(viewportStyle.overflow).toBe('hidden')
        expect(viewportStyle.borderRadius).toBeGreaterThan(0)
        expect(viewport.findAllByProps({ testID: 'unread-comments-badge' })).toHaveLength(0)
        expect(tree.root.findAllByProps({ testID: 'unread-comments-badge' }).length).toBeGreaterThan(0)
    })

    it('does not clip the card itself, so the badge can overhang it', () => {
        expect(cardStyle(renderCard({ commentText: NEW, arrivalId: null })).overflow).toBeUndefined()
    })

    it('still opens the thread while a comment is arriving', () => {
        const onPress = jest.fn()
        const tree = renderCard({ commentText: NEW, arrivalId: 7, onPress })
        act(() => tree.root.findByType(TouchableOpacity).props.onPress())
        expect(onPress).toHaveBeenCalled()
    })
})

/**
 * The badge is `position: absolute` against the card's corner. A react-native-web `View` is
 * `position: relative` by default, so animating it through a WRAPPER would silently re-anchor it to
 * a zero-sized box — which is why the pop is passed in as a style instead.
 */
describe('AT-2511 — the unread badge keeps its anchoring', () => {
    const badgeStyle = extraProps =>
        StyleSheet.flatten(
            renderer
                .create(<UnreadCommentsBadge amount={3} followed={true} {...extraProps} />)
                .root.findByProps({ testID: 'unread-comments-badge' }).props.style
        )

    it('stays pinned to the card corner without a style', () => {
        expect(badgeStyle()).toMatchObject({ position: 'absolute', right: -5, top: -5 })
    })

    it('stays pinned to the card corner while it pops', () => {
        expect(badgeStyle({ style: { transform: [{ scale: 0.4 }] } })).toMatchObject({
            position: 'absolute',
            right: -5,
            top: -5,
        })
    })

    it('renders nothing when there is nothing unread', () => {
        const tree = renderer.create(<UnreadCommentsBadge amount={0} followed={true} />)
        expect(tree.root.findAllByProps({ testID: 'unread-comments-badge' })).toHaveLength(0)
    })
})
