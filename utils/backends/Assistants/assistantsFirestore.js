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

function getAssistantTasksCollectionPath(projectId, assistantId) {
    return isGlobalAssistant(assistantId)
        ? `assistantTasks/${projectId}/preConfigTasks`
        : `assistantTasks/${projectId}/${assistantId}`
}

function getAssistantTaskDocRef(projectId, assistantId, taskId) {
    return getDb().doc(`${getAssistantTasksCollectionPath(projectId, assistantId)}/${taskId}`)
}

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
    const collectionPath = getAssistantTasksCollectionPath(projectId, assistantId)
    let query = getDb().collection(collectionPath)

    if (isGlobalAssistant(assistantId)) {
        query = query.where('assistantId', '==', assistantId)
    }

    globalWatcherUnsub[watcherKey] = query.onSnapshot(assistantDocs => {
        const tasks = []
        assistantDocs.forEach(doc => {
            const task = doc.data()
            task.id = doc.id
            tasks.push(task)
        })

        tasks.sort((a, b) => {
            const typeRank = value => {
                if (!value) return 1
                return value === 'prompt' ? 0 : 1
            }

            const typeDiff = typeRank(a.type) - typeRank(b.type)
            if (typeDiff !== 0) return typeDiff

            return (a.order ?? 0) - (b.order ?? 0)
        })

        callback(tasks)
        if (firstSnap) {
            firstSnap = false
            store.dispatch(stopLoadingData())
        }
    })
}

export async function getPreConfigTasksForProject(projectId) {
    const { projectAssistants, globalAssistants } = store.getState()
    const project = ProjectHelper.getProjectById(projectId)

    // Get assistants accessible in this project
    const projectSpecificAssistants = projectAssistants[projectId] || []
    const enabledGlobalAssistants = globalAssistants.filter(a => project?.globalAssistantIds?.includes(a.uid))
    const assistantsInProject = [...projectSpecificAssistants, ...enabledGlobalAssistants]

    const allTasks = []
    for (const assistant of assistantsInProject) {
        const tasksProjectId = isGlobalAssistant(assistant.uid) ? GLOBAL_PROJECT_ID : projectId
        const collectionPath = getAssistantTasksCollectionPath(tasksProjectId, assistant.uid)
        let query = getDb().collection(collectionPath)

        if (isGlobalAssistant(assistant.uid)) {
            query = query.where('assistantId', '==', assistant.uid)
        }

        const snapshot = await query.get()
        snapshot.forEach(doc => {
            const task = doc.data()
            task.id = doc.id
            task.assistant = assistant // Attach for display
            task.isPreConfigTask = true
            task.assistantId = assistant.uid
            allTasks.push(task)
        })
    }

    return allTasks.sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
}

export async function getPreConfigTask(projectId, assistantId, taskId) {
    const taskRef = getAssistantTaskDocRef(projectId, assistantId, taskId)
    const doc = await taskRef.get()
    if (doc.exists) {
        return { ...doc.data(), id: doc.id }
    }
    return null
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
    console.log('🔄 setAssistantLikeDefault called:', { projectId, assistantId })

    const { projectAssistants, globalAssistants, loggedUser } = store.getState()

    const batch = new BatchWrapper(getDb())

    // Set the new assistant as default
    updateAssistantData(projectId, assistantId, { isDefault: true }, batch)

    // Find and unmark the current default assistant in the same project
    const assistantsInProject = projectId === GLOBAL_PROJECT_ID ? globalAssistants : projectAssistants[projectId]

    console.log(
        '📋 Assistants in project before update:',
        assistantsInProject?.map(a => ({
            uid: a.uid,
            name: a.displayName,
            isDefault: a.isDefault,
        }))
    )

    if (assistantsInProject) {
        const currentDefaults = assistantsInProject.filter(
            assistant => assistant.isDefault && assistant.uid !== assistantId
        )
        if (currentDefaults.length > 0) {
            console.log(`📌 Found ${currentDefaults.length} current default assistant(s) to unmark`)
            currentDefaults.forEach(currentDefault => {
                console.log('  Unmarking:', {
                    uid: currentDefault.uid,
                    name: currentDefault.displayName,
                })
                updateAssistantData(projectId, currentDefault.uid, { isDefault: false }, batch)
            })
        } else {
            console.log('ℹ️  No existing default assistant found in project')
        }
    }

    // Also set this assistant as the project assistant
    if (projectId !== GLOBAL_PROJECT_ID) {
        const project = ProjectHelper.getProjectById(projectId)
        if (project?.assistantId !== assistantId) {
            console.log('🔗 Also setting as project assistant:', { projectId, assistantId })
            batch.update(getDb().doc(`projects/${projectId}`), { assistantId })
        } else {
            console.log('ℹ️  Assistant is already the project assistant, skipping redundant update')
        }
    }

    batch.commit()

    // Immediately update the Redux store to reflect the change
    const updatedAssistants = assistantsInProject.map(assistant => {
        if (assistant.uid === assistantId) {
            return { ...assistant, isDefault: true }
        } else if (assistant.isDefault) {
            return { ...assistant, isDefault: false }
        }
        return assistant
    })

    console.log(
        '✅ Updated assistants for Redux store:',
        updatedAssistants.map(a => ({
            uid: a.uid,
            name: a.displayName,
            isDefault: a.isDefault,
        }))
    )

    console.log("🎯 Is this the user's default project?", {
        projectId,
        defaultProjectId: loggedUser?.defaultProjectId,
        isDefaultProject: loggedUser?.defaultProjectId === projectId,
    })

    if (projectId === GLOBAL_PROJECT_ID) {
        store.dispatch(setGlobalAssistants(updatedAssistants))
        console.log('🌐 Dispatched setGlobalAssistants')
    } else {
        store.dispatch(setAssistantsInProject(projectId, updatedAssistants))
        console.log('📦 Dispatched setAssistantsInProject for project:', projectId)
    }
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

    const collectionPath = getAssistantTasksCollectionPath(projectId, assistantId)
    const collectionRef = getDb().collection(collectionPath)

    const query = isGlobalAssistant(assistantId) ? collectionRef.where('assistantId', '==', assistantId) : collectionRef

    query
        .get()
        .then(snapshot => {
            taskToStore.order = snapshot.size

            if (!taskToStore.creatorUserId) {
                const { loggedUser } = store.getState()
                if (loggedUser?.uid) {
                    taskToStore.creatorUserId = loggedUser.uid
                    taskToStore.activatorUserId = loggedUser.uid
                }
            }

            if (!isGlobalAssistant(assistantId)) {
                taskToStore.activatedInProjectId = projectId
                taskToStore.lastExecuted = null
            }

            const batch = new BatchWrapper(getDb())
            updateAssistantData(projectId, assistantId, {}, batch)
            batch.set(getAssistantTaskDocRef(projectId, assistantId, taskId), {
                ...taskToStore,
                id: taskId,
            })

            if (!isGlobalAssistant(assistantId)) {
                const legacyRef = getDb().doc(`assistantTasks/${projectId}/preConfigTasks/${taskId}`)
                batch.delete(legacyRef)
            }

            batch.commit()
        })
        .catch(error => {
            console.error('Error getting task count for order:', error)
            taskToStore.order = 999

            if (!taskToStore.creatorUserId) {
                const { loggedUser } = store.getState()
                if (loggedUser?.uid) {
                    taskToStore.creatorUserId = loggedUser.uid
                    taskToStore.activatorUserId = loggedUser.uid
                }
            }

            if (!isGlobalAssistant(assistantId)) {
                taskToStore.activatedInProjectId = projectId
                taskToStore.lastExecuted = null
            }

            const batch = new BatchWrapper(getDb())
            updateAssistantData(projectId, assistantId, {}, batch)
            batch.set(getAssistantTaskDocRef(projectId, assistantId, taskId), {
                ...taskToStore,
                id: taskId,
            })

            if (!isGlobalAssistant(assistantId)) {
                const legacyRef = getDb().doc(`assistantTasks/${projectId}/preConfigTasks/${taskId}`)
                batch.delete(legacyRef)
            }

            batch.commit()
        })
}

export function updatePreConfigTask(projectId, assistantId, task) {
    const taskToStore = { ...task }
    delete taskToStore.id
    taskToStore.assistantId = assistantId

    // Get the current task data to compare changes
    const taskRef = getAssistantTaskDocRef(projectId, assistantId, task.id)

    taskRef.get().then(doc => {
        const currentTask = doc.exists ? doc.data() : null

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

        const payload = { ...taskToStore, id: task.id }

        const batch = new BatchWrapper(getDb())
        updateAssistantData(projectId, assistantId, {}, batch)
        if (doc.exists) {
            batch.update(taskRef, payload)
        } else {
            batch.set(taskRef, payload, { merge: true })
        }

        if (!isGlobalAssistant(assistantId)) {
            const legacyRef = getDb().doc(`assistantTasks/${projectId}/preConfigTasks/${task.id}`)
            batch.delete(legacyRef)
        }
        batch.commit()
    })
}

export function deletePreConfigTask(projectId, assistantId, taskId) {
    const batch = new BatchWrapper(getDb())
    updateAssistantData(projectId, assistantId, {}, batch)
    batch.delete(getAssistantTaskDocRef(projectId, assistantId, taskId))

    if (!isGlobalAssistant(assistantId)) {
        const legacyRef = getDb().doc(`assistantTasks/${projectId}/preConfigTasks/${taskId}`)
        batch.delete(legacyRef)
    }
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

            const taskRef = getAssistantTaskDocRef(projectId, assistantId, task.id)
            batch.set(taskRef, { order: index }, { merge: true })
            if (!isGlobalAssistant(assistantId)) {
                const legacyRef = getDb().doc(`assistantTasks/${projectId}/preConfigTasks/${task.id}`)
                batch.delete(legacyRef)
            }
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

export const resetAssistantLastCommentData = async (projectId, assistantId) => {
    const ref = getDb().doc(`assistants/${projectId}/items/${assistantId}`)
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
        const { loggedUser } = store.getState()
        const currentUserId = loggedUser?.uid || null

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
                id: newTaskId,
                // Track source template task for update sync
                copiedFromTemplateTaskId: doc.id,
                copiedFromTemplateTaskDate: Date.now(),
            }

            if (!taskCopy.creatorUserId && currentUserId) {
                taskCopy.creatorUserId = currentUserId
            }

            const targetIsGlobal = isGlobalAssistant(targetAssistantId)

            if (!targetIsGlobal) {
                taskCopy.activatedInProjectId = targetProjectId
                taskCopy.lastExecuted = null
                taskCopy.activatorUserId = currentUserId
            }

            console.log('Copying task:', task.title || task.name, 'with new ID:', newTaskId)

            batch.set(getAssistantTaskDocRef(targetProjectId, targetAssistantId, newTaskId), taskCopy)

            if (!targetIsGlobal) {
                const legacyRef = getDb().doc(`assistantTasks/${targetProjectId}/preConfigTasks/${newTaskId}`)
                batch.delete(legacyRef)
            }
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

// Update assistant properties from a global/template assistant
export async function updateAssistantFromTemplate(projectId, localAssistant, globalAssistant) {
    const updatePayload = {
        displayName: globalAssistant.displayName,
        description: globalAssistant.description,
        photoURL: globalAssistant.photoURL,
        photoURL50: globalAssistant.photoURL50,
        photoURL300: globalAssistant.photoURL300,
        instructions: globalAssistant.instructions,
        model: globalAssistant.model,
        temperature: globalAssistant.temperature,
        prompt: globalAssistant.prompt,
        thirdPartLink: globalAssistant.thirdPartLink,
        type: globalAssistant.type,
        // Reset sync timestamp to indicate we've synced with the latest version
        copiedFromTemplateAssistantDate: Date.now(),
    }

    await updateAssistantData(projectId, localAssistant.uid, updatePayload, null)
    console.log(`✅ Updated assistant ${localAssistant.uid} from template ${globalAssistant.uid}`)
}

// Sync pre-configured tasks from a global/template assistant
export async function syncPreConfigTasksFromTemplate(globalAssistantId, localProjectId, localAssistantId) {
    try {
        const { loggedUser } = store.getState()
        const currentUserId = loggedUser?.uid || null

        // 1. Get global/template tasks
        const globalTasksSnapshot = await getDb()
            .collection(`assistantTasks/${GLOBAL_PROJECT_ID}/preConfigTasks`)
            .where('assistantId', '==', globalAssistantId)
            .get()

        // 2. Get local tasks
        const localTasksSnapshot = await getDb()
            .collection(getAssistantTasksCollectionPath(localProjectId, localAssistantId))
            .get()

        // 3. Build mapping: copiedFromTemplateTaskId -> local task
        const localTasksByTemplateId = {}
        localTasksSnapshot.forEach(doc => {
            const task = doc.data()
            if (task.copiedFromTemplateTaskId) {
                localTasksByTemplateId[task.copiedFromTemplateTaskId] = { ...task, id: doc.id }
            }
        })

        const batch = new BatchWrapper(getDb())

        // 4. For each global task, update or create local task
        globalTasksSnapshot.forEach(doc => {
            const globalTask = doc.data()
            const localTask = localTasksByTemplateId[doc.id]

            if (localTask) {
                // Update existing task - preserve local-only fields (lastExecuted, activatedInProjectId, etc.)
                const updatePayload = {
                    title: globalTask.title,
                    type: globalTask.type,
                    prompt: globalTask.prompt,
                    order: globalTask.order,
                    // Update sync timestamp
                    copiedFromTemplateTaskDate: Date.now(),
                }
                batch.update(getAssistantTaskDocRef(localProjectId, localAssistantId, localTask.id), updatePayload)
            } else {
                // Create new local task
                const newTaskId = getId()
                const taskCopy = {
                    ...globalTask,
                    id: newTaskId,
                    assistantId: localAssistantId,
                    copiedFromTemplateTaskId: doc.id,
                    copiedFromTemplateTaskDate: Date.now(),
                    activatedInProjectId: localProjectId,
                    lastExecuted: null,
                }

                if (!taskCopy.creatorUserId && currentUserId) {
                    taskCopy.creatorUserId = currentUserId
                    taskCopy.activatorUserId = currentUserId
                }

                batch.set(getAssistantTaskDocRef(localProjectId, localAssistantId, newTaskId), taskCopy)

                // Clean up legacy path
                const legacyRef = getDb().doc(`assistantTasks/${localProjectId}/preConfigTasks/${newTaskId}`)
                batch.delete(legacyRef)
            }
        })

        await batch.commit()
        console.log(`✅ Synced ${globalTasksSnapshot.size} tasks from template to assistant ${localAssistantId}`)
    } catch (error) {
        console.error('❌ Error syncing pre-configured tasks from template:', error)
        console.error('Error details:', {
            message: error.message,
            stack: error.stack,
        })
    }
}
