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
    isInThreadVmHandoffStarting,
    isRunHandedOffElsewhere,
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

// AT-3058: the request stays open while the model waits for the VM it handed off. Only a VM in the
// SAME thread may hold the next message; one hosted in another task must not.
const handoff = ({ runId = 'question-1', inThread, at = NOW - 1000, ...rest } = {}) => ({
    id: `handoff-${runId}`,
    fromAssistant: true,
    vmHandoff: true,
    ...(inThread === undefined ? {} : { vmHandoffInThread: inThread }),
    assistantRun: { kind: 'chat', status: 'completed', triggerMessageId: runId, completedAt: at },
    created: at - 20000,
    ...rest,
})
const vmStatus = (status, created = NOW - 500) => ({
    id: 'vm-status',
    isLoading: status !== 'completed',
    assistantRun: { kind: 'vm_job', runId: 'vm-1', status },
    created,
    lastChangeDate: created,
})

describe('a request handed off to a VM (AT-3058)', () => {
    it('is handed off once its newest answer is a completed handoff to a VM in another object', () => {
        expect(isRunHandedOffElsewhere('question-1', [handoff({ inThread: false })])).toBe(true)
    })

    it('is still running when the VM is in this thread, or the server did not say where it is', () => {
        expect(isRunHandedOffElsewhere('question-1', [handoff({ inThread: true })])).toBe(false)
        expect(isRunHandedOffElsewhere('question-1', [handoff()])).toBe(false)
    })

    it('only counts the answer to its own request', () => {
        expect(isRunHandedOffElsewhere('question-2', [handoff({ inThread: false })])).toBe(false)
    })

    it('holds again while its follow-up summary is written, and keeps the decision once out of view', () => {
        const followup = {
            id: 'followup',
            fromAssistant: true,
            assistantRun: { kind: 'chat', status: 'running', triggerMessageId: 'question-1' },
            created: NOW,
        }
        expect(isRunHandedOffElsewhere('question-1', [handoff({ inThread: false }), followup], true)).toBe(false)
        expect(isRunHandedOffElsewhere('question-1', [], true)).toBe(true)
        expect(isRunHandedOffElsewhere('question-1', [], false)).toBe(false)
    })

    it('a handoff to a VM in this thread holds until the VM status comment exists, on every device', () => {
        expect(isInThreadVmHandoffStarting([handoff({ inThread: true })], NOW)).toBe(true)
        expect(isInThreadVmHandoffStarting([handoff({ inThread: true }), vmStatus('running')], NOW)).toBe(false)
        expect(evaluateThreadBusy({ now: NOW, comments: [handoff({ inThread: true })] })).toBe(true)
        expect(evaluateThreadBusy({ now: NOW, comments: [handoff({ inThread: true }), vmStatus('running')] })).toBe(
            true
        )
        expect(evaluateThreadBusy({ now: NOW, comments: [handoff({ inThread: true }), vmStatus('completed')] })).toBe(
            false
        )
    })

    it('a handoff to a VM elsewhere, an old handoff and an expired one do not hold the thread', () => {
        expect(evaluateThreadBusy({ now: NOW, comments: [handoff({ inThread: false })] })).toBe(false)
        expect(evaluateThreadBusy({ now: NOW, comments: [handoff()] })).toBe(false)
        expect(
            evaluateThreadBusy({
                now: NOW,
                comments: [handoff({ inThread: true, at: NOW - PENDING_RUN_GRACE_MS - 1 })],
            })
        ).toBe(false)
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

    it('does not wait for a VM this tab’s request handed off to another task (AT-3058)', async () => {
        const result = jest.fn()
        const onQueued = jest.fn()
        gate.beginThreadRun(thread, 'question-1')
        gate.waitForThreadIdle(thread, { onQueued, excludeId: 'next' }).then(result)
        snapshot([{ id: 'question-1', assistantRunRequest: thread, created: NOW - 30000 }])
        await Promise.resolve()
        expect(result).not.toHaveBeenCalled()
        // The request is still open (the model polls the VM), but its answer is a finished handoff.
        snapshot([
            { id: 'question-1', assistantRunRequest: thread, created: NOW - 30000 },
            handoff({ inThread: false }),
        ])
        await Promise.resolve()
        expect(result).toHaveBeenCalledWith(expect.objectContaining({ status: 'idle' }))
        // The decision sticks once the watcher is gone, so the next message is not shown as queued.
        expect(gate.isThreadBusyLocally(thread)).toBe(false)
    })

    it('keeps waiting for a VM this tab’s request started in the same thread (AT-3058)', async () => {
        const result = jest.fn()
        gate.beginThreadRun(thread, 'question-1')
        gate.waitForThreadIdle(thread).then(result)
        snapshot([handoff({ inThread: true })])
        now += 1000
        jest.advanceTimersByTime(1000)
        snapshot([handoff({ inThread: true }), vmStatus('running', now)])
        await Promise.resolve()
        expect(result).not.toHaveBeenCalled()
        // The request ends (the summary is written) while the VM status still reads running.
        gate.settleThreadRun(thread, 'question-1')
        await Promise.resolve()
        expect(result).not.toHaveBeenCalled()
        snapshot([handoff({ inThread: true }), vmStatus('completed', now)])
        await Promise.resolve()
        expect(result).toHaveBeenCalledWith(expect.objectContaining({ status: 'idle', waited: true }))
    })

    it('a stale completion settles only its own request, never a newer one (AT-3058)', async () => {
        const result = jest.fn()
        gate.beginThreadRun(thread, 'question-1')
        gate.beginThreadRun(thread, 'question-2')
        gate.waitForThreadIdle(thread).then(result)
        snapshot([handoff({ inThread: false })])
        gate.settleThreadRun(thread, 'question-1')
        await Promise.resolve()
        expect(result).not.toHaveBeenCalled()
        gate.settleThreadRun(thread, 'question-2')
        await Promise.resolve()
        expect(result).toHaveBeenCalledWith(expect.objectContaining({ status: 'idle' }))
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
