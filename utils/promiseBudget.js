const defaultWait = ms => new Promise(resolve => setTimeout(resolve, ms))

/**
 * Bound a promise by a wall-clock budget (AT-2367).
 *
 * Used where the UI must move on regardless of how long some best-effort work
 * takes: the "Start new day" acknowledgement writes and the pre-reload
 * housekeeping in `deleteCacheAndRefresh`. A budget is NOT a cancellation —
 * the underlying work keeps running, it simply stops being able to hold the
 * user hostage. That distinction matters for Firestore writes: with IndexedDB
 * persistence the mutation is already durable in the local queue, so letting a
 * pending server ack fall out of the critical path never loses the write.
 *
 * A rejection is swallowed on purpose: every caller here has already decided
 * the work is best effort, and an unhandled rejection from a promise nobody is
 * awaiting any more is noise (or, in tests, a failure).
 *
 * @param {Promise|*} work the promise to bound
 * @param {number} budgetMs milliseconds to wait before continuing without it
 * @param {(ms: number) => Promise} wait injectable timer (tests)
 * @returns {Promise<boolean>} `true` if the work settled inside the budget
 */
export const settleWithinBudget = (work, budgetMs, wait = defaultWait) => {
    const settled = Promise.resolve(work).then(
        () => true,
        () => true
    )

    if (!(budgetMs > 0)) return Promise.resolve(false)

    return Promise.race([settled, wait(budgetMs).then(() => false)])
}

export default settleWithinBudget
