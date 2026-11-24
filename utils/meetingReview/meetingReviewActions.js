import {
    buildCategoryRuleUpdate,
    buildMeetingReviewUpdate,
    normalizeMeetingTitlePattern,
} from '../../functions/shared/meetingReview/meetingCategorySuggestion'
import { isMeetingCategory, toMeetingDocId } from '../../functions/shared/meetingReview/meetingReviewConstants'
import {
    getMeetingReviewDocId,
    restoreMeetingReview,
    restoreMeetingSeriesCategory,
    saveMeetingCategoryRule,
    saveMeetingReview,
    saveMeetingSeriesCategory,
    deleteMeetingCategoryRule,
} from './meetingReviewBackend'
import {
    getMeetingReviewState,
    patchLocalMeetingReview,
    patchLocalRule,
    patchLocalSeriesCategory,
} from './meetingReviewStore'
import {
    getSeriesCategory,
    getStoredReview,
    isRatableMeetingTask,
    resolveTaskMeetingCategory,
} from './meetingReviewSelectors'

/**
 * AT-3137 — what the sheet, the chip and the detail section do with a user action, in one place.
 */

export { isRatableMeetingTask, getSeriesCategory, getStoredReview, resolveTaskMeetingCategory }

/**
 * Applies one action and returns an `undo()` that restores the previous review, series default and
 * rule exactly as they were.
 *
 * @param {object} params
 * @param {string} params.uid
 * @param {object} params.task calendar task (with projectId)
 * @param {object} params.action see buildMeetingReviewUpdate
 * @param {'series'|'instance'|null} [params.scope] for an explicitly chosen category of a series
 * @param {{actualStartMs:number|null, actualEndMs:number|null}|null} [params.duration] pending
 *   duration change made in the sheet, persisted with the action
 */
export const applyMeetingReviewAction = async ({
    uid,
    task,
    action,
    scope = null,
    duration = null,
    nowMs = Date.now(),
}) => {
    const state = getMeetingReviewState()
    const docId = getMeetingReviewDocId(task.id)
    const previousReview = getStoredReview(task, state)
    const resolved = resolveTaskMeetingCategory(task, state)
    const writes = []
    const undoSteps = []

    const chosenCategory = isMeetingCategory(action.category) ? action.category : null
    const seriesId = task.calendarData?.recurringEventId || null

    if (chosenCategory && seriesId && scope === 'series') {
        const seriesDocId = toMeetingDocId(seriesId)
        const previousSeries = state.seriesCategories[seriesDocId] || null
        if (previousSeries?.category !== chosenCategory) {
            const next = { seriesId, category: chosenCategory, updatedAt: nowMs }
            patchLocalSeriesCategory(seriesDocId, next)
            writes.push(saveMeetingSeriesCategory(uid, seriesId, chosenCategory, nowMs))
            undoSteps.push(() => {
                patchLocalSeriesCategory(seriesDocId, previousSeries)
                return restoreMeetingSeriesCategory(uid, seriesId, previousSeries)
            })
        }
    }

    if (chosenCategory) {
        const pattern = normalizeMeetingTitlePattern(task.name || task.extendedName)
        const previousRule = state.rules.find(rule => rule.pattern === pattern) || null
        const nextRule = buildCategoryRuleUpdate({
            task,
            resolved,
            chosenCategory,
            // A series learns through its series default, never through a title rule: an exception
            // for one occurrence must not turn into a rule for every meeting with that title.
            scope: seriesId ? 'series' : null,
            existingRule: previousRule,
            nowMs,
        })
        if (nextRule) {
            patchLocalRule(nextRule)
            writes.push(saveMeetingCategoryRule(uid, nextRule))
            undoSteps.push(() => {
                if (previousRule) {
                    patchLocalRule(previousRule)
                    return saveMeetingCategoryRule(uid, previousRule)
                }
                patchLocalRule(nextRule, true)
                return deleteMeetingCategoryRule(uid, nextRule.pattern)
            })
        }
    }

    let update = buildMeetingReviewUpdate({ task, resolved, action, existing: previousReview, nowMs })
    if (duration && action.type !== 'not_attended') {
        const durationUpdate = buildMeetingReviewUpdate({
            task,
            resolved,
            action: { type: 'duration', ...duration },
            existing: previousReview,
            nowMs,
        })
        update = {
            ...durationUpdate,
            ...update,
            actualStartMs: durationUpdate.actualStartMs,
            actualEndMs: durationUpdate.actualEndMs,
        }
    }

    const nextReview = { ...(previousReview || {}), ...update }
    patchLocalMeetingReview(docId, nextReview)
    writes.push(saveMeetingReview(uid, task.id, update))
    undoSteps.push(() => {
        patchLocalMeetingReview(docId, previousReview)
        return restoreMeetingReview(uid, task.id, previousReview)
    })

    try {
        await Promise.all(writes)
    } catch (error) {
        // Put the screen back to what is stored, then let the caller tell the user.
        await Promise.all(undoSteps.map(step => Promise.resolve(step()).catch(() => {})))
        throw error
    }

    return {
        review: nextReview,
        undo: () =>
            Promise.all(
                undoSteps
                    .slice()
                    .reverse()
                    .map(step => step())
            ),
    }
}

export const removeMeetingCategoryRule = (uid, rule) => {
    patchLocalRule(rule, true)
    return deleteMeetingCategoryRule(uid, rule.pattern)
}
