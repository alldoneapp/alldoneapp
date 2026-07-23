import React, { useEffect, useRef, useState } from 'react'
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native'
import { useSelector } from 'react-redux'
import v4 from 'uuid/v4'

import { colors } from '../../../styles/global'
import { translate } from '../../../../i18n/TranslationService'
import { getParentObjectData } from '../../../../utils/backends/Chats/chatsComments'
import { watchTask } from '../../../../utils/backends/Tasks/tasksFirestore'
import { watchGoal } from '../../../../utils/backends/Goals/goalsFirestore'
import { watchSkill } from '../../../../utils/backends/Skills/skillsFirestore'
import { watchChat } from '../../../../utils/backends/Chats/chatsFirestore'
import { unwatch, unwatchNote, watchNote, watchUserData } from '../../../../utils/backends/firestore'
import { watchContactData } from '../../../../utils/backends/Contacts/contactsFirestore'
import ProjectHelper from '../../../SettingsView/ProjectsSettings/ProjectHelper'
import TasksHelper from '../../../TaskListView/Utils/TasksHelper'
import TaskPresentation from '../../../TaskListView/TaskItem/TaskPresentation/TaskPresentation'
import GoalItemPresentation from '../../../GoalsView/GoalItemPresentation'
import ContactItem from '../../../ContactsView/ContactItem'
import NotesItem from '../../../NotesView/NotesItem'
import ChatItem from '../../../ChatsView/ChatItem'
import SkillPresentation from '../../../SettingsView/Profile/Skills/SkillItem/SkillPresentation'
import AssistantPresentation from '../../../AdminPanel/Assistants/AssistantPresentation'
import Header from './Header'

const WATCHED_OBJECT_TYPES = {
    tasks: watchTask,
    goals: watchGoal,
    skills: watchSkill,
    topics: watchChat,
}

export default function CommentPopupObjectHeader({
    projectId,
    objectId,
    objectType,
    objectName,
    onOpen,
    onWorkflowTransitionSuccess,
}) {
    const loggedUserProjects = useSelector(state => state.loggedUserProjects)
    const watcherKeyRef = useRef(`comment-popup-object-${v4()}`)
    const [object, setObject] = useState(null)
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        let mounted = true
        const normalizedObjectType = objectType === 'users' ? 'contacts' : objectType

        const updateObject = nextObject => {
            if (mounted) {
                setObject(nextObject || null)
                setLoading(false)
            }
        }

        getParentObjectData(projectId, objectId, normalizedObjectType)
            .then(data => updateObject(data?.object))
            .catch(error => {
                console.warn('[CommentPopupObjectHeader] Could not load parent object', {
                    projectId,
                    objectId,
                    objectType: normalizedObjectType,
                    error,
                })
                updateObject(null)
            })

        if (normalizedObjectType === 'notes') {
            watchNote(projectId, objectId, updateObject)
        } else if (normalizedObjectType === 'contacts') {
            objectType === 'users'
                ? watchUserData(objectId, false, updateObject, watcherKeyRef.current)
                : watchContactData(projectId, objectId, updateObject, watcherKeyRef.current)
        } else if (WATCHED_OBJECT_TYPES[normalizedObjectType]) {
            WATCHED_OBJECT_TYPES[normalizedObjectType](projectId, objectId, watcherKeyRef.current, updateObject)
        }

        return () => {
            mounted = false
            if (normalizedObjectType === 'notes') {
                unwatchNote(projectId, objectId)
            } else if (normalizedObjectType === 'contacts' || WATCHED_OBJECT_TYPES[normalizedObjectType]) {
                unwatch(watcherKeyRef.current)
            }
        }
    }, [projectId, objectId, objectType])

    if (loading) {
        return (
            <View style={localStyles.loadingContainer} accessibilityLabel={translate('Loading object')}>
                <ActivityIndicator size="small" color={colors.UtilityBlue125} />
            </View>
        )
    }

    if (!object) {
        return <UnavailableObject objectName={objectName} />
    }

    const project = ProjectHelper.getProjectById(projectId)
    const normalizedObjectType = objectType === 'users' ? 'contacts' : objectType
    const projectIndex = loggedUserProjects.findIndex(item => item.id === projectId)
    const isMember = normalizedObjectType === 'contacts' && !!TasksHelper.getUserInProject(projectId, objectId)
    const backgroundColor = colors.Secondary200

    const stopEventPropagation = event => event?.stopPropagation?.()

    return (
        <div
            data-testid={`comment-popup-object-${normalizedObjectType}`}
            onClick={stopEventPropagation}
            onMouseDown={stopEventPropagation}
            onTouchStart={stopEventPropagation}
            style={{ width: '100%' }}
        >
            <View
                testID={`comment-popup-object-surface-${normalizedObjectType}`}
                style={[localStyles.objectContainer, { backgroundColor }]}
            >
                {renderObject({
                    isMember,
                    object,
                    objectType: normalizedObjectType,
                    project,
                    projectId,
                    projectIndex,
                    onOpen,
                    onWorkflowTransitionSuccess,
                })}
            </View>
        </div>
    )
}

const renderObject = ({
    isMember,
    object,
    objectType,
    project,
    projectId,
    projectIndex,
    onOpen,
    onWorkflowTransitionSuccess,
}) => {
    switch (objectType) {
        case 'tasks':
            return (
                <TaskPresentation
                    projectId={projectId}
                    task={object}
                    toggleModal={onOpen}
                    toggleSubTaskList={() => {}}
                    subtaskList={[]}
                    inCommentPopup
                    onCommentPopupWorkflowTransitionSuccess={onWorkflowTransitionSuccess}
                />
            )
        case 'goals':
            return (
                <GoalItemPresentation
                    projectId={projectId}
                    goal={object}
                    onPress={onOpen}
                    parentGoaltasks={[]}
                    inCommentPopup
                />
            )
        case 'contacts':
            return projectIndex >= 0 ? (
                <ContactItem
                    projectIndex={projectIndex}
                    contact={object}
                    isMember={isMember}
                    inCommentPopup
                    onPress={onOpen}
                />
            ) : (
                <UnavailableObject objectName={object.displayName} />
            )
        case 'notes':
            return project ? (
                <NotesItem project={project} note={object} inCommentPopup onPress={onOpen} />
            ) : (
                <UnavailableObject objectName={object.extendedTitle || object.title} />
            )
        case 'topics':
            return project ? (
                <ChatItem project={project} chat={object} inCommentPopup onPress={onOpen} />
            ) : (
                <UnavailableObject objectName={object.title} />
            )
        case 'skills':
            return (
                <SkillPresentation
                    projectId={projectId}
                    skill={object}
                    higherSkill={null}
                    onPress={onOpen}
                    inCommentPopup
                />
            )
        case 'assistants':
            return (
                <AssistantPresentation
                    projectId={projectId}
                    assistant={object}
                    project={project}
                    onAssistantClick={onOpen}
                    inCommentPopup
                />
            )
        default:
            return <UnavailableObject />
    }
}

const UnavailableObject = ({ objectName }) => (
    <View style={localStyles.unavailableContainer} accessibilityLabel={translate('Object unavailable')}>
        <Header title={objectName} />
        <Text style={localStyles.unavailableText}>{translate('This object is no longer available.')}</Text>
    </View>
)

const localStyles = StyleSheet.create({
    objectContainer: {
        borderRadius: 4,
        marginBottom: 20,
        width: '100%',
    },
    loadingContainer: {
        alignItems: 'flex-start',
        minHeight: 38,
        marginBottom: 20,
        paddingVertical: 8,
    },
    unavailableContainer: {
        backgroundColor: colors.Secondary250,
        borderColor: colors.Primary350,
        borderRadius: 4,
        borderWidth: 1,
        marginBottom: 20,
        padding: 12,
    },
    unavailableText: {
        color: colors.UtilityBlue125,
        fontSize: 12,
    },
})
