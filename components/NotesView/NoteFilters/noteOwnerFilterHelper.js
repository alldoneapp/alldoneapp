import store from '../../../redux/store'
import { WORKSTREAM_ID_PREFIX } from '../../Workstreams/WorkstreamHelper'
import { getAssistantFromState } from '../../AdminPanel/Assistants/assistantStateLookup'

/**
 * Helpers backing the notes list owner filter (AT-2194).
 *
 * A note's owner is `note.userId`. Historically that was always a human project member;
 * since AT-2194 an assistant-created note carries the assistant id there instead, while
 * `note.creatorId` keeps recording the human who asked for it. Everything here therefore
 * has to resolve an owner id against project users AND assistants (plus contacts and
 * workstreams, which can already own notes through the note DV assignee picker), and must
 * degrade gracefully for legacy notes whose owner no longer resolves to anything.
 */

export const NOTE_OWNER_UNASSIGNED = '__noteOwnerUnassigned__'

/** The owner id of a note, or NOTE_OWNER_UNASSIGNED for notes that never had one. */
export const getNoteOwnerId = note => {
    const ownerId = note?.userId
    return typeof ownerId === 'string' && ownerId !== '' ? ownerId : NOTE_OWNER_UNASSIGNED
}

/**
 * Look an owner id up across every entity that can own a note in the project, then fall back
 * to an assistant from any other project the user has loaded.
 *
 * Returns null only when nothing matches at all (a removed member, or an assistant living in
 * a project this user is not a member of).
 */
export const findNoteOwnerInProject = (projectId, ownerId) => {
    if (!ownerId || ownerId === NOTE_OWNER_UNASSIGNED) return null

    const { projectUsers, projectAssistants, globalAssistants, projectContacts, projectWorkstreams } = store.getState()

    const user = projectUsers?.[projectId]?.find(item => item.uid === ownerId)
    if (user) return { ...user, isAssistant: false }

    const projectAssistant = projectAssistants?.[projectId]?.find(item => item.uid === ownerId)
    if (projectAssistant) return { ...projectAssistant, isAssistant: true }

    // Global assistants are only offered in projects that opted into them, but a note may
    // already be owned by one, so resolve it regardless of the project's current opt-in.
    const globalAssistant = globalAssistants?.find(item => item.uid === ownerId)
    if (globalAssistant) return { ...globalAssistant, isAssistant: true }

    const contact = projectContacts?.[projectId]?.find(item => item.uid === ownerId)
    if (contact) return { ...contact, isAssistant: false }

    const workstream = projectWorkstreams?.[projectId]?.find(item => item.uid === ownerId)
    if (workstream) return { ...workstream, isAssistant: false, isWorkstream: true }

    // Last: an assistant from ANOTHER of the user's projects (AT-2194 production bug).
    //
    // An object in project A legitimately keeps an assistant from the user's default project
    // — that is deliberate, long-standing behaviour, not drift (see
    // `getAssignedAssistantInProjectContext` in `AdminPanel/Assistants/assistantsHelper.js`:
    // "Objects can keep using an assistant from the user's default project even when they
    // live in another project"). The Mac menubar meeting-notes flow does exactly this: the
    // assistant that transcribes and summarises the meeting is the user's default assistant,
    // and it owns the note it produced no matter which project the note is filed into.
    //
    // Every other owner/author resolver in the app already handles that with a cross-project
    // assistant fallback — `getUserPresentationDataInProject` (ContactsHelper, used by the
    // feeds and chat lists) and `TasksHelper.getTaskOwner` both fall back to `getAssistant`.
    // This helper was the one place that stopped at the project boundary, which is why the
    // feed entry read "Anna Alldone has created the note" while the notes list right next to
    // it rendered the literal "Unknown" owner chip for the same note.
    //
    // Note the asymmetry, which is intentional and mirrors the established resolvers: only
    // ASSISTANTS get a cross-project fallback. A human/contact/workstream from another
    // project is not a meaningful owner here and still resolves to nothing.
    const crossProjectAssistant = getAssistantFromState(store.getState(), ownerId)
    if (crossProjectAssistant) return { ...crossProjectAssistant, isAssistant: true }

    return null
}

/**
 * The owner a note should keep when it is moved into `targetProjectId`.
 *
 * Humans, contacts and workstreams are project-scoped: a member of project A means nothing in
 * project B, where it would render as the "Unknown" owner chip, so such an owner is handed
 * back to the acting user. An ASSISTANT owner survives the move, because assistants resolve
 * across the user's projects (see `findNoteOwnerInProject`) and the assistant that produced a
 * note keeps having produced it after the note is filed somewhere else.
 *
 * Historically this was a plain "is the owner one of the target project's *users*" check,
 * which silently stripped ownership from every assistant-owned note (AT-2194) because an
 * assistant is not a project user.
 */
export const resolveMovedNoteOwnerId = (targetProjectId, ownerId, actingUserId) => {
    if (!ownerId || ownerId === NOTE_OWNER_UNASSIGNED) return actingUserId
    return findNoteOwnerInProject(targetProjectId, ownerId) ? ownerId : actingUserId
}

/**
 * Resolve an owner id to something renderable.
 *
 * Returns `{ uid, displayName, photoURL, isAssistant, isWorkstream }`. Never returns null,
 * so callers can render an avatar for an owner that has left the project or for a note
 * created before owners were tracked.
 */
export const resolveNoteOwner = (projectId, ownerId) => {
    if (!ownerId || ownerId === NOTE_OWNER_UNASSIGNED) {
        return { uid: NOTE_OWNER_UNASSIGNED, displayName: 'No owner', photoURL: '', isAssistant: false }
    }

    const owner = findNoteOwnerInProject(projectId, ownerId)
    if (owner) return owner

    // Unknown owner. Keep the id so the avatar fallback stays stable instead of collapsing
    // every unknown owner into one chip.
    return {
        uid: ownerId,
        displayName: 'Unknown',
        photoURL: '',
        isAssistant: false,
        isWorkstream: ownerId.startsWith(WORKSTREAM_ID_PREFIX),
    }
}

/** Flatten the `{ 'YYYYMMDD': [note] }` bucket map the notes list keeps in state. */
export const flattenNotesByDate = notesByDate =>
    notesByDate && typeof notesByDate === 'object' ? Object.values(notesByDate).flat() : []

/**
 * Count notes per owner across the loaded date buckets and sticky notes.
 * Returns `{ counts: { [ownerId]: number }, total, ownerIds }` with ownerIds ordered by
 * descending count, then alphabetically, so the chip row is stable between renders.
 */
export const collectNoteOwnerCounts = (notesByDate, stickyNotes = []) => {
    const allNotes = [...flattenNotesByDate(notesByDate), ...(Array.isArray(stickyNotes) ? stickyNotes : [])]

    const counts = {}
    const seenNoteIds = new Set()
    let total = 0

    for (const note of allNotes) {
        if (!note) continue
        // A sticky note can also appear in a date bucket; count it once.
        if (note.id != null) {
            if (seenNoteIds.has(note.id)) continue
            seenNoteIds.add(note.id)
        }
        const ownerId = getNoteOwnerId(note)
        counts[ownerId] = (counts[ownerId] || 0) + 1
        total++
    }

    const ownerIds = Object.keys(counts).sort((a, b) => {
        if (counts[b] !== counts[a]) return counts[b] - counts[a]
        return a < b ? -1 : a > b ? 1 : 0
    })

    return { counts, total, ownerIds }
}

const noteMatchesOwners = (note, ownerIds) => ownerIds.includes(getNoteOwnerId(note))

/**
 * Filter the date-bucket map by owner. Buckets that end up empty are dropped so the list
 * does not render a date header with nothing under it. An empty/absent filter returns the
 * original reference untouched (PureComponent-friendly).
 */
export const filterNotesByOwner = (notesByDate, ownerIds) => {
    if (!Array.isArray(ownerIds) || ownerIds.length === 0) return notesByDate
    if (!notesByDate || typeof notesByDate !== 'object') return notesByDate

    const filtered = {}
    for (const [dateKey, notes] of Object.entries(notesByDate)) {
        const matching = (notes || []).filter(note => noteMatchesOwners(note, ownerIds))
        if (matching.length > 0) filtered[dateKey] = matching
    }
    return filtered
}

/** Filter the flat sticky-notes array by owner. */
export const filterStickyNotesByOwner = (stickyNotes, ownerIds) => {
    if (!Array.isArray(ownerIds) || ownerIds.length === 0) return stickyNotes
    if (!Array.isArray(stickyNotes)) return stickyNotes
    return stickyNotes.filter(note => noteMatchesOwners(note, ownerIds))
}
