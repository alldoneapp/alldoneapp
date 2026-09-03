/**
 * @jest-environment jsdom
 */

import React from 'react'
import renderer, { act } from 'react-test-renderer'

import LastCommentArea from './LastCommentArea'
import {
    beginAssistantLineSend,
    markAssistantLineSendCreated,
    resetAssistantLinePendingSends,
} from './assistantLinePendingSend'

const ALL_PROJECTS = 'allProjects'

const mockState = {
    defaultAssistant: { uid: 'assistant-1' },
    selectedProjectIndex: 0,
    loggedUserProjects: [{ id: 'project-1', index: 0, name: 'Project one' }],
    loggedUser: {
        defaultProjectId: 'project-1',
        lastAssistantCommentData: {},
        lastAssistantCommentDataByAssistant: {},
    },
    projectChatLastNotification: {},
}

jest.mock('react-redux', () => ({
    useSelector: selector => selector(mockState),
}))

jest.mock('../../../i18n/TranslationService', () => ({
    translate: (key, params) => (params?.name ? `${key}:${params.name}` : key),
}))

// The real module is the comments backend; only the key constant matters here.
jest.mock('../../../utils/backends/Chats/chatsComments', () => ({
    ASSISTANT_LAST_COMMENT_ALL_PROJECTS_KEY: 'allProjects',
}))

jest.mock('./AssistantOptions/helper', () => ({
    getAssistantLineData: () => ({
        assistant: { uid: 'assistant-1', displayName: 'Anna' },
        assistantProject: { id: 'project-1', index: 0, name: 'Project one' },
        assistantProjectId: 'project-1',
    }),
    getCommentData: (project, notification, lastCommentData) => ({
        commentProject: lastCommentData ? project : null,
        commentCreator: lastCommentData ? { uid: 'assistant-1' } : null,
    }),
}))

// The real preview drags in the whole comment/tag rendering and navigation graph.
jest.mock('./LastComment/LastComment', () => {
    const React = require('react')
    const { Text } = require('react-native')
    return () => <Text testID="real-last-comment">real preview</Text>
})

const setLastCommentData = data => {
    mockState.loggedUser.lastAssistantCommentData = data ? { 'project-1': data, [ALL_PROJECTS]: data } : {}
}

const begin = (overrides = {}) =>
    beginAssistantLineSend({
        keys: ['project-1', ALL_PROJECTS],
        projectId: 'project-1',
        assistantId: 'assistant-1',
        assistantName: 'Anna',
        text: 'a message I just sent',
        ...overrides,
    })

const render = (props = {}) => {
    let tree
    act(() => {
        tree = renderer.create(<LastCommentArea {...props} />)
    })
    return tree
}

const has = (tree, testID) => tree.root.findAllByProps({ testID }).length > 0

describe('LastCommentArea pending send (AT-2504)', () => {
    beforeEach(() => {
        resetAssistantLinePendingSends()
        setLastCommentData(null)
        mockState.projectChatLastNotification = {}
    })

    it('takes over the slot the answer will land in, ahead of the loading ghost', () => {
        // Nothing has ever been said here, so without a pending send this slot shows the ghost.
        const withoutPending = render()
        expect(has(withoutPending, 'assistant-last-comment-loading-skeleton')).toBe(true)
        act(() => withoutPending.unmount())

        begin()
        const tree = render()

        expect(has(tree, 'assistant-pending-send')).toBe(true)
        expect(has(tree, 'assistant-last-comment-loading-skeleton')).toBe(false)
        expect(tree.root.findByProps({ testID: 'assistant-pending-send-text' }).props.children).toBe(
            'a message I just sent'
        )
        act(() => tree.unmount())
    })

    it('replaces the previous comment rather than leaving a stale one on screen', () => {
        setLastCommentData({ objectId: 'older-chat', objectType: 'topics', creatorType: 'assistant' })

        const before = render()
        expect(has(before, 'real-last-comment')).toBe(true)
        act(() => before.unmount())

        begin()
        const tree = render()

        expect(has(tree, 'assistant-pending-send')).toBe(true)
        expect(has(tree, 'real-last-comment')).toBe(false)
        act(() => tree.unmount())
    })

    it('still shows on an assistant board that has no history at all', () => {
        // `scopeToAssistant` renders null with no stored pointer — which is exactly the state a
        // brand new assistant is in when you send it your first message.
        const withoutPending = render({ scopeToAssistant: true })
        expect(withoutPending.toJSON()).toBeNull()
        act(() => withoutPending.unmount())

        begin()
        const tree = render({ scopeToAssistant: true })
        expect(has(tree, 'assistant-pending-send')).toBe(true)
        act(() => tree.unmount())
    })

    it('does not show another assistant’s pending send on an assistant board', () => {
        begin({ assistantId: 'assistant-2' })

        const scoped = render({ scopeToAssistant: true })
        expect(scoped.toJSON()).toBeNull()
        act(() => scoped.unmount())

        // The ordinary project line is not scoped and still shows it.
        const unscoped = render()
        expect(has(unscoped, 'assistant-pending-send')).toBe(true)
        act(() => unscoped.unmount())
    })

    it('keeps waiting when the pointer moves to the new thread carrying the user’s OWN comment', () => {
        const id = begin()
        markAssistantLineSendCreated(id, 'chat-1')
        // `createObjectMessage` writes this one, client-side, as soon as the topic exists. It is
        // not the answer, and clearing on it would drop the indicator seconds too early.
        setLastCommentData({ objectId: 'chat-1', objectType: 'topics', creatorType: 'user' })

        const tree = render()
        expect(has(tree, 'assistant-pending-send')).toBe(true)
        expect(tree.root.findByProps({ testID: 'assistant-pending-send-status' }).props.children).toBe(
            'assistantLineWorkingOnIt:Anna'
        )
        act(() => tree.unmount())
    })

    it('hands the slot back once the assistant has answered', () => {
        const id = begin()
        markAssistantLineSendCreated(id, 'chat-1')
        setLastCommentData({ objectId: 'chat-1', objectType: 'topics', creatorType: 'assistant' })

        const tree = render()
        expect(has(tree, 'assistant-pending-send')).toBe(false)
        expect(has(tree, 'real-last-comment')).toBe(true)
        act(() => tree.unmount())
    })

    it('hands the slot back on a followed chat notification for that thread', () => {
        const id = begin()
        markAssistantLineSendCreated(id, 'chat-1')
        // The comment fan-out excludes its own creator, so a notification for this chat can only
        // have come from somebody other than us.
        mockState.projectChatLastNotification = {
            'project-1': { chatId: 'chat-1', chatType: 'topics', followed: true },
        }

        const tree = render()
        expect(has(tree, 'assistant-pending-send')).toBe(false)
        act(() => tree.unmount())
    })
})
