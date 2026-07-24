import React, { useState, useRef, useEffect } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { useSelector, useDispatch } from 'react-redux'

import styles, { colors, hexColorToRGBa } from '../styles/global'
import Button from '../UIControls/Button'
import store from '../../redux/store'
import {
    hideConfirmPopup,
    hideFloatPopup,
    navigateToAdmin,
    setForceCloseGoalEditionId,
    setForceCloseSkillEditionId,
    setSelectedNavItem,
    setSelectedSidebarTab,
    setSelectedTasks,
} from '../../redux/actions'
import Backend from '../../utils/BackendBridge'
import NavigationService from '../../utils/NavigationService'
import KickUserConfirmPopup from './FloatModals/KickUserConfirmPopup/KickUserConfirmPopup'
import NotificationModalMandatory from './FloatModals/NotificationModalMandatory'
import NotificationTimeout from './FloatModals/NotificationTimeout'
import RevisionHistoryConfirmationModal from './FloatModals/RevisionHistoryModal/RevisionHistoryConfirmationModal'
import PushNotificationsModalMandatory from './FloatModals/PushNotificationsModalMandatory'
import { deleteCacheAndRefresh } from '../../utils/Observers'
import { deleteUser, removeUserWorkflowStep } from '../../utils/backends/Users/usersFirestore'
import { cancelInvitedUserFromProject } from '../../utils/backends/firestore'
import { translate } from '../../i18n/TranslationService'
import {
    deleteAssistant,
    deletePreConfigTask,
    removeGlobalAssistantFromProject,
} from '../../utils/backends/Assistants/assistantsFirestore'
import { DV_TAB_ADMIN_PANEL_ASSISTANTS, DV_TAB_PROJECT_ASSISTANTS } from '../../utils/TabNavigationConstants'
import ProjectHelper from '../SettingsView/ProjectsSettings/ProjectHelper'
import { deleteWorkstream } from '../../utils/backends/Workstreams/workstreamsFirestore'
import { deleteProjectContact } from '../../utils/backends/Contacts/contactsFirestore'
import { deleteNote } from '../../utils/backends/Notes/notesFirestore'
import { GLOBAL_PROJECT_ID } from '../AdminPanel/Assistants/assistantsHelper'
import { removeChatTopic } from '../../utils/backends/Chats/chatsFirestore'

export const CONFIRM_POPUP_TRIGGER_DELETE_TASK = 'DELETE TASK'
export const CONFIRM_POPUP_TRIGGER_DELETE_ASSISTANT = 'CONFIRM_POPUP_TRIGGER_DELETE_ASSISTANT'
export const CONFIRM_POPUP_TRIGGER_DELETE_PRE_CONFIG_TASK = 'CONFIRM_POPUP_TRIGGER_DELETE_PRE_CONFIG_TASK'
export const CONFIRM_POPUP_TRIGGER_KICK_USER_FROM_PROJECT = 'KICK USER FROM PROJECT'
export const CONFIRM_POPUP_TRIGGER_DELETE_PROJECT = 'DELETE PROJECT'
export const CONFIRM_POPUP_TRIGGER_DELETE_PROJECT_CONTACT = 'DELETE PROJECT CONTACT'
export const CONFIRM_POPUP_MANDATORY_NOTIFICATION = 'CONFIRM POPUP MANDATORY NOTIFICATION'
export const CONFIRM_POPUP_TRIGGER_DELETE_USER = 'CONFIRM POPUP TRIGGER DELETE USER'
export const CONFIRM_POPUP_TRIGGER_CANCEL_PROJECT_INVITATION = 'CONFIRM POPUP CANCEL PROJECT INVITATION'
export const CONFIRM_POPUP_TRIGGER_DELETE_WORKFLOW_STEP = 'CONFIRM POPUP TRIGGER DELETE WORKFLOW STEP'
export const CONFIRM_POPUP_TRIGGER_DELETE_NOTE = 'CONFIRM POPUP TRIGGER DELETE NOTE'
export const CONFIRM_POPUP_TRIGGER_PUSH_NOTIFICATIONS = 'CONFIRM POPUP TRIGGER PUSH NOTIFICATIONS'
export const CONFIRM_POPUP_TRIGGER_DELETE_TOPIC = 'CONFIRM POPUP TRIGGER DELETE TOPIC'
export const CONFIRM_POPUP_TRIGGER_DELETE_GOAL = 'CONFIRM POPUP TRIGGER DELETE GOAL'
export const CONFIRM_POPUP_TRIGGER_DELETE_SKILL = 'CONFIRM POPUP TRIGGER DELETE SKILL'
export const CONFIRM_POPUP_TRIGGER_RESET_SKILLS = 'CONFIRM_POPUP_TRIGGER_RESET_SKILLS'
export const CONFIRM_POPUP_TRIGGER_DELETE_ALL_GOALS = 'CONFIRM POPUP TRIGGER DELETE ALL GOALS'
export const CONFIRM_POPUP_TRIGGER_DELETE_WORKSTREAM = 'CONFIRM POPUP TRIGGER DELETE WORKSTREAM'
export const CONFIRM_POPUP_TIMEOUT = 'CONFIRM POPUP TIMEOUT'
export const CONFIRM_POPUP_NOTE_REVISION_HISTORY = 'CONFIRM POPUP NOTE REVISION HISTORY'
export const CONFIRM_POPUP_TRIGGER_INFO = 'CONFIRM POPUP TRIGGER INFO'

export default function ConfirmPopup() {
    const dispatch = useDispatch()
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)
    const showConfirmPopupData = useSelector(state => state.showConfirmPopupData)
    const [processing, setProcessing] = useState(false)

    const actionBtn = useRef(null)

    const onKeyDown = e => {
        const { trigger } = showConfirmPopupData
        if (e.key === 'Escape') {
            if (trigger !== CONFIRM_POPUP_TIMEOUT && trigger !== CONFIRM_POPUP_TRIGGER_KICK_USER_FROM_PROJECT) {
                e.preventDefault()
                hidePopup()
            }
        } else if (e.key === 'Enter') {
            if (trigger !== CONFIRM_POPUP_TRIGGER_KICK_USER_FROM_PROJECT) {
                executeTrigger()
            }
        }
    }

    const hidePopup = e => {
        if (e) e.preventDefault()
        setProcessing(false)
        dispatch([hideFloatPopup(), hideConfirmPopup()])
    }

    const executeTrigger = async e => {
        const { loggedUser, loggedUserProjects } = store.getState()

        if (e) e.preventDefault()

        const { trigger, object } = showConfirmPopupData

        const routeData = {}

        switch (trigger) {
            case CONFIRM_POPUP_TIMEOUT:
                deleteCacheAndRefresh()
                break
            case CONFIRM_POPUP_NOTE_REVISION_HISTORY:
                break
            case CONFIRM_POPUP_TRIGGER_DELETE_GOAL: {
                const { projectId, goal, refKey } = object
                dispatch(setForceCloseGoalEditionId(refKey))
                Backend.deleteGoal(projectId, goal, '')
                hidePopup()
                break
            }
            case CONFIRM_POPUP_TRIGGER_DELETE_SKILL: {
                const { projectId, skill, refKey } = object
                dispatch(setForceCloseSkillEditionId(refKey))
                Backend.deleteSkill(projectId, skill, '', null)
                hidePopup()
                break
            }
            case CONFIRM_POPUP_TRIGGER_RESET_SKILLS: {
                const { projectId } = object
                Backend.resetSkills(projectId)
                hidePopup()
                break
            }
            case CONFIRM_POPUP_TRIGGER_DELETE_ALL_GOALS: {
                const { projectId, goals } = object
                if (goals.length > 0) Backend.deleteAllGoalsInMilestone(projectId, goals)
                hidePopup()
                break
            }
            case CONFIRM_POPUP_TRIGGER_DELETE_USER:
                setProcessing(true)
                const { user } = object
                deleteUser(user)
                break
            case CONFIRM_POPUP_TRIGGER_DELETE_TASK: {
                const { originalTaskName, projectId, task, multiTasks, tasks } = object

                if (!multiTasks) {
                    task.name = originalTaskName
                }
                document.getElementById('root').click()

                if (!multiTasks) {
                    Backend.deleteTask(task, projectId)
                } else {
                    Backend.deleteTaskMultiple(tasks)
                    dispatch(setSelectedTasks(null, true))
                }
                hidePopup()
                break
            }

            case CONFIRM_POPUP_TRIGGER_DELETE_PRE_CONFIG_TASK: {
                const { taskId, projectId, assistantId } = object
                deletePreConfigTask(projectId, assistantId, taskId)
                hidePopup()
                break
            }

            case CONFIRM_POPUP_TRIGGER_DELETE_ASSISTANT: {
                const { projectId, isGlobalAsisstant, assistant } = object

                if (projectId === GLOBAL_PROJECT_ID) {
                    dispatch(navigateToAdmin({ selectedNavItem: DV_TAB_ADMIN_PANEL_ASSISTANTS }))
                    NavigationService.navigate('AdminPanelView')
                } else {
                    dispatch(setSelectedNavItem(DV_TAB_PROJECT_ASSISTANTS))
                    NavigationService.navigate('ProjectDetailedView', {
                        projectIndex: ProjectHelper.getProjectIndexById(projectId),
                    })
                }

                isGlobalAsisstant
                    ? removeGlobalAssistantFromProject(projectId, assistant.uid)
                    : deleteAssistant(projectId, assistant)

                hidePopup()
                break
            }

            case CONFIRM_POPUP_TRIGGER_DELETE_PROJECT: {
                const projectId = object.projectId
                await Backend.removeProject(projectId)
                hidePopup()
                break
            }

            case CONFIRM_POPUP_TRIGGER_DELETE_PROJECT_CONTACT: {
                const projectId = object.projectId
                const contactId = object.contactId
                const contact = object.contact
                await deleteProjectContact(projectId, contact, contactId, loggedUser.uid)
                hidePopup()
                break
            }

            case CONFIRM_POPUP_TRIGGER_CANCEL_PROJECT_INVITATION: {
                const project = object.project
                const userEmail = object.userEmail
                routeData.projectIndex = project.index
                await cancelInvitedUserFromProject(userEmail, project.id)
                hidePopup()
                break
            }

            case CONFIRM_POPUP_TRIGGER_DELETE_WORKFLOW_STEP: {
                const { projectIndex, userUid, stepId, steps, reviewerUid } = object
                const project = loggedUserProjects[projectIndex]
                await removeUserWorkflowStep(project, userUid, stepId, steps, reviewerUid)
                hidePopup()
                break
            }

            case CONFIRM_POPUP_TRIGGER_DELETE_NOTE: {
                const { note, projectId } = object
                deleteNote(projectId, note)
                hidePopup()
                break
            }

            case CONFIRM_POPUP_TRIGGER_DELETE_TOPIC: {
                const { projectId, chat } = object
                removeChatTopic(projectId, chat.id)
                hidePopup()
                break
            }

            case CONFIRM_POPUP_TRIGGER_DELETE_WORKSTREAM: {
                setProcessing(true)
                const { projectId, stream } = object
                await deleteWorkstream(projectId, stream)
                hidePopup()
                break
            }

            case CONFIRM_POPUP_TRIGGER_INFO: {
                hidePopup()
                break
            }
        }

        if (object.navigation) {
            if (object.mainNavigation) {
                dispatch(setSelectedNavItem(object.navigation))
                NavigationService.navigate(object.mainNavigation, routeData)
            } else {
                dispatch(setSelectedSidebarTab(object.navigation))
                NavigationService.navigate('Root')
            }
        }
    }

    const getCustomStyle = () => {
        const { trigger } = showConfirmPopupData

        if (trigger === CONFIRM_POPUP_TRIGGER_KICK_USER_FROM_PROJECT) {
            return {
                popup: {
                    maxWidth: 320,
                },
                popupTexts: {
                    marginBottom: 20,
                },
            }
        }
        return { popup: null, popupTexts: null }
    }

    useEffect(() => {
        document.addEventListener('keydown', onKeyDown)
        return () => {
            document.removeEventListener('keydown', onKeyDown)
        }
    })

    useEffect(() => {
        if (actionBtn.current) actionBtn.current.focus()
    }, [])

    const { trigger, object } = showConfirmPopupData
    const headerTextKey = object.headerText ? object.headerText : 'Be careful with this action'
    const headerQuestionKey = object.headerQuestion
        ? object.headerQuestion
        : 'Do you really want to perform this action?'

    const customStyles = getCustomStyle()

    return (
        <View style={localStyles.container}>
            {trigger === CONFIRM_POPUP_TRIGGER_KICK_USER_FROM_PROJECT ? (
                <KickUserConfirmPopup projectId={object.projectId} userId={object.userId} hidePopup={hidePopup} />
            ) : trigger === CONFIRM_POPUP_MANDATORY_NOTIFICATION ? (
                <NotificationModalMandatory />
            ) : trigger === CONFIRM_POPUP_TIMEOUT ? (
                <NotificationTimeout />
            ) : trigger === CONFIRM_POPUP_NOTE_REVISION_HISTORY ? (
                <RevisionHistoryConfirmationModal
                    projectId={object.projectId}
                    noteId={object.noteId}
                    restoredNoteVersion={object.restoredNoteVersion}
                    currentNoteVersion={object.currentNoteVersion}
                />
            ) : trigger === CONFIRM_POPUP_TRIGGER_PUSH_NOTIFICATIONS ? (
                <PushNotificationsModalMandatory />
            ) : trigger === CONFIRM_POPUP_TRIGGER_INFO ? (
                <View style={[localStyles.infoPopup, smallScreenNavigation && { marginLeft: 300 }]}>
                    <View style={{ marginBottom: 16 }}>
                        <Text style={[styles.title7, { color: '#ffffff' }]}>
                            {translate(headerTextKey, object.headerTextParams)}
                        </Text>
                        <Text style={[styles.body2, { color: colors.Text03, marginTop: 4 }]}>
                            {translate(headerQuestionKey, object.headerQuestionParams)}
                        </Text>
                    </View>
                    <View style={{ flexDirection: 'row' }}>
                        <Button title={translate('Ok')} type={'primary'} onPress={hidePopup} />
                    </View>
                </View>
            ) : (
                <View style={[localStyles.popup, smallScreenNavigation && { marginLeft: 300 }, customStyles.popup]}>
                    <View style={[{ marginBottom: 20 }, customStyles.popupTexts]}>
                        <Text style={[styles.title7, { color: '#ffffff' }]}>
                            {translate(headerTextKey, object.headerTextParams)}
                        </Text>
                        <Text style={[styles.body2, { color: colors.Text03 }]}>
                            {translate(headerQuestionKey, object.headerQuestionParams)}
                        </Text>
                        {object.headerExclamationSentence && (
                            <Text style={[styles.body2, { color: '#ffffff' }]}>{object.headerExclamationSentence}</Text>
                        )}
                    </View>
                    <View style={{ flexDirection: 'row', flex: 0 }}>
                        <Button
                            title={translate('Cancel')}
                            type={'secondary'}
                            onPress={hidePopup}
                            buttonStyle={{ marginRight: 16 }}
                            disabled={processing}
                        />
                        <Button
                            ref={actionBtn}
                            title={translate('Proceed')}
                            type={'danger'}
                            onPress={executeTrigger}
                            processing={processing}
                            disabled={processing}
                            processingTitle={`${translate('Deleting')}...`}
                        />
                    </View>
                </View>
            )}
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        position: 'absolute',
        zIndex: 10000,
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: hexColorToRGBa(colors.Text03, 0.24),
        justifyContent: 'center',
        alignItems: 'center',
    },
    infoPopup: {
        backgroundColor: colors.Secondary400,
        padding: 16,
        shadowColor: 'rgba(0,0,0,0.04)',
        shadowOffset: { width: 0, height: 16 },
        shadowOpacity: 1,
        shadowRadius: 24,
        borderRadius: 4,
        alignItems: 'center',
        maxWidth: 432,
        width: 'auto',
    },
    popup: {
        backgroundColor: colors.Secondary400,
        padding: 16,
        shadowColor: 'rgba(0,0,0,0.04)',
        shadowOffset: { width: 0, height: 16 },
        shadowOpacity: 1,
        shadowRadius: 24,
        borderRadius: 4,
        alignItems: 'center',
    },
    title: {
        color: '#ffffff',
    },
})
