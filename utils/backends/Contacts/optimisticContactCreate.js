/**
 * AT-2508 - show a contact the user just added before Firestore echoes it back.
 *
 * Adding a person from the contacts list looked like nothing happened at all. The inline
 * editor tore itself down one statement after firing the write (`addContactToProject` is not
 * awaited), and the list stayed exactly as it was for SECONDS before the new row appeared.
 *
 * The delay is not a slow network, it is structural, and it is the same one AT-2500 documented
 * for tasks. `watchProjectContacts` filters on `readerIds array-contains <me>`, and `readerIds`
 * is a SERVER-DERIVED projection field - the access-hardening rules reject a client write that
 * so much as mentions it (see `accessProjection.js`). A locally created contact therefore
 * carries no `readerIds`, matches that query nowhere, and produces NO local echo whatsoever.
 * The first snapshot that can name it is the one following `onCreateContactSecondGen` ->
 * `synchronizeAccessProjection` writing the projection server-side and it travelling back down.
 *
 * Measured on the reporting account, in production, on the create that produced this task:
 *
 *   12:17:05.256  contact document `createTime` (the client `set()` landed)
 *   12:17:06.05   onCreateContactSecondGen COLD-STARTS (no warm instances any more)
 *   12:17:11.76   the trigger handler finally runs
 *   12:17:12.607  `readerIds` written - the document's `updateTime`
 *
 * 7.35 seconds, plus the trip back down, with the form already gone and an unchanged list on
 * screen. Nothing was broken, which is exactly why it reads as "something went wrong".
 *
 * This module closes that gap. `addContactToProject` publishes the document it is about to
 * write; the contact goes into the SAME redux slice the snapshot writes (`projectContacts`),
 * carrying `isPendingCreation: true` so the list can draw it as a row that is on its way. When
 * the real snapshot finally names the id, the pending copy is dropped in the same pass that
 * delivers the real one - so the row is replaced within a single render and never blinks.
 *
 * Why the redux slice and not an event bus like `optimisticTaskCreate.js`. That module exists
 * because every task list is the *shaped output* of its own watcher (a day-tuple here, a
 * `[goalId, tasks]` grouping there), so there is no canonical slice to insert into and a
 * pending row has to be pushed through each watcher's own pipeline. Contacts have the opposite
 * shape: ONE watcher, one flat `projectContacts[projectId]` array replaced wholesale per
 * snapshot, and all filtering/sorting done downstream in `ContactListByProject`. Inserting one
 * document into that array therefore gets the hashtag filter, the contact-status filter and
 * `sortContactsFn` applied to it for free, and needs no per-view reconciliation.
 *
 * Three properties keep it safe:
 *
 *  - Reconciliation is by IDENTITY, not by timing. A pending entry is retired the moment a
 *    snapshot carries its id, so a duplicate row is impossible by construction rather than by a
 *    de-dupe pass someone has to remember to keep correct. This is also why the row lasts until
 *    the LIST can see the contact rather than until the write is acknowledged: the ack lands
 *    ~7s before the projection does, and retiring on it would produce exactly the row-gap-row
 *    flicker AT-2500 had to undo for tasks.
 *  - Every exit is bounded. The snapshot retires it, an explicitly failed write retires it, and
 *    `PENDING_CONTACT_TIMEOUT_MS` retires it when neither happens. A row that outlived its
 *    creation is a ghost the user cannot interact with, so it may never be able to stick.
 *  - It degrades to today's behaviour. Everything here is additive: with no pending entries
 *    `mergePendingContacts` returns the snapshot array BY REFERENCE, so a project nobody is
 *    creating a contact in does not allocate, does not re-render, and cannot behave differently
 *    from before this existed.
 */

import store from '../../../redux/store'
import { setContactsInProject } from '../../../redux/actions'
import { isPendingContact, PENDING_CONTACT_FLAG } from './pendingContact'

/**
 * Re-exported for the write path and the tests. Views must import it from `./pendingContact`
 * instead - see that module's header for why this one may not be pulled into a component.
 */
export { PENDING_CONTACT_FLAG }

/**
 * Backstop for a create whose access projection never lands at all (a failed
 * `onCreateContactSecondGen`, a long outage). The ordinary case retires within a couple of
 * seconds of the projection arriving - production measured 7.4s worst case above - so this is
 * deliberately far larger than any healthy create, and matches tasks'
 * `SETTLEMENT_WINDOW_TIMEOUT_MS`.
 */
export const PENDING_CONTACT_TIMEOUT_MS = 30000

/** projectId -> Map<contactId, { contact, timeoutId }> */
const pendingByProject = new Map()

const isOffline = () => {
    try {
        // Required lazily: this module is imported by `contactsFirestore`, which the whole app
        // pulls in, and `connectionState` reaches the redux store and the browser listeners.
        return require('../../connectionState').isBrowserOffline()
    } catch (error) {
        return false
    }
}

const getPending = projectId => pendingByProject.get(projectId)

/**
 * Every contact currently in flight for a project. Exported for tests and for callers that need
 * to know whether anything is pending at all.
 */
export const getPendingContacts = projectId => {
    const pending = getPending(projectId)
    return pending ? Array.from(pending.values()).map(entry => entry.contact) : []
}

export const hasPendingContacts = projectId => {
    const pending = getPending(projectId)
    return !!pending && pending.size > 0
}

const clearEntry = (projectId, contactId) => {
    const pending = getPending(projectId)
    if (!pending) return false

    const entry = pending.get(contactId)
    if (!entry) return false

    if (entry.timeoutId) clearTimeout(entry.timeoutId)
    pending.delete(contactId)
    if (pending.size === 0) pendingByProject.delete(projectId)
    return true
}

/**
 * Re-publishes the project's contacts to redux with the current pending set merged in.
 *
 * The settled contacts are recovered by dropping every pending row from what redux holds now,
 * which is what makes this safe to call repeatedly: publishing is idempotent, and a pending row
 * can never be mistaken for a settled one because the only writer of the flag is this module.
 */
const republish = projectId => {
    const state = store.getState()
    const current = (state.projectContacts && state.projectContacts[projectId]) || []
    const settled = current.filter(contact => !isPendingContact(contact))

    store.dispatch(setContactsInProject(projectId, mergePendingContacts(projectId, settled)))
}

const scheduleTimeout = (projectId, contactId) =>
    setTimeout(() => {
        // Offline the projection cannot land, and the write is queued rather than lost - the
        // contact really is created and the local cache holds it. Dropping the row here would
        // claim the opposite, so the window is simply re-armed until the browser is back.
        if (isOffline()) {
            const pending = getPending(projectId)
            const entry = pending && pending.get(contactId)
            if (entry) {
                entry.timeoutId = scheduleTimeout(projectId, contactId)
                return
            }
        }

        if (clearEntry(projectId, contactId)) republish(projectId)
    }, PENDING_CONTACT_TIMEOUT_MS)

/**
 * Puts a contact on screen NOW, before the write goes out.
 *
 * @param projectId the project the contact is being created in
 * @param contactId the id `addContactToProject` minted with `getId()`
 * @param contact   a `mapContactData`-shaped contact. It must be mapped, not the raw document:
 *                  this array is consumed directly by the view, which never maps it again.
 */
export const publishOptimisticContactCreated = (projectId, contactId, contact) => {
    if (!projectId || !contactId || !contact) return

    let pending = getPending(projectId)
    if (!pending) {
        pending = new Map()
        pendingByProject.set(projectId, pending)
    }

    // A re-published id restarts its window rather than doubling it.
    const existing = pending.get(contactId)
    if (existing && existing.timeoutId) clearTimeout(existing.timeoutId)

    pending.set(contactId, {
        contact: { ...contact, uid: contactId, [PENDING_CONTACT_FLAG]: true },
        timeoutId: scheduleTimeout(projectId, contactId),
    })

    republish(projectId)
}

/**
 * Takes the row away again: the write was rejected, so there is no contact and never will be.
 *
 * Idempotent, and silent when the id is not pending - the snapshot may already have retired it,
 * and a rollback arriving after a successful create must not disturb the settled row.
 */
export const publishOptimisticContactCreateFailed = (projectId, contactId) => {
    if (!projectId || !contactId) return
    if (clearEntry(projectId, contactId)) republish(projectId)
}

/**
 * Merges the pending contacts of a project into a settled snapshot list, retiring any whose id
 * the snapshot now carries.
 *
 * Called on the snapshot path, so the replacement of a pending row by its real one happens
 * inside ONE delivery - the list never renders a frame with neither.
 *
 * Returns `contacts` unchanged (the same reference) when nothing is pending, which is every
 * project almost all of the time.
 */
export const mergePendingContacts = (projectId, contacts) => {
    const pending = getPending(projectId)
    if (!pending || pending.size === 0) return contacts

    const list = Array.isArray(contacts) ? contacts : []

    // Retire everything the snapshot can now speak for itself.
    list.forEach(contact => {
        if (contact && contact.uid) clearEntry(projectId, contact.uid)
    })

    const stillPending = getPending(projectId)
    if (!stillPending || stillPending.size === 0) return list

    return [...list, ...Array.from(stillPending.values()).map(entry => entry.contact)]
}

/** Test-only: the pending set is module state, so suites must start from a clean one. */
export const resetOptimisticContactCreates = () => {
    pendingByProject.forEach(pending =>
        pending.forEach(entry => {
            if (entry.timeoutId) clearTimeout(entry.timeoutId)
        })
    )
    pendingByProject.clear()
}
