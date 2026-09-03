import { getObjectDocPath } from '../../../functions/shared/privacyAccess'
import {
    THREAD_ASSISTANT_MODEL_FIELD,
    getThreadAssistantModelOverride,
    normalizeThreadAssistantModelSelection,
} from '../../../functions/Assistant/threadAssistantModel'

/**
 * Reading and writing a thread's pinned assistant model (AT-2502).
 *
 * The field lives on the thread's own host document, beside the `assistantId` and
 * `isAssistantEnabled` that already describe the same thread. The document is addressed through
 * `getObjectDocPath` — the SAME map Cloud Functions use to read the pin back — so a new object
 * type can never be supported on one side only, which is exactly how a write and a read drift
 * into pointing at different documents.
 *
 * The write is a bare field update with no edition data on purpose. It is a setting, not
 * content: stamping `lastEditionDate` would make every other open client re-download a note
 * (AT-2340) and would generate an activity feed entry for choosing a model.
 *
 * Firestore, the offline write helper and the compat namespace are all required LAZILY (the
 * `linkedEmailActions` pattern). This module is reached from the assistant button, which every
 * detail-view header and the task list render — a static `utils/backends/firestore` import would
 * drag the Firebase client and the redux store into every test that merely renders one of those
 * rows, and it does: it broke `DvBotButton`'s existing suites the moment it was static. Only the
 * two path helpers below are eagerly importable, and they are pure.
 */

// Assistant threads are deliberately excluded. An assistant's own board is the one thread whose
// "thread model" and "assistant model" are the same question, and the two sides disagree about
// where an assistant even lives (the app stores assistants as user documents, while
// `getObjectDocPath` maps them to the assistants collection) — so a pin written there would be
// read back from a different document and silently lost. Change it in the assistant's settings.
const UNSUPPORTED_THREAD_TYPES = ['assistants', 'assistant', 'projects', 'project']

export const getThreadAssistantModelDocPath = (projectId, objectId, objectType) => {
    const normalizedType = String(objectType || '').trim()
    if (UNSUPPORTED_THREAD_TYPES.includes(normalizedType)) return null
    return getObjectDocPath(projectId, normalizedType, objectId)
}

export const canOverrideThreadAssistantModel = (projectId, objectId, objectType) =>
    !!getThreadAssistantModelDocPath(projectId, objectId, objectType)

/**
 * The thread's pinned model, or null. Reads never block offline (a `get()` resolves from the
 * local cache) and a failure answers null rather than throwing into a popup that is opening.
 */
export const readThreadAssistantModelOverride = async (projectId, objectId, objectType) => {
    const path = getThreadAssistantModelDocPath(projectId, objectId, objectType)
    if (!path) return null

    try {
        const { getDb } = require('../firestore')
        const doc = await getDb().doc(path).get()
        return doc.exists ? getThreadAssistantModelOverride(doc.data()) : null
    } catch (error) {
        console.warn('[threadAssistantModel] Could not read the thread model override:', error)
        return null
    }
}

/**
 * Pins `selection` on the thread, or clears the pin for the inherit entry / anything the reader
 * would refuse. Returns the value that was actually stored so callers can show it optimistically
 * without re-deriving the normalization.
 */
export const setThreadAssistantModelOverride = async (projectId, objectId, objectType, selection) => {
    const path = getThreadAssistantModelDocPath(projectId, objectId, objectType)
    if (!path) return null

    const model = normalizeThreadAssistantModelSelection(selection)

    try {
        const { getDb } = require('../firestore')
        const { awaitWriteAck } = require('../offlineWriteAck')
        const firebase = require('firebase/compat/app').default

        await awaitWriteAck(
            getDb()
                .doc(path)
                .update({
                    // Clearing removes the field rather than writing null, so a thread that
                    // follows its assistant is byte-identical to one that never had a pin.
                    [THREAD_ASSISTANT_MODEL_FIELD]: model || firebase.firestore.FieldValue.delete(),
                }),
            'setThreadAssistantModelOverride'
        )
    } catch (error) {
        console.warn('[threadAssistantModel] Could not store the thread model override:', error)
    }

    return model
}
