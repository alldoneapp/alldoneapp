import { intersection, uniq } from 'lodash'
import firebase from 'firebase/compat/app'

import {
    createGenericTaskWhenMentionInTitleEdition,
    createNoteFeedsChain,
    createNoteUpdatedFeedsChain,
    deleteLinkedGuidesNotesIfProjectIsTemplate,
    deleteNoteFeedsChain,
    getDb,
    getId,
    getMentionedUsersIdsWhenEditText,
    getNoteData,
    logEvent,
    notesStorage,
    removeNoteFromInnerTasks,
    setNoteOwnerFeedsChain,
    setNoteProjectFeedsChain,
    startEditNoteFeedsChain,
    trackStickyNote,
    untrackStickyNote,
    updateNoteHighlightFeedsChain,
    updateNotePrivacyFeedsChain,
    updateNoteStickyDataFeedsChain,
    updateNoteTitleFeedsChain,
    updateNotesEditedDailyList,
} from '../firestore'
import { createNoteAssistantChangedFeed } from './noteUpdates'
import store from '../../../redux/store'
import { isBrowserOffline } from '../../connectionState'
import { getServerNow } from '../../serverClock'
import { clearPendingNoteUpload, registerPendingNoteUpload } from '../../Notes/pendingNoteUploads'
import { stampCreatorAsFollower } from './noteCreationFollow'
import ProjectHelper from '../../../components/SettingsView/ProjectsSettings/ProjectHelper'

import { createGenericTaskWhenMention, setTaskNote } from '../Tasks/tasksFirestore'
import TasksHelper, { GENERIC_NOTE_TYPE } from '../../../components/TaskListView/Utils/TasksHelper'
import { FEED_PUBLIC_FOR_ALL } from '../../../components/Feeds/Utils/FeedsConstants'
import { BatchWrapper } from '../../../functions/BatchWrapper/batchWrapper'
import { getLinkedTasksIdsFromText } from '../../../components/Feeds/CommentsTextInput/textInputHelper'
import { processMovedNoteTasks } from '../../../components/NotesView/NotesDV/EditorView/notesHelper'
import { CURRENT_DAY_VERSION_ID } from '../../../components/UIComponents/FloatModals/RevisionHistoryModal/RevisionHistoryModal'
import { updateGoalNote } from '../Goals/goalsFirestore'
import { resolveMovedNoteOwnerId } from '../../../components/NotesView/NoteFilters/noteOwnerFilterHelper'
import { setUserNote } from '../Users/usersFirestore'
import { updateContactNote } from '../Contacts/contactsFirestore'
import { updateSkillNote } from '../Skills/skillsFirestore'
import { updateAssistantNote } from '../Assistants/assistantsFirestore'
import {
    updateChatAssistantWithoutFeeds,
    updateChatNote,
    updateChatPrivacy,
    updateChatTitleWithoutFeeds,
} from '../Chats/chatsFirestore'
import NavigationService from '../../NavigationService'
import {
    setSelectedNavItem,
    setSelectedSidebarTab,
    setSelectedTypeOfProject,
    switchProject,
} from '../../../redux/actions'
import { DV_TAB_NOTE_PROPERTIES, DV_TAB_ROOT_NOTES } from '../../TabNavigationConstants'
import { CROSS_PROJECT_DESTINATION_WRITE, withoutServerAccessProjection } from '../accessProjection'

export const updateNoteEditionData = async (projectId, noteId, editorId) => {
    await getDb().runTransaction(async transaction => {
        const ref = getDb().doc(`noteItems/${projectId}/notes/${noteId}`)
        const doc = await transaction.get(ref)
        if (doc.exists) transaction.update(ref, { lastEditionDate: Date.now(), lastEditorId: editorId })
    })
}

const updateEditionData = async data => {
    const { loggedUser } = store.getState()
    // No round trip in either branch since AT-2340: the online path used to
    // write+read the global `/info/currentTime` singleton on every autosave, and
    // the offline path could not do it at all (the ack only arrives on
    // reconnect). Both now read the background-measured server-clock offset,
    // falling back to the client clock — which is what `created` already uses.
    data.lastEditionDate = isBrowserOffline() ? Date.now() : getServerNow()
    data.lastEditorId = loggedUser.uid
}

const isPlainObject = value => {
    if (!value || Object.prototype.toString.call(value) !== '[object Object]') return false
    const prototype = Object.getPrototypeOf(value)
    return prototype === Object.prototype || prototype === null
}

const sanitizeForFirestore = value => {
    if (value === undefined) return undefined
    if (Array.isArray(value)) {
        return value.map(item => sanitizeForFirestore(item)).filter(item => item !== undefined)
    }
    if (isPlainObject(value)) {
        const cleaned = {}
        Object.entries(value).forEach(([key, nestedValue]) => {
            const safeNestedValue = sanitizeForFirestore(nestedValue)
            if (safeNestedValue !== undefined) cleaned[key] = safeNestedValue
        })
        return cleaned
    }
    return value
}

async function updateNoteData(projectId, noteId, data, batch) {
    await updateEditionData(data)
    const ref = getDb().doc(`noteItems/${projectId}/notes/${noteId}`)
    batch ? batch.update(ref, data) : await ref.update(data)
}

/**
 * AT-2488 — the work a freshly created note still needs, run in the background.
 *
 * Every item here is a side effect OF a note that already exists: the note
 * document has been written (and, online, server-acked) before this runs. None
 * of them is a precondition for opening the note — feeds/sticky/mention writes
 * are all about what happens *around* the note, and `logEvent` is analytics.
 * Awaiting them only made the user wait on a blank screen, and — worse — a
 * failure in any of them used to reject `uploadNewNote` for a note that had in
 * fact been created, which the caller then reported as "creation failed".
 *
 * So each one is settled independently and reports rather than throws. The
 * offline branch already worked exactly this way (a server ack cannot arrive
 * offline, AT-2340), so this makes the online path match a shape that has been
 * in production for the whole offline-support era.
 *
 * The empty Storage seed put is deliberately NOT here — see `uploadNewNote`.
 */
const runNewNoteSideEffects = (projectId, noteId, noteDataCopy) => {
    const settle = (label, work) => {
        const report = error => console.warn(`[notes] ${label} failed for ${noteId} (the note was created):`, error)
        try {
            Promise.resolve(work()).catch(report)
        } catch (error) {
            // A side effect that throws synchronously must not take the others down.
            report(error)
        }
    }

    const { stickyEndDate } = noteDataCopy.stickyData || {}
    if (stickyEndDate > 0) settle('sticky tracking', () => trackStickyNote(projectId, noteId, stickyEndDate))

    settle('feeds chain', () => createNoteFeedsChain(projectId, noteId, noteDataCopy))

    settle('mention tasks', () => {
        // Resolved here rather than by the caller: a project that is missing from
        // the store must not fail a note that is already written.
        const project = ProjectHelper.getProjectById(projectId)
        const mentionedUserIds = intersection(
            project ? project.userIds : [],
            getMentionedUsersIdsWhenEditText(noteDataCopy.extendedTitle, '')
        )

        return createGenericTaskWhenMention(
            projectId,
            noteId,
            mentionedUserIds,
            GENERIC_NOTE_TYPE,
            'notes',
            noteDataCopy.assistantId
        )
    })

    settle('analytics', () => logEvent('new_note', { id: noteId, uid: noteDataCopy.userId }))
}

export async function uploadNewNote(projectId, noteData) {
    try {
        await updateEditionData(noteData)

        // Creator-follows-own-note is stamped at creation so the note is
        // immediately visible in the Followed notes tab — offline, the feeds
        // chain that normally establishes it only completes on reconnect.
        const noteDataCopy = stampCreatorAsFollower({ ...noteData })
        const noteId = noteDataCopy.id ? noteDataCopy.id : getId()

        // Offline, every server ack in this function is deferred until reconnect,
        // so awaiting one would hang note creation forever. Firestore applies the
        // writes to the local cache instantly (and syncs them later), which is all
        // the offline editor needs (OFFLINE_SUPPORT_PLAN.md notes follow-ups).
        const browserIsOffline = isBrowserOffline()

        // The empty content object, started HERE so it runs concurrently with the
        // document write below rather than after it — and awaited once that write
        // is done. It is the one piece of this function that cannot simply be left
        // in the background: `setNoteData` overwrites the same Storage path, the
        // editor autosaves 3s after it opens, and the note opens the moment this
        // function resolves. A seed put still in flight at that point would land
        // AFTER the user's first save and blank what they had just typed. Awaiting
        // it costs nothing in the normal case (it has had the whole document write
        // to finish) and only costs time exactly when not awaiting would be unsafe.
        const emptyContentUpload = Promise.resolve()
            .then(() => notesStorage.ref().child(`notesData/${projectId}/${noteId}`).put(new Uint8Array()))
            .catch(error =>
                // Still best-effort: the editor tolerates a missing object through
                // `allowEmptyOpen` (a brand-new note has no `preview`).
                console.warn(`[notes] empty content upload failed for ${noteId} (the note was created):`, error)
            )

        // Set the initial document data with a retry mechanism. This is the ONE
        // thing the caller has to wait for: it is what makes the note exist.
        const setNoteDoc = () =>
            getDb()
                .collection(`noteItems/${projectId}/notes`)
                .doc(noteId)
                .set(sanitizeForFirestore({ ...noteDataCopy, title: noteDataCopy.title.toLowerCase() }))

        if (browserIsOffline) {
            // Fire without awaiting the server ack; the local cache applies it
            // immediately and the queued write syncs on reconnect.
            setNoteDoc().catch(error => console.warn(`Offline note doc write failed for ${noteId}:`, error))
        } else {
            const maxRetries = 3
            let attempt = 0
            let noteDocSet = false

            while (attempt < maxRetries && !noteDocSet) {
                try {
                    await setNoteDoc()
                    noteDocSet = true
                } catch (error) {
                    if (error.code === 'failed-precondition' && attempt < maxRetries - 1) {
                        await new Promise(resolve => setTimeout(resolve, 1000)) // Wait 1 second before retry
                        attempt++
                        continue
                    }
                    throw error
                }
            }
        }

        // Offline this can never settle (Storage has no offline queue at all), so
        // awaiting it would hang note creation — the same reason the document write
        // above is not awaited offline. Nothing is lost: the local y-indexeddb copy
        // is durable and `NotesOfflineCatchUp` uploads it on reconnect.
        if (!browserIsOffline) await emptyContentUpload

        // No verification read (AT-2488): online, the awaited `set()` above only
        // resolves on the server ack, so re-reading the document proved nothing
        // and cost a full extra round trip on the critical path between the user
        // pressing Enter and the note opening.
        runNewNoteSideEffects(projectId, noteId, noteDataCopy)

        return { ...noteDataCopy, id: noteId }
    } catch (error) {
        console.error('Error creating note:', error)
        throw error
    }
}

export async function deleteNote(projectId, note, externalBatch) {
    const batch = externalBatch ? externalBatch : new BatchWrapper(getDb())
    if (note.parentObject) {
        const { type, id } = note.parentObject

        if (type === 'tasks') {
            await setTaskNote(projectId, id, null)
        } else if (type === 'goals') {
            await updateGoalNote(projectId, id, null)
        } else if (type === 'users') {
            await setUserNote(projectId, id, null)
        } else if (type === 'contacts') {
            await updateContactNote(projectId, id, null)
        } else if (type === 'topics') {
            await updateChatNote(projectId, id, null)
        } else if (type === 'skills') {
            updateSkillNote(projectId, id, null)
        } else if (type === 'assistants') {
            await updateAssistantNote(projectId, id, null)
        }
    }

    batch.delete(getDb().doc(`noteItems/${projectId}/notes/${note.id}`))
    deleteNoteFeedsChain(projectId, note, note.id)

    if (!externalBatch) await batch.commit()
}

export async function updateNoteMeta(projectId, tmpNote, note) {
    await updateNoteData(
        projectId,
        note.id,
        { title: tmpNote.title.toLowerCase(), extendedTitle: tmpNote.extendedTitle },
        null
    )

    await updateNotesEditedDailyList(projectId, note.id)

    if (tmpNote.stickyData.stickyEndDate !== note.stickyData.stickyEndDate) {
        const { stickyEndDate } = tmpNote.stickyData
        await (stickyEndDate > 0 ? trackStickyNote(projectId, note.id, stickyEndDate) : untrackStickyNote(note.id))
    }

    await createNoteUpdatedFeedsChain(projectId, note.id, tmpNote, note)
    createGenericTaskWhenMentionInTitleEdition(
        projectId,
        note.id,
        tmpNote.extendedTitle,
        note.extendedTitle,
        GENERIC_NOTE_TYPE,
        'notes',
        tmpNote.assistantId
    )
}

export const setNoteAssistant = async (projectId, noteId, assistantId, needGenerateUpdate) => {
    const batch = new BatchWrapper(getDb())
    await updateNoteData(projectId, noteId, { assistantId }, batch)
    await updateChatAssistantWithoutFeeds(projectId, noteId, assistantId, batch)
    await batch.commit()
    if (needGenerateUpdate) await createNoteAssistantChangedFeed(projectId, assistantId, noteId, null, null)
}

export async function updateNoteStickyData(projectId, noteId, stickyData) {
    updateNoteData(projectId, noteId, { stickyData }, null)
    const { stickyEndDate, days } = stickyData
    stickyEndDate > 0 ? trackStickyNote(projectId, noteId, stickyEndDate) : untrackStickyNote(noteId)
    updateNoteStickyDataFeedsChain(projectId, days, noteId)
}

export async function updateNoteShared(projectId, noteId, shared) {
    updateNoteData(projectId, noteId, { shared }, null)
}

export async function updateNoteTitle(projectId, noteId, title, note) {
    const cleanedTitle = TasksHelper.getTaskNameWithoutMeta(title)

    updateNoteData(projectId, noteId, { title: cleanedTitle.toLowerCase(), extendedTitle: title }, null)

    updateChatTitleWithoutFeeds(projectId, noteId, title)

    updateNotesEditedDailyList(projectId, note.id)

    updateNoteTitleFeedsChain(projectId, note, title, noteId)

    createGenericTaskWhenMentionInTitleEdition(
        projectId,
        noteId,
        title,
        note.extendedTitle,
        GENERIC_NOTE_TYPE,
        'notes',
        note.assistantId
    )
}

export async function updateNoteTitleWithoutFeed(projectId, noteId, title, externalBatch) {
    const batch = externalBatch ? externalBatch : new BatchWrapper(getDb())
    const cleanedTitle = TasksHelper.getTaskNameWithoutMeta(title)

    await updateNoteData(projectId, noteId, { title: cleanedTitle.toLowerCase(), extendedTitle: title }, batch)
    updateNotesEditedDailyList(projectId, noteId)
    !externalBatch && batch.commit()
}

export async function updateNotePrivacy(projectId, noteId, isPrivate, isPublicFor, followersIds, isTopicNote, note) {
    const updateData = {
        isPrivate: isPrivate,
        isPublicFor: isPublicFor,
        isVisibleInFollowedFor: isPublicFor.includes(FEED_PUBLIC_FOR_ALL)
            ? [...followersIds]
            : isPublicFor.filter(userId => followersIds.includes(userId)),
    }

    await updateNoteData(projectId, noteId, updateData, null)
    !isTopicNote && updateChatPrivacy(projectId, noteId, 'notes', isPublicFor)
    updateNotePrivacyFeedsChain(projectId, isPrivate, isPublicFor, noteId)

    if (note && note.isPublicFor.includes(FEED_PUBLIC_FOR_ALL) && !isPublicFor.includes(FEED_PUBLIC_FOR_ALL)) {
        deleteLinkedGuidesNotesIfProjectIsTemplate(projectId, note)
    }
}

export async function updateNoteHighlight(projectId, noteId, hasStar) {
    const isHighlight = hasStar.toLowerCase() !== '#ffffff'
    updateNoteData(projectId, noteId, { hasStar }, null)
    updateNoteHighlightFeedsChain(projectId, isHighlight, noteId)
}

/**
 * Persist note content.
 *
 * `options.contentOnly` uploads the Yjs state and NOTHING else — no preview, no
 * `lastEditionDate`/`lastEditorId`, no edited-today entry, no started-editing
 * feed. It exists for content this client merely RECEIVED (a collaborator's
 * edits arriving over the Yjs binding): persisting the merged document is a
 * durability safety net, but recording the local user as its last editor is
 * simply false, and it made every open client pay the full save fan-out for
 * text somebody else typed (AT-2340).
 */
export async function setNoteData(
    objectId,
    noteId,
    encodedStateData,
    preview,
    firstEditionRef,
    userCanEditNote,
    options = {}
) {
    const { contentOnly = false } = options
    const storageRef = notesStorage.ref()
    // Fire-and-forget on purpose, but an offline failure must not surface as an
    // unhandled rejection: the content is durable in the editor's local
    // IndexedDB copy and is re-uploaded on reconnect / next online open.
    //
    // Firebase Storage has no offline write queue (unlike Firestore) — a failed
    // put is simply gone — so the note is recorded for the reconnect catch-up
    // sweep, which is what makes an offline edit to a note the user then CLOSES
    // reach the server without waiting for them to open it again (AT-2340).
    const contentUploaded = Promise.resolve(storageRef.child(`notesData/${objectId}/${noteId}`).put(encodedStateData))
        .then(() => {
            clearPendingNoteUpload(noteId)
            return true
        })
        .catch(error => {
            console.warn(`Note content upload failed for ${noteId} (will catch up when back online):`, error)
            registerPendingNoteUpload(objectId, noteId)
            return false
        })

    if (!contentOnly) {
        if (userCanEditNote) {
            updateNoteData(objectId, noteId, { preview }, null)
        }

        updateNotesEditedDailyList(objectId, noteId)

        if (firstEditionRef && firstEditionRef.current) {
            firstEditionRef.current = false
            userCanEditNote && startEditNoteFeedsChain(objectId, noteId)
        }
    }

    // Resolves to whether the canonical Storage copy actually received the
    // content. Callers may ignore it (most do); the editor uses it to know a
    // catch-up is outstanding without guessing from connectivity.
    return contentUploaded
}

export const updateNoteLastCommentData = async (projectId, noteId, lastComment, lastCommentType) => {
    getDb()
        .doc(`noteItems/${projectId}/notes/${noteId}`)
        .update({
            [`commentsData.lastComment`]: lastComment,
            [`commentsData.lastCommentType`]: lastCommentType,
            [`commentsData.amount`]: firebase.firestore.FieldValue.increment(1),
        })
}

export const resetNoteLastCommentData = async (projectId, noteId) => {
    const ref = getDb().doc(`noteItems/${projectId}/notes/${noteId}`)
    const doc = await ref.get()
    if (doc.exists) {
        const data = doc.data()
        if (data.commentsData && data.commentsData.amount > 0) {
            ref.update({
                [`commentsData.lastComment`]: null,
                [`commentsData.lastCommentType`]: null,
                [`commentsData.amount`]: 0,
            })
        }
    }
}

export function increaseNoteViews(projectId, noteId) {
    getDb()
        .doc(`noteItems/${projectId}/notes/${noteId}`)
        .update({ views: firebase.firestore.FieldValue.increment(1) })
}

export async function setNoteProject(currentProject, newProject, note, oldAssignee, newAssignee) {
    const { loggedUser, projectUsers, route } = store.getState()

    const newProjectUsers = projectUsers[newProject.id]

    const noteId = note.id
    const storageRef = notesStorage.ref()
    const data = await getNoteData(currentProject.id, noteId)

    const batch = new BatchWrapper(getDb())
    const linkedParentTasksIds = getLinkedTasksIdsFromText(note.extendedTitle, currentProject.id)
    const stateUpdate = await processMovedNoteTasks(
        currentProject.id,
        newProject.id,
        noteId,
        data,
        linkedParentTasksIds,
        batch
    )
    await storageRef.child(`notesData/${newProject.id}/${noteId}`).put(stateUpdate)
    removeNoteFromInnerTasks(currentProject.id, noteId)

    if (note.versionId !== CURRENT_DAY_VERSION_ID) {
        const defaultStorageRef = firebase.storage().ref()
        getDb().doc(`noteItemsDailyVersions/${currentProject.id}/notes/${noteId}`).delete()
        defaultStorageRef.child(`noteDailyVersionsData/${currentProject.id}/${noteId}`).delete()
    }

    const newProjectUserIds = (newProjectUsers || []).map(user => user.uid)
    const creatorId = newProjectUserIds.includes(note.creatorId) ? note.creatorId : loggedUser.uid
    // An assistant can own a note since AT-2194, and an assistant is not a project *user*, so
    // a plain member check silently handed the note back to the acting human on every move.
    // Keep the owner whenever it still resolves in the target project (member, assistant,
    // global assistant, contact or workstream); only fall back when it would become an
    // unresolvable "Unknown" owner over there.
    const userId = resolveMovedNoteOwnerId(newProject.id, note.userId, loggedUser.uid)

    const noteMeta = {
        ...note,
        title: note.title.toLowerCase(),
        versionId: CURRENT_DAY_VERSION_ID,
        followersIds: uniq([creatorId, userId]),
        isPrivate: false,
        isPublicFor: [FEED_PUBLIC_FOR_ALL],
        linkedParentTasksIds,
        stickyData: {
            days: 0,
            stickyEndDate: 0,
        },
        userId,
        creatorId,
    }
    delete noteMeta.id
    delete noteMeta.state

    await updateEditionData(noteMeta)
    batch.set(
        getDb().doc(`noteItems/${newProject.id}/notes/${noteId}`),
        withoutServerAccessProjection(sanitizeForFirestore({ ...noteMeta, movingToOtherProjectId: null })),
        CROSS_PROJECT_DESTINATION_WRITE
    )
    batch.delete(getDb().doc(`noteItems/${currentProject.id}/notes/${noteId}`))

    await getDb()
        .doc(`noteItems/${currentProject.id}/notes/${noteId}`)
        .update({ movingToOtherProjectId: newProject.id })
    await batch.commit()
    if (route === 'NotesDetailedView') {
        NavigationService.navigate('NotesDetailedView', {
            noteId: noteId,
            projectId: newProject.id,
        })

        const projectType = ProjectHelper.getTypeOfProject(loggedUser, newProject.id)
        store.dispatch([
            setSelectedSidebarTab(DV_TAB_ROOT_NOTES),
            switchProject(newProject.index),
            setSelectedTypeOfProject(projectType),
            setSelectedNavItem(DV_TAB_NOTE_PROPERTIES),
        ])
    }
    await setNoteProjectFeedsChain(oldAssignee, newAssignee, newProject, currentProject, note, noteId)
}

export async function setNoteOwner(projectId, noteId, uid, oldOwner, newOwner, note, generatedFeeds, externalBatch) {
    const batch = externalBatch ? externalBatch : new BatchWrapper(getDb())

    // if (generatedFeeds) {
    //     const { loggedUser: feedCreator } = store.getState()
    //     const feedChainFollowersIds = [feedCreator.uid]
    //     addUniqueInstanceTypeToArray(feedChainFollowersIds, newOwner.uid)
    //     batch.feedChainFollowersIds = feedChainFollowersIds
    //
    //     await createTaskAssigneeChangedFeed(projectId, note, newOwner, oldOwner, noteId, batch)
    //     const followTaskData = {
    //         followObjectsType: FOLLOWER_TASKS_TYPE,
    //         followObjectId: noteId,
    //         followObject: note,
    //         feedCreator,
    //     }
    //     await tryAddFollower(projectId, followTaskData, batch)
    //     if (feedCreator.uid !== newOwner.uid) {
    //         followTaskData.feedCreator = newOwner
    //         await tryAddFollower(projectId, followTaskData, batch)
    //     }
    // }

    await updateNoteData(projectId, note.id, { userId: uid }, batch)
    if (!externalBatch) {
        batch.commit()
    }

    setNoteOwnerFeedsChain(projectId, note, newOwner, oldOwner, noteId)
}
