import { useSyncExternalStore } from 'react'

/**
 * AT-3137 — one small client store for the private meeting review data and the rating prompt.
 *
 * Deliberately not redux: a task row only needs "the review of THIS task", and keeping a whole
 * per-user map in redux would re-render every row on every rating (the state-and-performance rule
 * about whole maps). Rows subscribe through `useMeetingReviewSelector`, which re-renders a row only
 * when its own selected value changes.
 *
 * One set of Firestore listeners per signed-in user, attached by MeetingReviewHost:
 *   - reviews of appointments from 120 days ago to 30 days ahead (the chip on done tasks)
 *   - series defaults and learned rules (small collections)
 * The statistics screen reads older periods itself.
 */

const DAY_MS = 24 * 60 * 60 * 1000
export const MEETING_REVIEW_LIVE_PAST_MS = 120 * DAY_MS
export const MEETING_REVIEW_LIVE_FUTURE_MS = 30 * DAY_MS

const initialState = () => ({
    uid: null,
    reviews: {},
    seriesCategories: {},
    rules: [],
    queue: [],
    queueMode: false,
    toast: null,
})

let state = initialState()
const listeners = new Set()
let unsubscribers = []

const emit = () => listeners.forEach(listener => listener())

export const getMeetingReviewState = () => state

export const setMeetingReviewState = patch => {
    state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) }
    emit()
}

export const subscribeMeetingReviewStore = listener => {
    listeners.add(listener)
    return () => listeners.delete(listener)
}

export const useMeetingReviewSelector = selector =>
    useSyncExternalStore(
        subscribeMeetingReviewStore,
        () => selector(state),
        () => selector(state)
    )

export const stopMeetingReviewSubscriptions = () => {
    unsubscribers.forEach(unsubscribe => {
        try {
            unsubscribe()
        } catch (error) {}
    })
    unsubscribers = []
    state = initialState()
    emit()
}

export const startMeetingReviewSubscriptions = (uid, nowMs = Date.now()) => {
    if (!uid) {
        stopMeetingReviewSubscriptions()
        return
    }
    if (state.uid === uid && unsubscribers.length > 0) return
    stopMeetingReviewSubscriptions()
    state = { ...initialState(), uid }
    // Required lazily: task rows import this store, and must not load the Firestore backend.
    const {
        watchMeetingCategoryRules,
        watchMeetingReviewsInRange,
        watchMeetingSeriesCategories,
    } = require('./meetingReviewBackend')
    const fromMs = nowMs - MEETING_REVIEW_LIVE_PAST_MS
    const toMs = nowMs + MEETING_REVIEW_LIVE_FUTURE_MS
    const isInLiveWindow = review =>
        typeof review?.startMs === 'number' && review.startMs >= fromMs && review.startMs < toMs
    // A failing listener (no Firestore client yet, permission error) must never take the app shell
    // down: without it the chip and sheet simply have no stored data.
    try {
        const started = [
            // The snapshot is authoritative inside its window (so an undo that deletes a review shows);
            // reviews of older appointments, opened from the Done list, are kept from local patches.
            watchMeetingReviewsInRange(uid, fromMs, toMs, reviews =>
                setMeetingReviewState(current => {
                    const outside = {}
                    Object.entries(current.reviews).forEach(([docId, review]) => {
                        if (!isInLiveWindow(review)) outside[docId] = review
                    })
                    return { reviews: { ...outside, ...reviews } }
                })
            ),
            watchMeetingSeriesCategories(uid, seriesCategories => setMeetingReviewState({ seriesCategories })),
            watchMeetingCategoryRules(uid, rules => setMeetingReviewState({ rules })),
        ]
        unsubscribers = started
    } catch (error) {
        console.error('[meetingReview] could not attach the review listeners', error)
        unsubscribers = []
    }
    emit()
}

/** Optimistic local copy, so the chip updates at once (also offline). */
export const patchLocalMeetingReview = (docId, review) =>
    setMeetingReviewState(current => {
        const reviews = { ...current.reviews }
        if (review) reviews[docId] = { ...review, docId }
        else delete reviews[docId]
        return { reviews }
    })

export const patchLocalSeriesCategory = (docId, value) =>
    setMeetingReviewState(current => {
        const seriesCategories = { ...current.seriesCategories }
        if (value) seriesCategories[docId] = { ...value, docId }
        else delete seriesCategories[docId]
        return { seriesCategories }
    })

export const patchLocalRule = (rule, remove = false) =>
    setMeetingReviewState(current => ({
        rules: [...current.rules.filter(item => item.pattern !== rule.pattern), ...(remove ? [] : [rule])],
    }))

// ---- rating prompt queue (concept 2.2: after quick successive completions the sheet shows the
// latest one, "+N more" opens the others one after the other) ----

/**
 * @param {{task:object, projectId:string, origin?:string}} request
 */
export const requestMeetingReview = request => {
    if (!request?.task?.id) return
    setMeetingReviewState(current => ({
        queue: [...current.queue.filter(item => item.task.id !== request.task.id), request],
    }))
}

export const finishCurrentMeetingReview = () =>
    setMeetingReviewState(current => {
        const queue = current.queue.slice(0, -1)
        // Outside queue mode, closing the sheet leaves the others unrated without asking again now.
        return current.queueMode ? { queue, queueMode: queue.length > 0 } : { queue: [], queueMode: false }
    })

export const startMeetingReviewQueueMode = () => setMeetingReviewState({ queueMode: true })

export const showMeetingReviewToast = toast =>
    setMeetingReviewState({ toast: toast ? { ...toast, id: Date.now() } : null })

export const resetMeetingReviewStoreForTests = () => {
    unsubscribers = []
    state = initialState()
    emit()
}
