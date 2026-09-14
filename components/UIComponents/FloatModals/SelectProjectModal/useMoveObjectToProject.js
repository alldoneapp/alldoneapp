import { useDispatch, useSelector } from 'react-redux'

import URLsChats, { URL_CHAT_DETAILS_PROPERTIES } from '../../../../URLSystem/Chats/URLsChats'
import {
    hideProjectPicker,
    setSelectedNavItem,
    setSelectedSidebarTab,
    setSelectedTypeOfProject,
    showConfirmPopup,
    startLoadingData,
    stopLoadingData,
    switchProject,
} from '../../../../redux/actions'
import {
    DV_TAB_CHAT_PROPERTIES,
    DV_TAB_CONTACT_PROPERTIES,
    DV_TAB_GOAL_PROPERTIES,
    DV_TAB_NOTE_PROPERTIES,
    DV_TAB_ROOT_CHATS,
    DV_TAB_ROOT_CONTACTS,
    DV_TAB_ROOT_GOALS,
    DV_TAB_ROOT_NOTES,
    DV_TAB_SKILL_PROPERTIES,
} from '../../../../utils/TabNavigationConstants'
import ProjectHelper from '../../../SettingsView/ProjectsSettings/ProjectHelper'
import NavigationService from '../../../../utils/NavigationService'
import store from '../../../../redux/store'
import { startPerformanceTrace } from '../../../../utils/performance/performanceLogger'
import { CONFIRM_POPUP_TRIGGER_INFO } from '../../ConfirmPopup'
import { queueObjectProjectMove, waitForProjectMoveCompletion } from '../../../../utils/backends/projectMoves'
import { translate } from '../../../../i18n/TranslationService'

/**
 * The cross-entity "move this object to another project" engine, extracted
 * verbatim from SelectProjectModal so the picker UI and the move logic can
 * evolve separately (MODAL_IMPROVEMENT_PLAN.md, project-picker consolidation).
 * Handles chats, tasks, notes, goals, skills and contacts, keeps the object's
 * activity feed with it, and rewrites the browser URL when a DetailedView
 * properties tab is showing the moved object.
 *
 * AT-2572 moved the fan-out behind one durable Cloud Function contract. The
 * client now only tracks acceptance/completion and performs detail-view
 * navigation; it never rewrites entity data or ownership locally.
 */
export default function useMoveObjectToProject() {
    const loggedUser = useSelector(state => state.loggedUser)
    const selectedTab = useSelector(state => state.selectedNavItem)
    const dispatch = useDispatch()

    const writeBrowserUrl = (item, newProject) => {
        if (item.type === 'chat' && selectedTab === DV_TAB_CHAT_PROPERTIES) {
            const chat = item.data
            const data = { noHistory: true, projectId: newProject.id, chatId: chat.id }
            URLsChats.push(URL_CHAT_DETAILS_PROPERTIES, data, newProject.id, chat.id)
        }
    }

    // A move is a fan-out of writes across TWO projects, and a rejection anywhere
    // in it reaches the picker as one bare `FirebaseError`. Naming the phase (and
    // `awaitWriteAck` naming the individual write inside it) is what turns
    // "permission-denied while moving" into something reproducible.
    const reportMoveFailure = (step, error) => {
        if (error && typeof error === 'object' && !error.moveStep) {
            try {
                error.moveStep = step
            } catch (mutationError) {
                // A frozen error is still reported unchanged.
            }
        }
        console.error(`[moveObjectToProject] failed during "${step}"`, {
            step,
            code: error?.code,
            writeLabel: error?.writeLabel,
            message: error?.message,
        })
        return error
    }

    const moveObjectToProject = async (item, project, newProject, taskMoveCallbacks = {}) => {
        const { type, data } = item
        const objectId = type === 'contact' ? data.uid : data.id
        const performanceTrace = startPerformanceTrace('move_object_project', {
            object_type: type,
            task_count: type === 'task' ? 1 : 0,
            subtask_count: type === 'task' ? data.subtaskIds?.length || 0 : 0,
        })
        const movePromise = queueObjectProjectMove(project.id, newProject.id, type, objectId).catch(error => {
            performanceTrace.fail('move_failed')
            throw reportMoveFailure(`move ${type}`, error)
        })

        if (type === 'task') {
            // The callable only enqueues the durable Cloud Tasks worker. Do not
            // await even that short round trip: selection should close the
            // picker immediately, while the server owns the complete move. A
            // rejected enqueue still needs to reach the user: at that point no
            // task write has happened and silently swallowing the rejection
            // makes a broken worker look like a successful background action.
            movePromise
                .then(result => {
                    performanceTrace.end('move_queued', { outcome: 'success' })
                    taskMoveCallbacks.onTaskProjectMoveEnqueued?.(result)
                })
                .catch(() => {
                    taskMoveCallbacks.onTaskProjectMoveEnqueueFailed?.()
                    dispatch(
                        showConfirmPopup({
                            trigger: CONFIRM_POPUP_TRIGGER_INFO,
                            object: {
                                headerText: 'Task could not be moved',
                                headerQuestion: 'No changes were made. Please try again.',
                            },
                        })
                    )
                })
            dispatch(hideProjectPicker())
            return
        }

        const route = store.getState().route
        const keepDetailLoader =
            (type === 'chat' && route === 'ChatDetailedView') ||
            (type === 'note' && route === 'NotesDetailedView') ||
            (type === 'contact' && route === 'ContactDetailedView')
        if (keepDetailLoader) dispatch(startLoadingData())

        movePromise
            .then(() => waitForProjectMoveCompletion(project.id, newProject.id, type, objectId))
            .then(movedObject => {
                const currentRoute = store.getState().route
                const projectType = ProjectHelper.getTypeOfProject(loggedUser, newProject.id)
                if (type === 'chat' && currentRoute === 'ChatDetailedView') {
                    NavigationService.navigate('ChatDetailedView', { chat: movedObject, projectId: newProject.id })
                    dispatch([
                        setSelectedSidebarTab(DV_TAB_ROOT_CHATS),
                        switchProject(newProject.index),
                        setSelectedTypeOfProject(projectType),
                        setSelectedNavItem(DV_TAB_CHAT_PROPERTIES),
                    ])
                } else if (type === 'note' && currentRoute === 'NotesDetailedView') {
                    NavigationService.navigate('NotesDetailedView', { noteId: objectId, projectId: newProject.id })
                    dispatch([
                        setSelectedSidebarTab(DV_TAB_ROOT_NOTES),
                        switchProject(newProject.index),
                        setSelectedTypeOfProject(projectType),
                        setSelectedNavItem(DV_TAB_NOTE_PROPERTIES),
                    ])
                } else if (type === 'goal' && currentRoute === 'GoalDetailedView') {
                    NavigationService.navigate('GoalDetailedView', { goalId: objectId, projectId: newProject.id })
                    dispatch([
                        setSelectedSidebarTab(DV_TAB_ROOT_GOALS),
                        switchProject(newProject.index),
                        setSelectedTypeOfProject(projectType),
                        setSelectedNavItem(DV_TAB_GOAL_PROPERTIES),
                    ])
                } else if (type === 'skill' && currentRoute === 'SkillDetailedView') {
                    NavigationService.navigate('SkillDetailedView', {
                        skillId: objectId,
                        projectId: newProject.id,
                        skill: movedObject,
                    })
                    dispatch([
                        setSelectedSidebarTab(DV_TAB_ROOT_CONTACTS),
                        switchProject(newProject.index),
                        setSelectedTypeOfProject(projectType),
                        setSelectedNavItem(DV_TAB_SKILL_PROPERTIES),
                    ])
                } else if (type === 'contact' && currentRoute === 'ContactDetailedView') {
                    NavigationService.navigate('ContactDetailedView', {
                        contact: { uid: objectId, ...movedObject },
                        project: newProject,
                    })
                    dispatch([
                        setSelectedSidebarTab(DV_TAB_ROOT_CONTACTS),
                        switchProject(newProject.index),
                        setSelectedTypeOfProject(projectType),
                        setSelectedNavItem(DV_TAB_CONTACT_PROPERTIES),
                    ])
                }
                writeBrowserUrl(item, newProject)
                performanceTrace.end('move_complete', { outcome: 'success' })
            })
            .catch(error => {
                reportMoveFailure(`move ${type}`, error)
                dispatch(
                    showConfirmPopup({
                        trigger: CONFIRM_POPUP_TRIGGER_INFO,
                        object: {
                            headerText: `${translate(type)} could not be moved`,
                            headerQuestion: 'The item is still in its current project. Please try again.',
                        },
                    })
                )
            })
            .finally(() => {
                if (keepDetailLoader) dispatch(stopLoadingData())
            })

        dispatch(hideProjectPicker())
    }

    return moveObjectToProject
}
