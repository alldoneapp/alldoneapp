/**
 * @jest-environment jsdom
 */

import React from 'react'
import renderer, { act } from 'react-test-renderer'
import { Text } from 'react-native'

import {
    ASSISTANT_FAILED_SEND_DISPLAY_MS,
    ASSISTANT_PENDING_SEND_TIMEOUT_MS,
    ASSISTANT_REPLY_HANDOFF_MS,
    PENDING_SEND_AWAITING_REPLY,
    PENDING_SEND_FAILED,
    PENDING_SEND_SENDING,
    PENDING_SEND_REPLY_POSTED,
    assistantHasRepliedToPendingSend,
    beginAssistantLineSend,
    endAssistantLineSend,
    failAssistantLineSend,
    getPendingAssistantLineSend,
    getPendingAssistantLineSendForChat,
    markAssistantLineSendCreated,
    resetAssistantLinePendingSends,
    resolveAssistantLineSendForChat,
    useAssistantLinePendingSend,
    useAssistantLinePendingSendForChat,
} from './assistantLinePendingSend'

const ALL_PROJECTS = 'allProjects'

const begin = (overrides = {}) =>
    beginAssistantLineSend({
        keys: ['project-1', ALL_PROJECTS],
        projectId: 'project-1',
        assistantId: 'assistant-1',
        assistantName: 'Anna',
        text: 'hello there',
        ...overrides,
    })

describe('assistantLinePendingSend store (AT-2504)', () => {
    beforeEach(() => {
        resetAssistantLinePendingSends()
    })

    afterEach(() => {
        jest.useRealTimers()
    })

    it('files one send under every key the caller passes', () => {
        begin()

        expect(getPendingAssistantLineSend('project-1')).toMatchObject({
            status: PENDING_SEND_SENDING,
            text: 'hello there',
            assistantName: 'Anna',
        })
        // The same send, reachable from the All-projects line — mirroring the two keys the real
        // `lastAssistantCommentData` pointer is written under.
        expect(getPendingAssistantLineSend(ALL_PROJECTS)).toBeTruthy()
        expect(getPendingAssistantLineSend('another-project')).toBeNull()
    })

    it('refuses to file a send it has nowhere to show, and tolerates the resulting null id', () => {
        expect(begin({ keys: [] })).toBeNull()
        expect(begin({ keys: [undefined, ''] })).toBeNull()

        // Every settle function has to accept that null without the caller branching on it.
        expect(() => {
            markAssistantLineSendCreated(null, 'chat-1')
            failAssistantLineSend(null)
            endAssistantLineSend(null)
        }).not.toThrow()
    })

    it('only compares the assistant when the caller asks it to', () => {
        begin({ assistantId: 'assistant-1' })

        // The ordinary project line does not care which assistant answered there.
        expect(getPendingAssistantLineSend('project-1')).toBeTruthy()
        // An assistant's own board (scopeToAssistant) must not show another assistant's send.
        expect(getPendingAssistantLineSend('project-1', 'assistant-1')).toBeTruthy()
        expect(getPendingAssistantLineSend('project-1', 'assistant-2')).toBeNull()
    })

    it('shows the newest send when a second message is submitted before the first settles', () => {
        begin({ text: 'first' })
        begin({ text: 'second' })

        expect(getPendingAssistantLineSend('project-1').text).toBe('second')
    })

    it('moves to awaiting_reply once the topic exists', () => {
        const id = begin()
        markAssistantLineSendCreated(id, 'chat-1')

        expect(getPendingAssistantLineSend('project-1')).toMatchObject({
            status: PENDING_SEND_AWAITING_REPLY,
            chatId: 'chat-1',
        })
    })

    describe('ending the wait', () => {
        it('resolves only the send that belongs to the chat that was posted in', () => {
            const id = begin()
            markAssistantLineSendCreated(id, 'chat-1')

            // The chat the preview was showing BEFORE this send very likely ends in an assistant
            // comment of its own. Resolving on "an assistant posted somewhere" would clear the
            // card the instant it appeared.
            resolveAssistantLineSendForChat('some-older-chat')
            expect(getPendingAssistantLineSend('project-1')).toBeTruthy()

            resolveAssistantLineSendForChat('chat-1')
            expect(getPendingAssistantLineSend('project-1')).toBeNull()
            expect(getPendingAssistantLineSendForChat('project-1', 'chat-1')).toMatchObject({
                status: PENDING_SEND_REPLY_POSTED,
            })
        })

        it('keeps the thread covered while the assistant pointer reaches the preview before its comment', () => {
            jest.useFakeTimers()
            const id = begin()
            markAssistantLineSendCreated(id, 'chat-1')

            expect(getPendingAssistantLineSendForChat('project-1', 'chat-1')).toMatchObject({
                status: PENDING_SEND_AWAITING_REPLY,
            })
            expect(getPendingAssistantLineSendForChat('project-2', 'chat-1')).toBeNull()
            expect(getPendingAssistantLineSendForChat('project-1', 'another-chat')).toBeNull()

            resolveAssistantLineSendForChat('chat-1')
            expect(getPendingAssistantLineSend('project-1')).toBeNull()
            jest.advanceTimersByTime(ASSISTANT_REPLY_HANDOFF_MS)
            expect(getPendingAssistantLineSendForChat('project-1', 'chat-1')).toBeNull()
        })

        it('does not show a thread wait after its send failed', () => {
            const id = begin()
            markAssistantLineSendCreated(id, 'chat-1')
            failAssistantLineSend(id)

            expect(getPendingAssistantLineSendForChat('project-1', 'chat-1')).toBeNull()
        })

        it('does not treat the user’s own comment as the answer', () => {
            const id = begin()
            markAssistantLineSendCreated(id, 'chat-1')
            const pending = getPendingAssistantLineSend('project-1')

            // The client stamps `creatorType: 'user'` for our own comment and it lands FIRST —
            // that is the pointer moving to the new thread, not the assistant replying.
            expect(
                assistantHasRepliedToPendingSend(pending, {
                    objectId: 'chat-1',
                    creatorType: 'user',
                })
            ).toBe(false)

            expect(
                assistantHasRepliedToPendingSend(pending, {
                    objectId: 'chat-1',
                    creatorType: 'assistant',
                })
            ).toBe(true)
        })

        it('ignores an assistant comment in a different thread', () => {
            const id = begin()
            markAssistantLineSendCreated(id, 'chat-1')
            const pending = getPendingAssistantLineSend('project-1')

            expect(assistantHasRepliedToPendingSend(pending, { objectId: 'chat-2', creatorType: 'assistant' })).toBe(
                false
            )
            // Nothing to compare against before the topic exists.
            expect(
                assistantHasRepliedToPendingSend({ chatId: null }, { objectId: 'chat-1', creatorType: 'assistant' })
            ).toBe(false)
            expect(assistantHasRepliedToPendingSend(null, { objectId: 'chat-1', creatorType: 'assistant' })).toBe(false)
        })
    })

    describe('bounded lifetime', () => {
        beforeEach(() => {
            jest.useFakeTimers()
        })

        it('gives up on a send nobody ever answers', () => {
            begin()

            jest.advanceTimersByTime(ASSISTANT_PENDING_SEND_TIMEOUT_MS - 1)
            expect(getPendingAssistantLineSend('project-1')).toBeTruthy()

            jest.advanceTimersByTime(1)
            expect(getPendingAssistantLineSend('project-1')).toBeNull()
        })

        it('keeps a failure notice for seconds, not minutes', () => {
            const id = begin()
            failAssistantLineSend(id)

            expect(getPendingAssistantLineSend('project-1')).toMatchObject({ status: PENDING_SEND_FAILED })
            jest.advanceTimersByTime(ASSISTANT_FAILED_SEND_DISPLAY_MS)
            expect(getPendingAssistantLineSend('project-1')).toBeNull()
            expect(ASSISTANT_FAILED_SEND_DISPLAY_MS).toBeLessThan(ASSISTANT_PENDING_SEND_TIMEOUT_MS)
        })

        it('drops a failed send from the store rather than leaving it to be re-shown', () => {
            const id = begin()
            failAssistantLineSend(id)

            let tree
            act(() => {
                tree = renderer.create(<PendingProbe />)
            })
            expect(tree.root.findByProps({ testID: 'status' }).props.children).toBe(PENDING_SEND_FAILED)

            act(() => {
                jest.advanceTimersByTime(ASSISTANT_FAILED_SEND_DISPLAY_MS + 10)
            })
            expect(tree.root.findByProps({ testID: 'status' }).props.children).toBe('none')

            act(() => tree.unmount())
        })
    })

    describe('useAssistantLinePendingSend', () => {
        it('re-renders on begin, on progress and on resolve', () => {
            let tree
            act(() => {
                tree = renderer.create(<PendingProbe />)
            })
            expect(tree.root.findByProps({ testID: 'status' }).props.children).toBe('none')

            let id
            act(() => {
                id = begin()
            })
            expect(tree.root.findByProps({ testID: 'status' }).props.children).toBe(PENDING_SEND_SENDING)

            act(() => {
                markAssistantLineSendCreated(id, 'chat-1')
            })
            expect(tree.root.findByProps({ testID: 'status' }).props.children).toBe(PENDING_SEND_AWAITING_REPLY)

            act(() => {
                resolveAssistantLineSendForChat('chat-1')
            })
            expect(tree.root.findByProps({ testID: 'status' }).props.children).toBe('none')

            act(() => tree.unmount())
        })

        it('stops listening once unmounted', () => {
            let tree
            act(() => {
                tree = renderer.create(<PendingProbe />)
            })
            act(() => tree.unmount())

            // A subscriber left behind would call setState on an unmounted tree.
            expect(() => {
                act(() => {
                    begin()
                })
            }).not.toThrow()
        })
    })

    it('updates the chat view through creation, reply handoff and expiry', () => {
        jest.useFakeTimers()
        let tree
        act(() => {
            tree = renderer.create(<ChatPendingProbe />)
        })
        expect(tree.root.findByProps({ testID: 'chat-status' }).props.children).toBe('none')

        let id
        act(() => {
            id = begin()
            markAssistantLineSendCreated(id, 'chat-1')
        })
        expect(tree.root.findByProps({ testID: 'chat-status' }).props.children).toBe(PENDING_SEND_AWAITING_REPLY)

        act(() => resolveAssistantLineSendForChat('chat-1'))
        expect(tree.root.findByProps({ testID: 'chat-status' }).props.children).toBe(PENDING_SEND_REPLY_POSTED)

        act(() => jest.advanceTimersByTime(ASSISTANT_REPLY_HANDOFF_MS + 10))
        expect(tree.root.findByProps({ testID: 'chat-status' }).props.children).toBe('none')
        act(() => tree.unmount())
    })
    /**
     * AT-2523 — the card became a door into the thread, and the popover it opens names the object
     * it is commenting on. That title cannot be read from the thread: it was created a moment ago
     * and nothing in this slot is watching it, so it travels with the chat id or not at all.
     */
    describe('the created thread\u2019s title (AT-2523)', () => {
        it('carries the title alongside the chat id', () => {
            const id = begin()
            markAssistantLineSendCreated(id, 'chat-1', 'Anna <> Karsten 07.09.2026 3')

            expect(getPendingAssistantLineSend('project-1')).toMatchObject({
                chatId: 'chat-1',
                chatTitle: 'Anna <> Karsten 07.09.2026 3',
            })
        })

        it('falls back to an empty string rather than an undefined popover name', () => {
            const id = begin()
            markAssistantLineSendCreated(id, 'chat-1')

            expect(getPendingAssistantLineSend('project-1').chatTitle).toBe('')
        })
    })
})

function PendingProbe({ projectKey = 'project-1', assistantId = null }) {
    const pending = useAssistantLinePendingSend(projectKey, assistantId)
    return <Text testID="status">{pending ? pending.status : 'none'}</Text>
}

function ChatPendingProbe() {
    const pending = useAssistantLinePendingSendForChat('project-1', 'chat-1')
    return <Text testID="chat-status">{pending ? pending.status : 'none'}</Text>
}
