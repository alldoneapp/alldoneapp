import {
    CHAT_RUN_STALE_MS,
    LOCAL_RUN_STALE_MS,
    PENDING_RUN_GRACE_MS,
    SNAPSHOT_SETTLE_MS,
    VM_INTERACTION_STALE_MS,
    VM_RUN_STALE_MS,
    createThreadRunGate,
    evaluateThreadBusy,
    getReleasedMessageCreated,
    isAssistantRunRequestPending,
    isCommentStillProcessing,
} from './threadRunGate'

const NOW = 10 * 24 * 60 * 60 * 1000
const thread = { projectId: 'p', objectType: 'topics', objectId: 'chat' }

describe('what counts as still processing (AT-2922)', () => {
    it.each(['running', 'cancel_requested'])('a chat run comment that is %s', status => {
        expect(
            isCommentStillProcessing({ assistantRun: { kind: 'chat', status }, lastChangeDate: NOW - 1000 }, NOW)
        ).toBe(true)
    })

    it('a chat run between tool rounds, with isLoading already false', () => {
        expect(
            isCommentStillProcessing(
                { isLoading: false, assistantRun: { kind: 'chat', status: 'running' }, created: NOW - 1000 },
                NOW
            )
        ).toBe(true)
    })

    it.each(['queued', 'running', 'awaiting_user', 'cancel_requested'])('a VM job that is %s', status => {
        expect(
            isCommentStillProcessing(
                { isLoading: true, assistantRun: { kind: 'vm_job', status }, lastChangeDate: NOW - 1000 },
                NOW
            )
        ).toBe(true)
    })

    it.each(['completed', 'failed', 'cancelled', 'interrupted'])('not a settled run (%s)', status => {
        expect(
            isCommentStillProcessing({ isLoading: true, assistantRun: { kind: 'vm_job', status }, created: NOW }, NOW)
        ).toBe(false)
    })

    it('a legacy loading comment without run metadata, but not a plain message', () => {
        expect(isCommentStillProcessing({ isLoading: true, created: NOW }, NOW)).toBe(true)
        expect(isCommentStillProcessing({ commentText: 'Hi', created: NOW }, NOW)).toBe(false)
    })

    it('expires a run that stopped reporting, so a crash cannot hold the queue forever', () => {
        const chat = { assistantRun: { kind: 'chat', status: 'running' } }
        expect(isCommentStillProcessing({ ...chat, lastChangeDate: NOW - CHAT_RUN_STALE_MS + 1 }, NOW)).toBe(true)
        expect(isCommentStillProcessing({ ...chat, lastChangeDate: NOW - CHAT_RUN_STALE_MS - 1 }, NOW)).toBe(false)
        const vm = { assistantRun: { kind: 'vm_job', status: 'running' } }
        expect(isCommentStillProcessing({ ...vm, lastChangeDate: NOW - VM_RUN_STALE_MS + 1 }, NOW)).toBe(true)
        expect(isCommentStillProcessing({ ...vm, lastChangeDate: NOW - VM_RUN_STALE_MS - 1 }, NOW)).toBe(false)
        const asking = { assistantRun: { kind: 'vm_job', status: 'awaiting_user' } }
        expect(isCommentStillProcessing({ ...asking, lastChangeDate: NOW - VM_RUN_STALE_MS - 1 }, NOW)).toBe(true)
        expect(isCommentStillProcessing({ ...asking, lastChangeDate: NOW - VM_INTERACTION_STALE_MS - 1 }, NOW)).toBe(
            false
        )
    })

    it('reads Firestore timestamps', () => {
        const lastChangeDate = { toMillis: () => NOW - 1000 }
        expect(isCommentStillProcessing({ assistantRun: { status: 'running' }, lastChangeDate }, NOW)).toBe(true)
    })
})

describe('a run request that has no answer yet', () => {
    const request = { projectId: 'p', objectType: 'topics', objectId: 'chat' }

    it('is pending for a short grace period after the question', () => {
        const question = { id: 'q', created: NOW - 1000, assistantRunRequest: request }
        expect(isAssistantRunRequestPending([question], NOW)).toBe(true)
        expect(isAssistantRunRequestPending([{ ...question, created: NOW - PENDING_RUN_GRACE_MS - 1 }], NOW)).toBe(
            false
        )
    })

    it('ends with an answer, a request this tab saw settle, or a question without a run', () => {
        const question = { id: 'q', created: NOW - 2000, assistantRunRequest: request }
        expect(
            isAssistantRunRequestPending([question, { id: 'a', fromAssistant: true, created: NOW - 1000 }], NOW)
        ).toBe(false)
        expect(isAssistantRunRequestPending([question], NOW, new Set(['q']))).toBe(false)
        expect(isAssistantRunRequestPending([{ id: 'q', created: NOW - 1000 }], NOW)).toBe(false)
    })

    it('ignores the message that is waiting itself', () => {
        const question = { id: 'q', created: NOW - 1000, assistantRunRequest: request }
        expect(isAssistantRunRequestPending([question], NOW, new Set(), 'q')).toBe(false)
    })
})

describe('evaluateThreadBusy', () => {
    it('combines local runs, live comments and pending requests', () => {
        expect(evaluateThreadBusy({ now: NOW })).toBe(false)
        expect(evaluateThreadBusy({ now: NOW, localRuns: [NOW - 1000] })).toBe(true)
        expect(evaluateThreadBusy({ now: NOW, localRuns: [NOW - LOCAL_RUN_STALE_MS - 1] })).toBe(false)
        expect(
            evaluateThreadBusy({
                now: NOW,
                comments: [{ id: 'a', assistantRun: { status: 'running' }, created: NOW - 5 }],
            })
        ).toBe(true)
    })
})

describe('the date a released message gets', () => {
    it('is after the answer it waited for, even when that answer is dated ahead of this clock', () => {
        expect(getReleasedMessageCreated({ comments: [{ created: NOW + 5000 }], now: NOW, waited: true })).toBe(
            NOW + 5001
        )
        expect(getReleasedMessageCreated({ comments: [{ created: NOW - 5000 }], now: NOW, waited: true })).toBe(NOW)
    })

    it('keeps the submission time when it never waited, unless the thread already moved past it', () => {
        expect(
            getReleasedMessageCreated({ comments: [{ created: NOW - 9000 }], now: NOW, originalCreated: NOW - 5000 })
        ).toBe(NOW - 5000)
        expect(
            getReleasedMessageCreated({ comments: [{ created: NOW - 1000 }], now: NOW, originalCreated: NOW - 5000 })
        ).toBe(NOW - 999)
    })
})

describe('waitForThreadIdle', () => {
    let now, watchers, gate
    beforeEach(() => {
        jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick'] })
        jest.setSystemTime(NOW)
        now = NOW
        watchers = []
        gate = createThreadRunGate({
            now: () => now,
            watchThread: (watched, onUpdate) => {
                const watcher = { thread: watched, onUpdate, stopped: false }
                watchers.push(watcher)
                return () => {
                    watcher.stopped = true
                }
            },
        })
    })
    afterEach(() => jest.useRealTimers())
    const snapshot = comments =>
        watchers.at(-1).onUpdate({ recent: comments, live: [], recentReady: true, liveReady: true })

    it('releases at once in an idle thread once the server has answered, and stops watching', async () => {
        const result = jest.fn()
        gate.waitForThreadIdle(thread).then(result)
        await Promise.resolve()
        expect(result).not.toHaveBeenCalled()
        snapshot([])
        await Promise.resolve()
        expect(result).toHaveBeenCalledWith(expect.objectContaining({ status: 'idle', waited: false }))
        expect(watchers[0].stopped).toBe(true)
    })

    it('does not wait forever for a snapshot that never comes', async () => {
        const result = jest.fn()
        gate.waitForThreadIdle(thread).then(result)
        jest.advanceTimersByTime(SNAPSHOT_SETTLE_MS + 20)
        await Promise.resolve()
        expect(result).toHaveBeenCalledWith(expect.objectContaining({ status: 'idle' }))
    })

    it('waits for this tab’s run, then for the answer in the thread, and reports that it waited', async () => {
        const result = jest.fn()
        const onQueued = jest.fn()
        gate.beginThreadRun(thread, 'question-1')
        gate.waitForThreadIdle(thread, { onQueued }).then(result)
        expect(onQueued).toHaveBeenCalledTimes(1)
        const answer = { id: 'answer', assistantRun: { kind: 'chat', status: 'running' }, created: NOW + 10 }
        snapshot([answer])
        gate.settleThreadRun(thread, 'question-1')
        await Promise.resolve()
        expect(result).not.toHaveBeenCalled()
        now += 3000
        snapshot([{ ...answer, assistantRun: { kind: 'chat', status: 'completed' } }])
        await Promise.resolve()
        expect(result).toHaveBeenCalledWith({ status: 'idle', waited: true, created: NOW + 3000 })
        expect(onQueued).toHaveBeenCalledTimes(1)
    })

    it('waits for a VM job the answer started in the thread', async () => {
        const result = jest.fn()
        gate.waitForThreadIdle(thread).then(result)
        const vm = { id: 'vm', isLoading: true, assistantRun: { kind: 'vm_job', status: 'running' }, created: NOW }
        snapshot([vm])
        now += 60 * 60 * 1000
        jest.advanceTimersByTime(60 * 60 * 1000)
        await Promise.resolve()
        expect(result).not.toHaveBeenCalled()
        snapshot([{ ...vm, isLoading: false, assistantRun: { kind: 'vm_job', status: 'completed' } }])
        await Promise.resolve()
        expect(result).toHaveBeenCalledWith(expect.objectContaining({ status: 'idle', waited: true }))
    })

    it('never blocks another conversation', async () => {
        const result = jest.fn()
        gate.beginThreadRun({ ...thread, objectId: 'other' }, 'other-question')
        gate.waitForThreadIdle(thread).then(result)
        snapshot([])
        await Promise.resolve()
        expect(result).toHaveBeenCalledWith(expect.objectContaining({ status: 'idle', waited: false }))
    })

    it('lets the user send now or remove the message while it waits', async () => {
        gate.beginThreadRun(thread, 'question-1')
        let sendNow = false
        let removed = false
        const released = jest.fn()
        const cancelled = jest.fn()
        gate.waitForThreadIdle(thread, { shouldRelease: () => sendNow }).then(released)
        gate.waitForThreadIdle(thread, { shouldCancel: () => removed }).then(cancelled)
        sendNow = true
        removed = true
        gate.notify()
        await Promise.resolve()
        expect(released).toHaveBeenCalledWith(expect.objectContaining({ status: 'released', waited: true }))
        expect(cancelled).toHaveBeenCalledWith(expect.objectContaining({ status: 'cancelled' }))
    })

    it('rejects as cancelled when its owner goes away, so nothing is sent for a signed-out account', async () => {
        gate.beginThreadRun(thread, 'question-1')
        let active = true
        const waiting = gate.waitForThreadIdle(thread, { isActive: () => active })
        active = false
        jest.advanceTimersByTime(5000)
        await expect(waiting).rejects.toMatchObject({ code: 'cancelled' })
    })

    it('treats a listener error as "no information" instead of holding the message', async () => {
        const result = jest.fn()
        gate = createThreadRunGate({
            now: () => now,
            watchThread: () => {
                throw new Error('permission-denied')
            },
        })
        gate.waitForThreadIdle(thread).then(result)
        await Promise.resolve()
        expect(result).toHaveBeenCalledWith(expect.objectContaining({ status: 'idle' }))
    })
})
