import { useDispatch, useSelector } from 'react-redux'

import URLsTasks, { URL_TASK_DETAILS_PROPERTIES } from '../../../../URLSystem/Tasks/URLsTasks'
import URLsChats, { URL_CHAT_DETAILS_PROPERTIES } from '../../../../URLSystem/Chats/URLsChats'
import Backend from '../../../../utils/BackendBridge'
import {
    hideProjectPicker,
    setAssignee,
    setSelectedNavItem,
    setSelectedSidebarTab,
    setSelectedTypeOfProject,
    startLoadingData,
    stopLoadingData,
    switchProject,
} from '../../../../redux/actions'
import TasksHelper from '../../../TaskListView/Utils/TasksHelper'
import {
    DV_TAB_CHAT_PROPERTIES,
    DV_TAB_ROOT_CHATS,
    DV_TAB_ROOT_CONTACTS,
    DV_TAB_SKILL_PROPERTIES,
    DV_TAB_TASK_PROPERTIES,
} from '../../../../utils/TabNavigationConstants'
import ProjectHelper from '../../../SettingsView/ProjectsSettings/ProjectHelper'
import NavigationService from '../../../../utils/NavigationService'
import { DEFAULT_WORKSTREAM_ID } from '../../../Workstreams/WorkstreamHelper'
import { setTaskAssignee, setTaskProject } from '../../../../utils/backends/Tasks/tasksFirestore'
import { setNoteProject } from '../../../../utils/backends/Notes/notesFirestore'
import { findNoteOwnerInProject, resolveMovedNoteOwnerId } from '../../../NotesView/NoteFilters/noteOwnerFilterHelper'
import { moveChatOnMoveObjectFromProject } from '../../../../utils/backends/Chats/chatsFirestore'
import { moveInnerFeedsOnMoveObjectFromProject } from '../../../../utils/backends/firestore'
import { updateGoalProject } from '../../../../utils/backends/Goals/goalsFirestore'
import { setContactProject } from '../../../../utils/backends/Contacts/contactsFirestore'
import store from '../../../../redux/store'
import { startPerformanceTrace } from '../../../../utils/performance/performanceLogger'

/**
 * The cross-entity "move this object to another project" engine, extracted
 * verbatim from SelectProjectModal so the picker UI and the move logic can
 * evolve separately (MODAL_IMPROVEMENT_PLAN.md, project-picker consolidation).
 * Handles chats, tasks, notes, goals, skills and contacts, keeps the object's
 * activity feed with it, and rewrites the browser URL when a DetailedView
 * properties tab is showing the moved object.
 *
 * AT-2194 lives in the note branch: the owner must be resolved with the notes
 * resolver (assistants are owners but not project members) and never
 * pre-assigned, so `resolveMovedNoteOwnerId` in the backend stays the single
 * authority on whether an owner survives the move. Pinned by
 * MoveNoteOwner.test.js.
 */
export default function useMoveObjectToProject() {
    const loggedUser = useSelector(state => state.loggedUser)
    const selectedTab = useSelector(state => state.selectedNavItem)
    const dispatch = useDispatch()

    const writeBrowserUrl = (item, newProject) => {
        if (item.type === 'task') {
            const task = item.data
            if (selectedTab === DV_TAB_TASK_PROPERTIES) {
                const data = { noHistory: true, projectId: newProject.id, task: task.id }
                URLsTasks.push(URL_TASK_DETAILS_PROPERTIES, data, newProject.id, task.id)
            }
        } else if (item.type === 'chat' && selectedTab === DV_TAB_CHAT_PROPERTIES) {
            const chat = item.data
            const data = { noHistory: true, projectId: newProject.id, chatId: chat.id }
            URLsChats.push(URL_CHAT_DETAILS_PROPERTIES, data, newProject.id, chat.id)
        }
    }

    const moveObjectToProject = async (item, project, newProject) => {
        const { type, data } = item
        const performanceTrace = startPerformanceTrace('move_object_project', {
            object_type: type,
            task_count: type === 'task' ? 1 : 0,
            subtask_count: type === 'task' ? data.subtaskIds?.length || 0 : 0,
        })
        const completeMove = async promise => {
            try {
                const result = await promise
                performanceTrace.end('move_complete', { outcome: 'success' })
                return result
            } catch (error) {
                performanceTrace.fail('move_failed')
                throw error
            }
        }
        const objectType = type === 'chat' ? 'topics' : type + 's'
        const beforeDeleteSource =
            type === 'chat'
                ? movedChat => {
                      NavigationService.navigate('ChatDetailedView', {
                          chat: movedChat,
                          projectId: newProject.id,
                      })
                      const projectType = ProjectHelper.getTypeOfProject(loggedUser, newProject.id)
                      dispatch([
                          setSelectedSidebarTab(DV_TAB_ROOT_CHATS),
                          switchProject(newProject.index),
                          setSelectedTypeOfProject(projectType),
                          setSelectedNavItem(DV_TAB_CHAT_PROPERTIES),
                      ])
                  }
                : null

        if (type === 'chat') dispatch(startLoadingData())

        await moveChatOnMoveObjectFromProject(project.id, newProject.id, objectType, data.id, beforeDeleteSource)
        performanceTrace.mark('chat_history_moved')
        if (type !== 'chat') dispatch(stopLoadingData())
        // Keep the object's "Updates" activity history with it across the move (chat is handled above).
        const movedFeedCount = await moveInnerFeedsOnMoveObjectFromProject(
            project.id,
            newProject.id,
            objectType,
            data.id
        )
        performanceTrace.mark('activity_history_moved', { document_count: movedFeedCount || 0 })

        if (type === 'chat') {
            dispatch(stopLoadingData())
            performanceTrace.end('move_complete', { outcome: 'success' })
        } else if (type === 'task') {
            const task = data
            const taskOwner = TasksHelper.getTaskOwner(task.userId, project.id)
            dispatch(startLoadingData())
            try {
                if (!newProject.userIds.includes(taskOwner.uid) && task.userId !== DEFAULT_WORKSTREAM_ID) {
                    await completeMove(
                        (async () => {
                            const updatedTask = await setTaskAssignee(
                                project.id,
                                task.id,
                                loggedUser.uid,
                                taskOwner,
                                loggedUser,
                                task
                            )
                            return setTaskProject(project, newProject, updatedTask, taskOwner, loggedUser)
                        })()
                    )
                    dispatch(setAssignee(loggedUser))
                } else {
                    await completeMove(setTaskProject(project, newProject, task))
                }
                dispatch(hideProjectPicker())
            } finally {
                dispatch(stopLoadingData())
            }
        } else if (type === 'note') {
            const note = data
            // A note can be owned by an assistant since AT-2194, and an assistant is not a
            // project *user*. The old `getUserInProject` member check therefore resolved to
            // undefined for every assistant-owned note and reassigned it to the acting human
            // — and it did so by mutating `note.userId` BEFORE `setNoteProject` ran, which
            // bypassed `resolveMovedNoteOwnerId` (notesFirestore.js) entirely, defeating the
            // guard that exists precisely to keep an assistant owner across a move.
            //
            // Mirror the task branch above, which already uses the cross-project-aware
            // `TasksHelper.getTaskOwner`: resolve the owner with the notes resolver and let
            // the backend stay the single authority on whether it survives the move.
            const noteOwner = findNoteOwnerInProject(project.id, note.userId)
            const movedOwnerId = resolveMovedNoteOwnerId(newProject.id, note.userId, loggedUser.uid)

            dispatch(startLoadingData())
            try {
                await completeMove(
                    movedOwnerId !== note.userId
                        ? setNoteProject(project, newProject, note, noteOwner, loggedUser)
                        : setNoteProject(project, newProject, note)
                )
                dispatch(hideProjectPicker())
            } finally {
                dispatch(stopLoadingData())
            }
        } else if (type === 'goal') {
            const goal = data
            await completeMove(updateGoalProject(project, newProject, goal))
        } else if (type === 'skill') {
            const skill = data
            const { loggedUser, route } = store.getState()
            Backend.updateSkillProject(project, newProject, skill, () => {
                if (route === 'SkillDetailedView') {
                    NavigationService.navigate('SkillDetailedView', {
                        skillId: skill.id,
                        projectId: newProject.id,
                        skill,
                    })
                    const projectType = ProjectHelper.getTypeOfProject(loggedUser, newProject.id)
                    store.dispatch([
                        setSelectedSidebarTab(DV_TAB_ROOT_CONTACTS),
                        switchProject(newProject.index),
                        setSelectedTypeOfProject(projectType),
                        setSelectedNavItem(DV_TAB_SKILL_PROPERTIES),
                    ])
                }
            })
            performanceTrace.end('client_complete', { outcome: 'success' })
        } else if (type === 'contact') {
            const contact = data
            dispatch(startLoadingData())
            await setContactProject(project, newProject, contact)
            dispatch(stopLoadingData())
            performanceTrace.end('move_complete', { outcome: 'success' })
        }

        writeBrowserUrl(item, newProject)
    }

    return moveObjectToProject
}
