/**
 * @jest-environment jsdom
 */

import React from 'react'
import renderer, { act } from 'react-test-renderer'
import { Text } from 'react-native'

import {
    buildLastCommentKey,
    getSeenLastCommentKey,
    markLastCommentSeen,
    resetLastCommentArrivals,
    useLastCommentArrival,
} from './lastCommentArrival'

const Probe = ({ scopeKey, commentKey, commentId = null, isStreaming = false, enabled = true, onArrival }) => {
    const arrival = useLastCommentArrival({ scopeKey, commentKey, commentId, isStreaming, enabled })
    onArrival(arrival)
    return <Text>{String(arrival)}</Text>
}

const renderProbe = props => {
    const seen = []
    let tree
    act(() => {
        tree = renderer.create(<Probe {...props} onArrival={value => seen.push(value)} />)
    })
    return {
        tree,
        arrival: () => seen[seen.length - 1],
        update: nextProps =>
            act(() => {
                tree.update(<Probe {...props} {...nextProps} onArrival={value => seen.push(value)} />)
            }),
    }
}

describe('lastCommentArrival', () => {
    beforeEach(() => {
        resetLastCommentArrivals()
    })

    describe('buildLastCommentKey', () => {
        it('is stable for the same displayed comment', () => {
            const context = { objectType: 'topics', objectId: 'chat-1', commentText: 'All set for tomorrow' }
            expect(buildLastCommentKey(context)).toBe(buildLastCommentKey({ ...context }))
        })

        it('changes when the text changes', () => {
            const first = buildLastCommentKey({ objectType: 'topics', objectId: 'chat-1', commentText: 'One' })
            const second = buildLastCommentKey({ objectType: 'topics', objectId: 'chat-1', commentText: 'Two' })
            expect(first).not.toBe(second)
        })

        it('changes when the same text arrives in another chat', () => {
            const first = buildLastCommentKey({ objectType: 'topics', objectId: 'chat-1', commentText: 'Done' })
            const second = buildLastCommentKey({ objectType: 'topics', objectId: 'chat-2', commentText: 'Done' })
            expect(first).not.toBe(second)
        })

        it('is null until there is a comment to show', () => {
            expect(buildLastCommentKey({ objectType: 'topics', objectId: 'chat-1', commentText: null })).toBeNull()
            expect(buildLastCommentKey({ objectType: 'topics', objectId: 'chat-1' })).toBeNull()
        })

        // The cache path and the watcher path must produce the same key for the same text, or the
        // handover a second after every load would read as an arrival.
        it('does not depend on where the comment came from', () => {
            const fromCache = buildLastCommentKey({ objectType: 'tasks', objectId: 't1', commentText: 'Same text' })
            const fromWatcher = buildLastCommentKey({ objectType: 'tasks', objectId: 't1', commentText: 'Same text' })
            expect(fromCache).toBe(fromWatcher)
        })

        it('bounds the key regardless of comment length', () => {
            const key = buildLastCommentKey({
                objectType: 'topics',
                objectId: 'chat-1',
                commentText: 'x'.repeat(5000),
            })
            expect(key.length).toBeLessThan(64)
        })
    })

    describe('useLastCommentArrival', () => {
        it('stays quiet on the first comment a scope ever shows', () => {
            const probe = renderProbe({ scopeKey: 'user-1:allProjects', commentKey: 'a' })
            expect(probe.arrival()).toBeNull()
            expect(getSeenLastCommentKey('user-1:allProjects')).toBe('a')
        })

        it('reports an arrival when the shown comment changes', () => {
            const probe = renderProbe({ scopeKey: 'user-1:allProjects', commentKey: 'a' })
            probe.update({ commentKey: 'b' })
            expect(probe.arrival()).toEqual(expect.any(Number))
        })

        it('does not repeat for a re-render with the same comment', () => {
            const probe = renderProbe({ scopeKey: 'user-1:allProjects', commentKey: 'a' })
            probe.update({ commentKey: 'b' })
            const firstArrival = probe.arrival()
            probe.update({ commentKey: 'b' })
            expect(probe.arrival()).toBe(firstArrival)
        })

        it('restarts the motion for a second arrival instead of swallowing it', () => {
            const probe = renderProbe({ scopeKey: 'user-1:allProjects', commentKey: 'a' })
            probe.update({ commentKey: 'b' })
            const firstArrival = probe.arrival()
            probe.update({ commentKey: 'c' })
            expect(probe.arrival()).toBeGreaterThan(firstArrival)
        })

        // A comment landing in another chat remounts the subtree (LastComment keys on the chat id),
        // which is precisely why the memory cannot live in the component.
        it('survives a remount, so a comment in another chat still animates', () => {
            renderProbe({ scopeKey: 'user-1:allProjects', commentKey: 'chat-1-text' })
            const remounted = renderProbe({ scopeKey: 'user-1:allProjects', commentKey: 'chat-2-text' })
            expect(remounted.arrival()).toEqual(expect.any(Number))
        })

        it('stays quiet when a remount shows the comment that was already on screen', () => {
            renderProbe({ scopeKey: 'user-1:allProjects', commentKey: 'same' })
            const remounted = renderProbe({ scopeKey: 'user-1:allProjects', commentKey: 'same' })
            expect(remounted.arrival()).toBeNull()
        })

        it('keeps scopes independent, so another slot cannot spend this one’s first paint', () => {
            renderProbe({ scopeKey: 'user-1:project-a', commentKey: 'a' })
            const other = renderProbe({ scopeKey: 'user-1:project-b', commentKey: 'a' })
            expect(other.arrival()).toBeNull()
            expect(getSeenLastCommentKey('user-1:project-a')).toBe('a')
            expect(getSeenLastCommentKey('user-1:project-b')).toBe('a')
        })

        it('records nothing while the slot has no comment yet', () => {
            const probe = renderProbe({ scopeKey: 'user-1:allProjects', commentKey: null })
            expect(probe.arrival()).toBeNull()
            expect(getSeenLastCommentKey('user-1:allProjects')).toBeNull()
        })

        it('treats the skeleton → first comment transition as a first paint', () => {
            const probe = renderProbe({ scopeKey: 'user-1:allProjects', commentKey: null })
            probe.update({ commentKey: 'a' })
            expect(probe.arrival()).toBeNull()
        })

        // Disabled slots (the compact chip when it is opted out) must still RECORD, or expanding
        // the row afterwards would animate a comment the user has already read.
        it('records while disabled but never reports', () => {
            const probe = renderProbe({ scopeKey: 'user-1:allProjects', commentKey: 'a', enabled: false })
            probe.update({ commentKey: 'b' })
            expect(probe.arrival()).toBeNull()
            expect(getSeenLastCommentKey('user-1:allProjects')).toBe('b')
        })

        it('is unaffected by a missing scope key', () => {
            const probe = renderProbe({ scopeKey: null, commentKey: 'a' })
            expect(probe.arrival()).toBeNull()
        })
    })

    describe('markLastCommentSeen', () => {
        it('ignores incomplete records rather than storing a partial key', () => {
            markLastCommentSeen('scope', null)
            markLastCommentSeen(null, 'key')
            expect(getSeenLastCommentKey('scope')).toBeNull()
        })
    })

    /**
     * AT-2511 follow-up — a streamed answer is watched, not announced.
     *
     * The state machine in isolation. The end-to-end suite proves the run flags travel from the
     * watcher documents to here; these cases pin what happens once they arrive, including the two
     * boundaries that are easy to get wrong: the settling write (same comment, new text) and the
     * abandoned stream (a record that must not outlive its answer).
     */
    describe('streaming', () => {
        const SCOPE = 'user-1:allProjects'

        it('reports no arrival for any chunk of a streamed answer', () => {
            const probe = renderProbe({ scopeKey: SCOPE, commentKey: 'previous' })
            const chunks = ['c1', 'c2', 'c3', 'c4', 'c5']

            chunks.forEach(commentKey => {
                probe.update({ commentKey, commentId: 'answer-1', isStreaming: true })
                expect(probe.arrival()).toBeNull()
            })
        })

        it('still records each chunk as seen, so nothing is owed an animation afterwards', () => {
            const probe = renderProbe({ scopeKey: SCOPE, commentKey: 'previous' })
            probe.update({ commentKey: 'chunk-2', commentId: 'answer-1', isStreaming: true })

            expect(getSeenLastCommentKey(SCOPE)).toBe('chunk-2')
        })

        // The settling write carries the full text, which is normally longer than the last text
        // written while live — a new key at the exact moment the user finished watching it appear.
        it('reports no arrival when the streamed comment settles with different text', () => {
            const probe = renderProbe({ scopeKey: SCOPE, commentKey: 'previous' })
            probe.update({ commentKey: 'partial', commentId: 'answer-1', isStreaming: true })
            probe.update({ commentKey: 'complete', commentId: 'answer-1', isStreaming: false })

            expect(probe.arrival()).toBeNull()
        })

        it('reports an arrival for the next comment after a stream settles', () => {
            const probe = renderProbe({ scopeKey: SCOPE, commentKey: 'previous' })
            probe.update({ commentKey: 'partial', commentId: 'answer-1', isStreaming: true })
            probe.update({ commentKey: 'complete', commentId: 'answer-1', isStreaming: false })
            probe.update({ commentKey: 'next', commentId: 'answer-2', isStreaming: false })

            expect(probe.arrival()).toEqual(expect.any(Number))
        })

        // The user never watched this one appear here, so it is a genuine arrival.
        it('reports an arrival for a settled comment this scope never watched stream', () => {
            const probe = renderProbe({ scopeKey: SCOPE, commentKey: 'previous' })
            probe.update({ commentKey: 'landed', commentId: 'answer-1', isStreaming: false })

            expect(probe.arrival()).toEqual(expect.any(Number))
        })

        it('does not let an abandoned stream suppress that comment arriving later', () => {
            const probe = renderProbe({ scopeKey: SCOPE, commentKey: 'previous' })
            probe.update({ commentKey: 'partial', commentId: 'answer-1', isStreaming: true })
            // Something else takes the slot before the stream settles.
            probe.update({ commentKey: 'other', commentId: 'answer-2', isStreaming: false })
            const afterOther = probe.arrival()
            probe.update({ commentKey: 'complete', commentId: 'answer-1', isStreaming: false })

            expect(probe.arrival()).toBeGreaterThan(afterOther)
        })

        // The suppression is keyed on the comment id, so a stream in one slot cannot silence a
        // different comment that happens to settle in another.
        it('keeps the streaming record per scope', () => {
            renderProbe({ scopeKey: 'scope-a', commentKey: 'seed-a' }).update({
                commentKey: 'partial',
                commentId: 'answer-1',
                isStreaming: true,
            })
            const other = renderProbe({ scopeKey: 'scope-b', commentKey: 'seed-b' })
            other.update({ commentKey: 'complete', commentId: 'answer-1', isStreaming: false })

            expect(other.arrival()).toEqual(expect.any(Number))
        })
    })
})
