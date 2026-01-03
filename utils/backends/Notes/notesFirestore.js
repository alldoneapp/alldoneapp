import { intersection, uniq } from 'lodash'
import { firebase } from '@firebase/app'

import {
    createGenericTaskWhenMentionInTitleEdition,
    createNoteFeedsChain,
    createNoteUpdatedFeedsChain,
    deleteLinkedGuidesNotesIfProjectIsTemplate,
    deleteNoteFeedsChain,
    getDb,
    getFirebaseTimestampDirectly,
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
import ProjectHelper from '../../../components/SettingsView/ProjectsSettings/ProjectHelper'

import { createGenericTaskWhenMention, setTaskNote } from '../Tasks/tasksFirestore'
import TasksHelper, { GENERIC_NOTE_TYPE } from '../../../components/TaskListView/Utils/TasksHelper'
import { FEED_PUBLIC_FOR_ALL } from '../../../components/Feeds/Utils/FeedsConstants'
import { BatchWrapper } from '../../../functions/BatchWrapper/batchWrapper'
import { getLinkedTasksIdsFromText } from '../../../components/Feeds/CommentsTextInput/textInputHelper'
import { processMovedNoteTasks } from '../../../components/NotesView/NotesDV/EditorView/notesHelper'
import { CURRENT_DAY_VERSION_ID } from '../../../components/UIComponents/FloatModals/RevisionHistoryModal/RevisionHistoryModal'
import { updateGoalNote } from '../Goals/goalsFirestore'
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

export const updateNoteEditionData = async (projectId, noteId, editorId) => {
    await getDb().runTransaction(async transaction => {
        const ref = getDb().doc(`noteItems/${projectId}/notes/${noteId}`)
        const doc = await transaction.get(ref)
        if (doc.exists) transaction.update(ref, { lastEditionDate: Date.now(), lastEditorId: editorId })
    })
}

const updateEditionData = async data => {
    const { loggedUser } = store.getState()
    data.lastEditionDate = await getFirebaseTimestampDirectly()
    data.lastEditorId = loggedUser.uid
}

async function updateNoteData(projectId, noteId, data, batch) {
    await updateEditionData(data)
    const ref = getDb().doc(`noteItems/${projectId}/notes/${noteId}`)
    batch ? batch.update(ref, data) : await ref.update(data)
}

export async function uploadNewNote(projectId, noteData) {
    try {
        await updateEditionData(noteData)

        const noteDataCopy = { ...noteData }
        const noteId = noteDataCopy.id ? noteDataCopy.id : getId()

        // Create an empty document first to ensure it exists
        const doc = new Uint8Array()
        const storageRef = notesStorage.ref()

        // Create an array to track all promises that need to complete
        const promises = []

        // Add storage operation to promises
        promises.push(storageRef.child(`notesData/${projectId}/${noteId}`).put(doc))

        // Set the initial document data with a retry mechanism
        const maxRetries = 3
        let attempt = 0
        let noteDocSet = false

        while (attempt < maxRetries && !noteDocSet) {
            try {
                await getDb()
                    .collection(`noteItems/${projectId}/notes`)
                    .doc(noteId)
                    .set({ ...noteDataCopy, title: noteDataCopy.title.toLowerCase() })
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

        const { stickyEndDate } = noteDataCopy.stickyData
        if (stickyEndDate > 0) {
            promises.push(trackStickyNote(projectId, noteId, stickyEndDate))
        }

        // Add feed chain creation to promises
        promises.push(createNoteFeedsChain(projectId, noteId, noteDataCopy))

        const project = ProjectHelper.getProjectById(projectId)
        const mentionedUserIds = intersection(
            project.userIds,
            getMentionedUsersIdsWhenEditText(noteDataCopy.extendedTitle, '')
        )

        promises.push(
            createGenericTaskWhenMention(
                projectId,
                noteId,
                mentionedUserIds,
                GENERIC_NOTE_TYPE,
                'notes',
                noteDataCopy.assistantId
            )
        )

        // Wait for all operations to complete
        await Promise.all(promises)

        // Log event after everything is complete
        await logEvent('new_note', {
            id: noteId,
            uid: noteData.userId,
        })

        // Verify the note exists in the database before returning
        const noteExists = await getDb().doc(`noteItems/${projectId}/notes/${noteId}`).get()
        if (!noteExists.exists) {
            throw new Error('Note creation verification failed')
        }

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
    updateNoteData(
        projectId,
        note.id,
        { title: tmpNote.title.toLowerCase(), extendedTitle: tmpNote.extendedTitle },
        null
    )

    updateNotesEditedDailyList(projectId, note.id)

    if (tmpNote.stickyData.stickyEndDate !== note.stickyData.stickyEndDate) {
        const { stickyEndDate } = tmpNote.stickyData
        stickyEndDate > 0 ? trackStickyNote(projectId, note.id, stickyEndDate) : untrackStickyNote(note.id)
    }

    createNoteUpdatedFeedsChain(projectId, note.id, tmpNote, note)
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
    batch.commit()
    if (needGenerateUpdate) createNoteAssistantChangedFeed(projectId, assistantId, noteId, null, null)
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

export async function setNoteData(objectId, noteId, encodedStateData, preview, firstEditionRef, userCanEditNote) {
    const storageRef = notesStorage.ref()
    storageRef.child(`notesData/${objectId}/${noteId}`).put(encodedStateData)

    if (userCanEditNote) {
        updateNoteData(objectId, noteId, { preview }, null)
    }

    updateNotesEditedDailyList(objectId, noteId)

    if (firstEditionRef.current) {
        firstEditionRef.current = false
        userCanEditNote && startEditNoteFeedsChain(objectId, noteId)
    }
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

    const creatorId = newProjectUsers.map(user => user.uid).includes(note.creatorId) ? note.creatorId : loggedUser.uid
    const userId = newProjectUsers.map(user => user.uid).includes(note.userId) ? note.userId : loggedUser.uid

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

    updateEditionData(noteMeta)
    batch.set(getDb().doc(`noteItems/${newProject.id}/notes/${noteId}`), noteMeta)
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
