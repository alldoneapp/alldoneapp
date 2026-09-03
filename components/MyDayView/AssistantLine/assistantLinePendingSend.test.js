/**
 * @jest-environment jsdom
 */

import React from 'react'
import renderer, { act } from 'react-test-renderer'
import { Text } from 'react-native'

import {
    ASSISTANT_FAILED_SEND_DISPLAY_MS,
    ASSISTANT_PENDING_SEND_TIMEOUT_MS,
    PENDING_SEND_AWAITING_REPLY,
    PENDING_SEND_FAILED,
    PENDING_SEND_SENDING,
    assistantHasRepliedToPendingSend,
    beginAssistantLineSend,
    endAssistantLineSend,
    failAssistantLineSend,
    getPendingAssistantLineSend,
    markAssistantLineSendCreated,
    resetAssistantLinePendingSends,
    resolveAssistantLineSendForChat,
    useAssistantLinePendingSend,
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
        afterEach(() => {
            jest.useRealTimers()
        })

        it('gives up on a send nobody ever answers', () => {
            const now = Date.now()
            begin()

            expect(
                getPendingAssistantLineSend('project-1', null, now + ASSISTANT_PENDING_SEND_TIMEOUT_MS - 1)
            ).toBeTruthy()
            // A progress card nobody can clear is worse than no card at all.
            expect(getPendingAssistantLineSend('project-1', null, now + ASSISTANT_PENDING_SEND_TIMEOUT_MS)).toBeNull()
        })

        it('keeps a failure notice for seconds, not minutes', () => {
            const now = Date.now()
            const id = begin()
            failAssistantLineSend(id)

            expect(getPendingAssistantLineSend('project-1')).toMatchObject({ status: PENDING_SEND_FAILED })
            expect(getPendingAssistantLineSend('project-1', null, now + ASSISTANT_FAILED_SEND_DISPLAY_MS)).toBeNull()
            // ...and well before the wait timeout it inherited from.
            expect(ASSISTANT_FAILED_SEND_DISPLAY_MS).toBeLessThan(ASSISTANT_PENDING_SEND_TIMEOUT_MS)
        })

        it('drops a failed send from the store rather than leaving it to be re-shown', () => {
            jest.useFakeTimers()
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
})

function PendingProbe({ projectKey = 'project-1', assistantId = null }) {
    const pending = useAssistantLinePendingSend(projectKey, assistantId)
    return <Text testID="status">{pending ? pending.status : 'none'}</Text>
}
