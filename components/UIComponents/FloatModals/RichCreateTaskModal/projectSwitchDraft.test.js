/**
 * PT-4745 — what a draft task keeps when the add-task popup changes its project.
 *
 * The switcher is now on every entry point, so a draft started inside a goal or
 * assigned to a colleague can reach a project where those ids mean nothing. Each
 * of these failures is SILENT — the task is created successfully and simply
 * points at, or is visible to, nobody — which is why they are pinned here rather
 * than left to the component.
 */

import { applyProjectSwitchToDraft } from './projectSwitchDraft'

const draft = (overrides = {}) => ({
    name: 'Fix the scroll bug',
    userId: 'me',
    userIds: ['me'],
    currentReviewerId: 'me',
    creatorId: 'me',
    observersIds: [],
    dueDateByObserversIds: {},
    estimationsByObserverIds: {},
    parentGoalId: null,
    parentGoalIsPublicFor: null,
    lockKey: '',
    isPrivate: false,
    isPublicFor: [0],
    suggestedBy: null,
    ...overrides,
})

describe('applyProjectSwitchToDraft', () => {
    it('leaves a draft that owns nothing project-scoped completely alone', () => {
        const task = draft()

        // Same REFERENCE, not just equal: the caller uses this to skip setTask
        // entirely, so a fresh object here would re-render the popup on every
        // press of a project row.
        expect(applyProjectSwitchToDraft(task, 'me')).toBe(task)
    })

    it('drops the parent goal, because a goal id only exists under its own project', () => {
        const task = draft({
            parentGoalId: 'goal-1',
            parentGoalIsPublicFor: ['me'],
            lockKey: 'lock-1',
        })

        const switched = applyProjectSwitchToDraft(task, 'me')

        expect(switched.parentGoalId).toBeNull()
        expect(switched.parentGoalIsPublicFor).toBeNull()
        expect(switched.lockKey).toBe('')
        // The draft itself is never mutated — the popup holds it in state.
        expect(task.parentGoalId).toBe('goal-1')
    })

    it('hands a colleague-assigned draft back to the logged user', () => {
        const task = draft({
            userId: 'colleague',
            userIds: ['colleague'],
            currentReviewerId: 'colleague',
            creatorId: 'colleague',
            suggestedBy: 'me',
        })

        const switched = applyProjectSwitchToDraft(task, 'me')

        expect(switched.userId).toBe('me')
        expect(switched.userIds).toEqual(['me'])
        expect(switched.currentReviewerId).toBe('me')
        expect(switched.creatorId).toBe('me')
        expect(switched.suggestedBy).toBeNull()
    })

    it('treats a workstream assignee the same way — workstreams are project-scoped too', () => {
        const switched = applyProjectSwitchToDraft(
            draft({ userId: 'WS_stream-1', userIds: ['WS_stream-1'], currentReviewerId: 'WS_stream-1' }),
            'me'
        )

        expect(switched.userId).toBe('me')
    })

    it('keeps the assignee when the draft is already the logged user’s', () => {
        const task = draft({ parentGoalId: 'goal-1' })

        const switched = applyProjectSwitchToDraft(task, 'me')

        expect(switched.userId).toBe('me')
        expect(switched.suggestedBy).toBeNull()
    })

    it('clears observers and everything keyed by an observer id', () => {
        const task = draft({
            observersIds: ['colleague', 'other'],
            dueDateByObserversIds: { colleague: 123 },
            estimationsByObserverIds: { colleague: 30 },
        })

        const switched = applyProjectSwitchToDraft(task, 'me')

        expect(switched.observersIds).toEqual([])
        expect(switched.dueDateByObserversIds).toEqual({})
        expect(switched.estimationsByObserverIds).toEqual({})
    })

    it('narrows a private draft to the logged user instead of making it public', () => {
        const switched = applyProjectSwitchToDraft(draft({ isPrivate: true, isPublicFor: ['me', 'colleague'] }), 'me')

        // Losing the audience is recoverable; publishing a task the user marked
        // private is not.
        expect(switched.isPrivate).toBe(true)
        expect(switched.isPublicFor).toEqual(['me'])
    })

    it('leaves a public draft’s privacy untouched', () => {
        const task = draft({ isPrivate: false, isPublicFor: [0] })

        expect(applyProjectSwitchToDraft(task, 'me')).toBe(task)
    })

    it('does not churn a private draft that is already visible to the logged user only', () => {
        const task = draft({ isPrivate: true, isPublicFor: ['me'] })

        expect(applyProjectSwitchToDraft(task, 'me')).toBe(task)
    })

    it('survives a missing draft or logged user rather than throwing inside the popup', () => {
        expect(applyProjectSwitchToDraft(null, 'me')).toBeNull()

        const task = draft({ userId: 'colleague', userIds: ['colleague'] })
        // No logged user resolvable: there is no safe id to reassign to, so the
        // draft is left as it is rather than assigned to `undefined`.
        expect(applyProjectSwitchToDraft(task, undefined)).toBe(task)
    })
})
