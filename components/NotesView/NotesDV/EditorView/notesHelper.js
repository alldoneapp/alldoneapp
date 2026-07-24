import * as Y from 'yjs'
import { WebrtcProvider } from 'y-webrtc'
import { WebsocketProvider } from 'y-websocket'
import { QuillBinding } from 'y-quill'
import Quill from 'quill'
import v4 from 'uuid/v4'
import store from '../../../../redux/store'
import { setPrevScreen, setSelectedNavItem, setSelectedNote, setVirtualQuillLoaded } from '../../../../redux/actions'
import Backend from '../../../../utils/BackendBridge'
import TasksHelper, { DONE_STEP, OPEN_STEP } from '../../../TaskListView/Utils/TasksHelper'
import { DV_TAB_NOTE_EDITOR } from '../../../../utils/TabNavigationConstants'
import NavigationService from '../../../../utils/NavigationService'
import { uploadTaskByQuill } from '../../../../utils/backends/Tasks/tasksFirestore'
import { getDvMainTabLink } from '../../../../utils/LinkingHelper'
import { getNotesCollaborationServerData } from '../../../../utils/backends/firestore'

export const signalingServers = [
    getNotesCollaborationServerData().NOTES_COLLABORATION_SERVER,
    'wss://signaling.yjs.dev',
    'wss://y-webrtc-signaling-eu.herokuapp.com',
    'wss://y-webrtc-signaling-us.herokuapp.com',
]

const getQuillCollaborationData = (roomId, noteData) => {
    const ydoc = new Y.Doc()
    const update = new Uint8Array(noteData)

    if (update.length > 0) {
        Y.applyUpdate(ydoc, update)
    }

    const provider = new WebsocketProvider(getNotesCollaborationServerData().NOTES_COLLABORATION_SERVER, roomId, ydoc)

    /* const provider = new WebrtcProvider(roomId, ydoc, {
        peerOpts: { config },
        signaling: signalingServers,
    })*/

    const tempContainer = document.createElement('div')
    const quill = new Quill(tempContainer)
    const type = ydoc.getText('quill')

    return { ydoc, provider, quill, type }
}

const disconnectQuillCollaboration = (provider, ydoc, binding) => {
    provider.destroy()
    ydoc.destroy()
    binding.destroy()
}

export const processRestoredNote = async (noteId, originalData, restoredData) => {
    const { ydoc, provider, quill, type } = getQuillCollaborationData(noteId, originalData)

    store.dispatch(setVirtualQuillLoaded(true))
    const binding = new QuillBinding(type, quill, provider.awareness)

    quill.getSelection(true)
    const restoredNoteOps = getNoteDataOps(restoredData)
    quill.setContents(restoredNoteOps)

    store.dispatch(setVirtualQuillLoaded(false))

    setTimeout(() => {
        disconnectQuillCollaboration(provider, ydoc, binding)
    }, 2000)
}

const getNoteDataOps = noteData => {
    const { ydoc, provider, quill, type } = getQuillCollaborationData(v4(), noteData)
    const binding = new QuillBinding(type, quill, provider.awareness)

    const ops = quill.getContents().ops

    disconnectQuillCollaboration(provider, ydoc, binding)

    return ops
}

export const processMovedNoteTasks = async (
    oldProjectId,
    newProjectId,
    noteId,
    noteData,
    linkedParentTasksIds,
    externalBatch
) => {
    if (noteData) {
        const { ydoc, provider, quill, type } = getQuillCollaborationData(v4(), noteData)

        store.dispatch(setVirtualQuillLoaded(true))
        const binding = new QuillBinding(type, quill, provider.awareness)

        const ops = quill.getContents().ops

        let promises = []
        const newTasksIds = []
        const oldTasksIds = []
        for (let i = 0; i < ops.length; i++) {
            const { insert } = ops[i]
            if (insert) {
                const { taskTagFormat, task } = insert
                if (taskTagFormat || task) {
                    const oldTaskId = taskTagFormat ? taskTagFormat.taskId : task.id
                    promises.push(Backend.getTaskData(oldProjectId, oldTaskId))
                    const newTaskId = Backend.getId()
                    newTasksIds.push(newTaskId)
                    oldTasksIds.push(oldTaskId)
                    const url = `${window.location.origin}${getDvMainTabLink(newProjectId, newTaskId, 'tasks')}`
                    ops[i].insert.taskTagFormat = { id: v4(), taskId: newTaskId, editorId: noteId, objectUrl: url }
                }
            }
        }

        quill.setContents(ops)
        const stateUpdate = Y.encodeStateAsUpdate(ydoc)
        store.dispatch(setVirtualQuillLoaded(false))

        disconnectQuillCollaboration(provider, ydoc, binding)

        const tasks = await Promise.all(promises)

        promises = []
        for (let i = 0; i < newTasksIds.length; i++) {
            const newTaskId = newTasksIds[i]
            const oldTaskId = oldTasksIds[i]
            const task = tasks[i]
            if (task) {
                updateMovedNoteTaskCopied(newProjectId, newTaskId, task, task.done, noteId)
                linkedParentTasksIds.push(newTaskId)
                if (!task.done) {
                    delete task.completed
                }

                if (task.subtaskIds.length > 0) {
                    task.subtaskIds = []
                    const subtasks = await Backend.getSubTasksListDirectly(oldProjectId, oldTaskId)

                    for (let n = 0; n < subtasks.length; n++) {
                        const newSubtaskId = Backend.getId()
                        task.subtaskIds.push(newSubtaskId)
                        const subtask = subtasks[n]

                        if (!task.done) {
                            delete subtask.completed
                            subtask.parentDone = false
                        }

                        updateMovedNoteTaskCopied(newProjectId, newSubtaskId, subtask, task.done, noteId)
                        subtask.parentId = task.id
                        promises.push(uploadTaskByQuill(newProjectId, subtask, externalBatch))
                    }
                }

                promises.push(uploadTaskByQuill(newProjectId, task, externalBatch))
            }
        }
        await Promise.all(promises)

        return stateUpdate
    }
}

const updateMovedNoteTaskCopied = (newProjectId, newTaskId, task, inDone, noteId) => {
    if (!TasksHelper.getUserInProject(newProjectId, task.userId)) {
        task.userId = store.getState().loggedUser.uid
    }

    task.id = newTaskId
    task.userIds = [task.userId]
    task.currentReviewerId = inDone ? DONE_STEP : task.userId
    task.stepHistory = [OPEN_STEP]
    task.comments = []
    task.linkedParentNotesIds = []
    task.linkedParentTasksIds = []
    task.linkedParentContactsIds = []
    task.linkedParentProjectsIds = []
    task.linkedParentGoalsIds = []
    task.linkedParentSkillsIds = []
    task.linkedParentAssistantIds = []
    task.estimations = {
        [OPEN_STEP]: task.estimations && task.estimations[OPEN_STEP] ? task.estimations[OPEN_STEP] : 0,
    }
    task.containerNotesIds = [noteId]
}

export const openNoteDV = (project, note) => {
    store.dispatch([setSelectedNavItem(DV_TAB_NOTE_EDITOR), setPrevScreen('NotesView'), setSelectedNote(note)])
    NavigationService.navigate('NotesDetailedView', {
        noteId: note.id,
        projectId: project.id,
    })
}
