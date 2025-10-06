import { firebase } from '@firebase/app'

import TasksHelper from '../../../components/TaskListView/Utils/TasksHelper'
import {
    deleteFolderFilesInStorage,
    getDb,
    getId,
    globalWatcherUnsub,
    logEvent,
    proccessPictureForAvatar,
    uploadAvatarPhotos,
} from '../firestore'
import { BatchWrapper } from '../../../functions/BatchWrapper/batchWrapper'
import store from '../../../redux/store'
import { setAssistantsInProject, setGlobalAssistants, startLoadingData, stopLoadingData } from '../../../redux/actions'
import {
    GLOBAL_PROJECT_ID,
    TYPE_3RD_PARTY,
    TYPE_PROMPT_BASED,
    isGlobalAssistant,
} from '../../../components/AdminPanel/Assistants/assistantsHelper'
import {
    assistantDescriptionChangedUpdatesChain,
    assistantInstructionsChangedUpdatesChain,
    assistantModelChangedUpdatesChain,
    assistantNameChangedUpdatesChain,
    assistantPictureChangedUpdatesChain,
    assistantTemperatureChangedUpdatesChain,
    assistantTypeChangedUpdatesChain,
    createAssistantUpdatesChain,
    deleteAssistantUpdatesChain,
    updateAssistantFeedsChain,
} from './assistantUpdates'
import { updateNoteTitleWithoutFeed } from '../Notes/notesFirestore'
import { updateChatTitleWithoutFeeds } from '../Chats/chatsFirestore'
import ProjectHelper from '../../../components/SettingsView/ProjectsSettings/ProjectHelper'

//ACCESS FUNCTIONS

export async function getAssistantData(projectId, assistantId) {
    const assistant = (await getDb().doc(`assistants/${projectId}/items/${assistantId}`).get()).data()
    if (assistant) assistant.uid = assistantId
    return assistant
}

export async function getGlobalAssistants() {
    const assistantDocs = (
        await getDb().collection(`assistants/${GLOBAL_PROJECT_ID}/items`).orderBy('lastEditionDate', 'desc').get()
    ).docs
    const assistants = []
    assistantDocs.forEach(doc => {
        const assistant = doc.data()
        assistant.uid = doc.id
        assistants.push(assistant)
    })
    return assistants
}

export function watchAssistants(projectId, watcherKey, callback) {
    let firstSnap = true
    store.dispatch(startLoadingData())
    globalWatcherUnsub[watcherKey] = getDb()
        .collection(`assistants/${projectId}/items`)
        .orderBy('lastEditionDate', 'desc')
        .onSnapshot(assistantDocs => {
            let assistants = []
            assistantDocs.forEach(doc => {
                const assistant = doc.data()
                assistant.uid = doc.id
                assistants.push(assistant)
            })
            callback(assistants)
            if (firstSnap) {
                firstSnap = false
                store.dispatch(stopLoadingData())
            }
        })
}

export function watchAssistant(projectId, assistantId, watcherKey, callback) {
    let firstSnap = true
    store.dispatch(startLoadingData())
    globalWatcherUnsub[watcherKey] = getDb()
        .doc(`assistants/${projectId}/items/${assistantId}`)
        .onSnapshot(doc => {
            const assistant = doc.data()
            if (assistant) assistant.uid = doc.id

            callback(assistant)
            if (firstSnap) {
                firstSnap = false
                store.dispatch(stopLoadingData())
            }
        })
}

export async function getProjectAssistants(projectId) {
    const assistantDocs = (await getDb().collection(`assistants/${projectId}/items`).get()).docs

    const assistants = []
    assistantDocs.forEach(doc => {
        const assistant = doc.data()
        assistant.uid = doc.id
        assistants.push(assistant)
    })

    return assistants
}

export function watchAssistantTasks(projectId, assistantId, watcherKey, callback) {
    let firstSnap = true
    store.dispatch(startLoadingData())
    globalWatcherUnsub[watcherKey] = getDb()
        .collection(`assistantTasks/${projectId}/preConfigTasks`)
        .where('assistantId', '==', assistantId)
        .orderBy('type', 'desc')
        .orderBy('order', 'asc')
        .onSnapshot(assistantDocs => {
            let tasks = []
            assistantDocs.forEach(doc => {
                const task = doc.data()
                task.id = doc.id
                tasks.push(task)
            })
            callback(tasks)
            if (firstSnap) {
                firstSnap = false
                store.dispatch(stopLoadingData())
            }
        })
}

//EDTION AND ADITION FUNCTIONS

export const updateAssistantEditionData = async (projectId, assistantId, editorId) => {
    await getDb().runTransaction(async transaction => {
        const ref = getDb().doc(`assistants/${projectId}/items/${assistantId}`)
        const doc = await transaction.get(ref)
        if (doc.exists) transaction.update(ref, { lastEditionDate: Date.now(), lastEditorId: editorId })
    })
}

const updateEditionData = data => {
    const { loggedUser } = store.getState()
    data.lastEditionDate = Date.now()
    data.lastEditorId = loggedUser.uid
}

async function updateAssistantData(projectId, assistantId, data, batch) {
    updateEditionData(data)
    const ref = getDb().doc(`assistants/${projectId}/items/${assistantId}`)
    batch ? batch.update(ref, data) : await ref.update(data)
}

export async function uploadNewAssistant(projectId, assistant, callback) {
    const { loggedUser } = store.getState()
    updateEditionData(assistant)

    assistant.uid = getId()
    assistant.displayName = assistant.displayName.trim()
    assistant.createdDate = Date.now()
    assistant.creatorId = loggedUser.uid

    const assistantToStore = { ...assistant }
    delete assistantToStore.uid

    const batch = new BatchWrapper(getDb())
    batch.set(getDb().doc(`assistants/${projectId}/items/${assistant.uid}`), assistantToStore, {
        merge: true,
    })

    const cleanedTitle = TasksHelper.getTaskNameWithoutMeta(assistant.displayName)

    await batch.commit()

    if (!isGlobalAssistant(assistant.uid)) createAssistantUpdatesChain(projectId, assistant)
    callback?.(assistant)

    logEvent('new_assistant', {
        uid: assistant.uid,
        name: cleanedTitle,
    })

    return assistant
}

export async function deleteAssistant(projectId, assistant) {
    const batch = new BatchWrapper(getDb())
    batch.delete(getDb().doc(`assistants/${projectId}/items/${assistant.uid}`))

    if (projectId === GLOBAL_PROJECT_ID) {
        const projectDocs = (
            await getDb().collection(`projects`).where('globalAssistantIds', 'array-contains', assistant.uid).get()
        ).docs
        projectDocs.forEach(doc => {
            const project = doc.data()
            const data = { globalAssistantIds: firebase.firestore.FieldValue.arrayRemove(assistant.uid) }
            if (project.assistantId === assistant.uid) data.assistantId = ''
            batch.update(getDb().doc(`projects/${doc.id}`), data)
        })
    } else {
        const project = ProjectHelper.getProjectById(projectId)
        if (project.assistantId === assistant.uid)
            batch.update(getDb().doc(`projects/${projectId}`), { assistantId: '' })
    }

    batch.commit()
    if (!isGlobalAssistant(assistant.uid)) deleteAssistantUpdatesChain(projectId, assistant)
}

export async function updateAssistant(projectId, updatedAssistant, oldAssistant) {
    const assistantId = updatedAssistant.uid

    const assistantToStore = { ...updatedAssistant }
    delete assistantToStore.uid

    const batch = new BatchWrapper(getDb())
    updateAssistantData(projectId, assistantId, assistantToStore, batch)

    if (oldAssistant.displayName !== updatedAssistant.displayName) {
        updateChatTitleWithoutFeeds(projectId, updatedAssistant.uid, updatedAssistant.displayName)
        if (updatedAssistant.noteIdsByProject[projectId])
            await updateNoteTitleWithoutFeed(
                projectId,
                updatedAssistant.noteIdsByProject[projectId],
                updatedAssistant.displayName,
                batch
            )
    }

    batch.commit()

    if (!isGlobalAssistant(updatedAssistant.uid)) updateAssistantFeedsChain(projectId, updatedAssistant, oldAssistant)
}

export async function updateAssistantName(projectId, assistant, newName) {
    const batch = new BatchWrapper(getDb())

    updateAssistantData(projectId, assistant.uid, { displayName: newName }, batch)

    if (assistant.displayName !== newName) {
        updateChatTitleWithoutFeeds(projectId, assistant.uid, newName)
        if (assistant.noteIdsByProject[projectId])
            await updateNoteTitleWithoutFeed(projectId, assistant.noteIdsByProject[projectId], newName, batch)
    }

    batch.commit()

    if (!isGlobalAssistant(assistant.uid))
        assistantNameChangedUpdatesChain(projectId, assistant, assistant.displayName, newName)
}

export function updateAssistantDescription(projectId, description, assistant) {
    updateAssistantData(projectId, assistant.uid, { description }, null)
    if (!isGlobalAssistant(assistant.uid))
        assistantDescriptionChangedUpdatesChain(projectId, assistant, assistant.description, description)
}

export function updateAssistantPrompt(projectId, assistant, prompt) {
    updateAssistantData(projectId, assistant.uid, { type: TYPE_PROMPT_BASED, prompt }, null)
    if (assistant.type !== TYPE_PROMPT_BASED && !isGlobalAssistant(assistant.uid)) {
        assistantTypeChangedUpdatesChain(projectId, assistant, assistant.type, TYPE_PROMPT_BASED)
    }
}

export async function updateAssistantNote(projectId, assistantId, noteId) {
    await updateAssistantData(projectId, assistantId, { [`noteIdsByProject.${projectId}`]: noteId }, null)
}

export function updateAssistantThirdPartLink(projectId, assistant, thirdPartLink) {
    updateAssistantData(projectId, assistant.uid, { type: TYPE_3RD_PARTY, thirdPartLink }, null)
    if (assistant.type !== TYPE_3RD_PARTY && !isGlobalAssistant(assistant.uid)) {
        assistantTypeChangedUpdatesChain(projectId, assistant, assistant.type, TYPE_3RD_PARTY)
    }
}

export function updateAssistantInstructions(projectId, assistant, instructions) {
    updateAssistantData(projectId, assistant.uid, { instructions }, null)
    if (!isGlobalAssistant(assistant.uid))
        assistantInstructionsChangedUpdatesChain(projectId, assistant, assistant.instructions, instructions)
}

export function setAssistantLikeDefault(projectId, assistantId) {
    const { defaultAssistant } = store.getState()

    const batch = new BatchWrapper(getDb())
    updateAssistantData(projectId, assistantId, { isDefault: true }, batch)
    updateAssistantData(projectId, defaultAssistant.uid, { isDefault: false }, batch)
    batch.commit()
}

export function updateAssistantModel(projectId, assistant, model) {
    updateAssistantData(projectId, assistant.uid, { model }, null)
    if (!isGlobalAssistant(assistant.uid))
        assistantModelChangedUpdatesChain(projectId, assistant, assistant.model, model)
}

export function updateAssistantTemperature(projectId, assistant, temperature) {
    updateAssistantData(projectId, assistant.uid, { temperature }, null)
    if (!isGlobalAssistant(assistant.uid))
        assistantTemperatureChangedUpdatesChain(projectId, assistant, assistant.temperature, temperature)
}

export function updateAssistantLastVisitedBoardDate(
    projectId,
    assistantId,
    lastVisitBoardProjectId,
    lastVisitBoardProperty
) {
    const { loggedUser } = store.getState()
    updateAssistantData(
        projectId,
        assistantId,
        {
            [`${lastVisitBoardProperty}.${lastVisitBoardProjectId}.${loggedUser.uid}`]: Date.now(),
        },
        null
    )
}

export async function updateAssistantAvatar(projectId, assistant, pictureFile) {
    const pictures = await proccessPictureForAvatar(pictureFile)

    if (pictures.length > 0) {
        store.dispatch(startLoadingData())
        await deleteFolderFilesInStorage(`assistants/${projectId}/items/${assistant.uid}`)
        const urlList = await uploadAvatarPhotos(
            pictures,
            `assistants/${projectId}/${assistant.uid}/${assistant.uid}@${Date.now()}`,
            ''
        )

        const updatedData = {
            photoURL: urlList[0],
            photoURL50: urlList[1],
            photoURL300: urlList[2],
        }

        await updateAssistantData(projectId, assistant.uid, updatedData, null)
        store.dispatch(stopLoadingData())

        if (!isGlobalAssistant(assistant.uid))
            assistantPictureChangedUpdatesChain(projectId, assistant, updatedData.photoURL50)
    }
}

export function uploadNewPreConfigTask(projectId, assistantId, task) {
    const taskId = getId()
    task.id = taskId

    const taskToStore = { ...task }
    delete taskToStore.id
    taskToStore.assistantId = assistantId

    // Get current tasks for the specific assistant to determine the next order value
    getDb()
        .collection(`assistantTasks/${projectId}/preConfigTasks`)
        .where('assistantId', '==', assistantId)
        .get()
        .then(snapshot => {
            // Set order to the current count of tasks for this assistant (puts it at the end)
            taskToStore.order = snapshot.size

            const batch = new BatchWrapper(getDb())
            updateAssistantData(projectId, assistantId, {}, batch)
            batch.set(getDb().doc(`assistantTasks/${projectId}/preConfigTasks/${taskId}`), taskToStore)
            batch.commit()
        })
        .catch(error => {
            console.error('Error getting task count for order:', error)
            // Default fallback if we can't get the count
            taskToStore.order = 999

            const batch = new BatchWrapper(getDb())
            updateAssistantData(projectId, assistantId, {}, batch)
            batch.set(getDb().doc(`assistantTasks/${projectId}/preConfigTasks/${taskId}`), taskToStore)
            batch.commit()
        })
}

export function updatePreConfigTask(projectId, assistantId, task) {
    const taskToStore = { ...task }
    delete taskToStore.id
    taskToStore.assistantId = assistantId

    // Get the current task data to compare changes
    const taskRef = getDb().doc(`assistantTasks/${projectId}/preConfigTasks/${task.id}`)

    taskRef.get().then(doc => {
        const currentTask = doc.data()

        // Check if start time or date has changed
        if (currentTask && (currentTask.startDate !== task.startDate || currentTask.startTime !== task.startTime)) {
            // Clear lastExecuted if timing has changed
            taskToStore.lastExecuted = null
            console.log('Clearing lastExecuted due to timing change:', {
                taskId: task.id,
                oldStartDate: currentTask.startDate,
                newStartDate: task.startDate,
                oldStartTime: currentTask.startTime,
                newStartTime: task.startTime,
            })
        }

        const batch = new BatchWrapper(getDb())
        updateAssistantData(projectId, assistantId, {}, batch)
        batch.update(taskRef, taskToStore)
        batch.commit()
    })
}

export function deletePreConfigTask(projectId, assistantId, taskId) {
    const batch = new BatchWrapper(getDb())
    updateAssistantData(projectId, assistantId, {}, batch)
    batch.delete(getDb().doc(`assistantTasks/${projectId}/preConfigTasks/${taskId}`))
    batch.commit()
}

export function updateAssistantTasksOrder(projectId, assistantId, tasks) {
    // Create a batch operation
    const batch = new BatchWrapper(getDb())

    try {
        // Update the assistant's last edit data
        updateAssistantData(projectId, assistantId, {}, batch)

        // Update each task's order field
        tasks.forEach((task, index) => {
            if (!task || !task.id) {
                console.error('Invalid task found during reordering:', task)
                return
            }

            batch.update(getDb().doc(`assistantTasks/${projectId}/preConfigTasks/${task.id}`), { order: index })
        })

        // Commit the batch
        batch.commit()
    } catch (error) {
        console.error('Error updating task order:', error)
    }
}

export const updateAssistantLastCommentData = async (projectId, assistantId, lastComment, lastCommentType) => {
    getDb()
        .doc(`assistants/${projectId}/items/${assistantId}`)
        .update({
            [`commentsData.lastComment`]: lastComment,
            [`commentsData.lastCommentType`]: lastCommentType,
            [`commentsData.amount`]: firebase.firestore.FieldValue.increment(1),
        })
}

export function setAssistantLastVisitedBoardDate(
    projectId,
    assistant,
    lastVisitBoardProjectId,
    lastVisitBoardProperty
) {
    const { projectAssistants, loggedUser, globalAssistants } = store.getState()

    const updatedAssistant = {
        ...assistant,
        [lastVisitBoardProperty]: {
            ...assistant?.[lastVisitBoardProperty],
            [lastVisitBoardProjectId]: {
                ...assistant?.[lastVisitBoardProperty]?.[lastVisitBoardProjectId],
                [loggedUser.uid]: Date.now(),
            },
        },
    }

    if (projectId === GLOBAL_PROJECT_ID) {
        const newGlobalAssistants = [
            updatedAssistant,
            ...globalAssistants.filter(item => item.uid !== updatedAssistant.uid),
        ]
        store.dispatch(setGlobalAssistants(newGlobalAssistants))
    } else {
        const index = projectAssistants[projectId].findIndex(assistantItem => assistantItem.uid === assistant.uid)
        projectAssistants[projectId][index] = updatedAssistant

        store.dispatch(
            setAssistantsInProject(projectId, [
                updatedAssistant,
                ...projectAssistants[projectId].filter(item => item.uid !== updatedAssistant.uid),
            ])
        )
    }

    updateAssistantLastVisitedBoardDate(projectId, assistant.uid, lastVisitBoardProjectId, lastVisitBoardProperty)
}

//OTHERS FUNCTIONS

export async function addGlobalAssistantToProject(projectId, assistantId) {
    await getDb()
        .doc(`projects/${projectId}`)
        .update({ globalAssistantIds: firebase.firestore.FieldValue.arrayUnion(assistantId) })
}

export function removeGlobalAssistantFromProject(projectId, assistantId) {
    getDb()
        .doc(`projects/${projectId}`)
        .update({ globalAssistantIds: firebase.firestore.FieldValue.arrayRemove(assistantId) })
}

export async function copyPreConfigTasksToNewAssistant(
    sourceProjectId,
    sourceAssistantId,
    targetProjectId,
    targetAssistantId
) {
    try {
        console.log('copyPreConfigTasksToNewAssistant called with:', {
            sourceProjectId,
            sourceAssistantId,
            targetProjectId,
            targetAssistantId,
        })

        // Get all pre-configured tasks from the source assistant
        const tasksSnapshot = await getDb()
            .collection(`assistantTasks/${sourceProjectId}/preConfigTasks`)
            .where('assistantId', '==', sourceAssistantId)
            .orderBy('order', 'asc')
            .get()

        console.log(`Found ${tasksSnapshot.size} tasks to copy`)

        if (tasksSnapshot.empty) {
            console.log('No pre-configured tasks to copy')
            return
        }

        const batch = new BatchWrapper(getDb())

        // Copy each task to the new assistant
        tasksSnapshot.forEach(doc => {
            const task = doc.data()
            const newTaskId = getId()

            const taskCopy = {
                ...task,
                assistantId: targetAssistantId,
            }

            console.log('Copying task:', task.title || task.name, 'with new ID:', newTaskId)
            batch.set(getDb().doc(`assistantTasks/${targetProjectId}/preConfigTasks/${newTaskId}`), taskCopy)
        })

        await batch.commit()
        console.log(`✅ Successfully copied ${tasksSnapshot.size} pre-configured tasks to new assistant`)
    } catch (error) {
        console.error('❌ Error copying pre-configured tasks:', error)
        console.error('Error details:', {
            message: error.message,
            stack: error.stack,
        })
    }
}
