import moment from 'moment'
import v4 from 'uuid/v4'

import { getDb, runHttpsCallableFunction } from '../firestore'
import { reverseUndoAction } from '../../undo/undoActions'

/**
 * AT-3142 — client side of "Plan my day". The server (`applyDailyPlanSecondGen`,
 * functions/Tasks/dailyPlanService.js) decides everything that is written; this only sends the
 * reviewed decisions and reads back the plan record and its undo action.
 */

export const getLocalPlanDateKey = (nowMs = Date.now()) => moment(nowMs).format('YYYY-MM-DD')

/**
 * `tasks` comes from `buildApplyTasks` (utils/dailyPlan/dailyPlanModel.js). One requestId per Apply
 * press makes the write idempotent if the call is retried. Online-only: the callable funnel throws
 * `code: 'offline'` immediately when there is no connection.
 */
export const applyDailyPlan = (tasks, { requestId = v4(), nowMs = Date.now() } = {}) =>
    runHttpsCallableFunction(
        'applyDailyPlanSecondGen',
        {
            requestId,
            timezoneOffset: moment(nowMs).utcOffset(),
            localDateKey: getLocalPlanDateKey(nowMs),
            tasks,
        },
        { timeout: 120000 }
    )

/** Today's applied plan record (null when none). Owner-readable, server-written. */
export const watchDailyPlan = (userId, dateKey, callback) =>
    getDb()
        .doc(`users/${userId}/dailyPlans/${dateKey}`)
        .onSnapshot(
            doc => callback(doc.exists ? doc.data() : null),
            error => {
                console.warn('[dailyPlan] plan record could not be read', error?.message)
                callback(null)
            }
        )

/** 'applied' | 'undone' | null (expired or missing) for the plan's undo record. */
export const watchDailyPlanUndoStatus = (userId, actionId, callback) =>
    getDb()
        .doc(`users/${userId}/undoActions/${actionId}`)
        .onSnapshot(
            doc => callback(doc.exists ? doc.data()?.status || null : null),
            () => callback(null)
        )

/** Same path as the Undo bar: the server restores only what the plan changed. */
export const undoDailyPlan = actionId => reverseUndoAction(actionId, 'undo')
