import React, { useEffect, useRef, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { useSelector } from 'react-redux'

import { colors } from '../../styles/global'
import CommentsWrapper from './CommentsWrapper'
import FeedSourceButton from './FeedSourceButton'
import CreateTaskWrapper from './CreateTaskWrapper'
import Backend from '../../../utils/BackendBridge'
import Button from '../../UIControls/Button'
import GhostButton from '../../UIControls/GhostButton'
import Hotkeys from 'react-hot-keys'
import { execShortcutFn } from '../../../utils/HelperFunctions'
import {
    FEED_CONTACT_OBJECT_TYPE,
    FEED_NOTE_OBJECT_TYPE,
    FEED_GOAL_OBJECT_TYPE,
    FEED_PROJECT_OBJECT_TYPE,
    FEED_TASK_OBJECT_TYPE,
    FEED_USER_OBJECT_TYPE,
    FEED_SKILL_OBJECT_TYPE,
    FEED_ASSISTANT_OBJECT_TYPE,
} from '../Utils/FeedsConstants'
import SharedHelper from '../../../utils/SharedHelper'
import { getFeedObjectTypes } from '../Utils/HelperFunctions'
import { translate } from '../../../i18n/TranslationService'
import { getAssistantData } from '../../../utils/backends/Assistants/assistantsFirestore'
import { getSkillData } from '../../../utils/backends/Skills/skillsFirestore'
import { getContactData } from '../../../utils/backends/Contacts/contactsFirestore'
import { getUserData } from '../../../utils/backends/Users/usersFirestore'

export default function FeedInteractionBarBody(props) {
    const {
        feedObjectType,
        setShowInteractionBar,
        projectId,
        subscribeClickObserver,
        unsubscribeClickObserver,
        feed,
        isHeaderObject,
    } = props

    const followBtnRef = useRef()
    const [existSource, setExistSource] = useState(null)
    const [isFollowed, setIsFollowed] = useState(null)
    const [barLoaded, setBarLoaded] = useState(false)
    const [source, setSource] = useState(null)
    const loggedUser = useSelector(state => state.loggedUser)
    const smallScreen = useSelector(state => state.smallScreen)
    const loggedUserProjects = useSelector(state => state.loggedUserProjects)
    const accessGranted = SharedHelper.accessGranted(loggedUser, projectId)

    let sourceId = ''
    if (feedObjectType === FEED_TASK_OBJECT_TYPE) {
        sourceId = feed.taskId
    } else if (feedObjectType === FEED_CONTACT_OBJECT_TYPE) {
        sourceId = feed.contactId
    } else if (feedObjectType === FEED_USER_OBJECT_TYPE) {
        sourceId = feed.userId
    } else if (feedObjectType === FEED_PROJECT_OBJECT_TYPE) {
        sourceId = feed.projectId
    } else if (feedObjectType === FEED_NOTE_OBJECT_TYPE) {
        sourceId = feed.noteId
    } else if (feedObjectType === FEED_GOAL_OBJECT_TYPE) {
        sourceId = feed.goalId
    } else if (feedObjectType === FEED_SKILL_OBJECT_TYPE) {
        sourceId = feed.skillId
    } else if (feedObjectType === FEED_ASSISTANT_OBJECT_TYPE) {
        sourceId = feed.assistantId
    }

    const closeInteractionBar = () => {
        setShowInteractionBar(false)
    }

    const toogleFollowState = () => {
        const { followObjectsType, followObjectId } = getFeedObjectData()
        const followData = {
            followObjectsType,
            followObjectId,
            feedCreator: loggedUser,
            followObject: source,
        }
        if (isFollowed) {
            Backend.removeFollower(projectId, followData)
        } else {
            Backend.addFollower(projectId, followData)
        }
        closeInteractionBar()
        setIsFollowed(!isFollowed)
    }

    const getFeedObjectData = () => {
        const { userId, contactId, taskId, noteId, goalId, skillId, assistantId } = feed

        if (feedObjectType === 'user') {
            return { followObjectsType: 'users', followObjectId: userId }
        } else if (feedObjectType === 'contact') {
            return { followObjectsType: 'contacts', followObjectId: contactId }
        } else if (feedObjectType === 'task') {
            return { followObjectsType: 'tasks', followObjectId: taskId }
        } else if (feedObjectType === 'project') {
            return { followObjectsType: 'projects', followObjectId: projectId }
        } else if (feedObjectType === 'note') {
            return { followObjectsType: 'notes', followObjectId: noteId }
        } else if (feedObjectType === 'goal') {
            return { followObjectsType: 'goals', followObjectId: goalId }
        } else if (feedObjectType === 'skill') {
            return { followObjectsType: 'skills', followObjectId: skillId }
        } else if (feedObjectType === 'assistant') {
            return { followObjectsType: 'assistants', followObjectId: assistantId }
        }
    }

    const loadInteractionBar = object => {
        if (object) {
            setSource(object)
            setExistSource(true)
        } else {
            setExistSource(false)
        }
    }

    const updateFollowedState = followersIds => {
        const userIsFollowing = followersIds.includes(loggedUser.uid)
        setIsFollowed(userIsFollowing)
    }

    useEffect(() => {
        if (existSource !== null && isFollowed !== null) {
            setBarLoaded(true)
        }
    }, [existSource, isFollowed])

    useEffect(() => {
        const { followObjectsType, followObjectId } = getFeedObjectData()
        Backend.watchFollowers(projectId, followObjectsType, followObjectId, updateFollowedState)
        return Backend.unsubsWatchFollowers
    }, [])

    useEffect(() => {
        const { userId, contactId, taskId, type, noteId, goalId, skillId, assistantId } = feed
        if (type === 'user' || getFeedObjectTypes(type) === 'users') {
            getUserData(userId, false).then(loadInteractionBar)
        } else if (type === 'contact' || getFeedObjectTypes(type) === 'contacts') {
            getContactData(projectId, contactId).then(loadInteractionBar)
        } else if (type === 'task' || getFeedObjectTypes(type) === 'tasks') {
            Backend.getTaskData(projectId, taskId).then(loadInteractionBar)
        } else if (type === 'note' || getFeedObjectTypes(type) === 'notes') {
            Backend.getNote(projectId, noteId).then(loadInteractionBar)
        } else if (type === 'goal' || getFeedObjectTypes(type) === 'goals') {
            Backend.getGoalData(projectId, goalId).then(loadInteractionBar)
        } else if (type === 'assistant' || getFeedObjectTypes(type) === 'assistants') {
            getAssistantData(projectId, assistantId).then(loadInteractionBar)
        } else if (type === 'skill' || getFeedObjectTypes(type) === 'skills') {
            getSkillData(projectId, skillId).then(loadInteractionBar)
        } else if (type === 'project' || getFeedObjectTypes(type) === 'projects') {
            for (let i = 0; i < loggedUserProjects.length; i++) {
                if (loggedUserProjects[i].id === projectId) {
                    loadInteractionBar(loggedUserProjects[i])
                }
            }
        } else {
            setExistSource(true)
        }
    }, [])

    const getKarmaOwnerId = () => {
        const { creatorId, userId, recorderUserId } = feed
        if (creatorId) {
            return creatorId
        } else if (userId) {
            return userId
        } else if (recorderUserId) {
            return recorderUserId
        }
        return ''
    }

    const showSourceButton = existSource || feedObjectType === 'project'

    return (
        barLoaded && (
            <View style={localStyles.container}>
                {showSourceButton && (
                    <FeedSourceButton
                        projectId={projectId}
                        sourceId={sourceId}
                        feedObjectType={feedObjectType}
                        smallScreen={smallScreen}
                        text={isHeaderObject ? 'Open' : 'Source'}
                        disabled={!accessGranted}
                    />
                )}
                {feedObjectType !== 'project' && !feed.isDeleted && (
                    <CommentsWrapper
                        subscribeClickObserver={subscribeClickObserver}
                        unsubscribeClickObserver={unsubscribeClickObserver}
                        style={localStyles.actionButton}
                        projectId={projectId}
                        commentedFeed={feed}
                        smallScreen={smallScreen}
                        setShowInteractionBar={setShowInteractionBar}
                        userGettingKarmaId={getKarmaOwnerId()}
                        assistantId={feed.assistantId}
                    />
                )}

                <CreateTaskWrapper
                    projectId={projectId}
                    subscribeClickObserver={subscribeClickObserver}
                    unsubscribeClickObserver={unsubscribeClickObserver}
                    style={localStyles.actionButton}
                    sourceType={feedObjectType}
                    sourceId={sourceId}
                    existSource={existSource}
                    smallScreen={smallScreen}
                    setShowInteractionBar={setShowInteractionBar}
                    disabled={!accessGranted}
                    source={source}
                />

                {isHeaderObject && (
                    <Hotkeys
                        keyName={'alt+W'}
                        onKeyDown={(sht, event) => execShortcutFn(followBtnRef.current, toogleFollowState, event)}
                        filter={e => true}
                        disabled={!accessGranted}
                    >
                        <GhostButton
                            ref={followBtnRef}
                            title={smallScreen ? null : translate(isFollowed ? 'Followed' : 'Not followed')}
                            type={'ghost'}
                            noBorder={smallScreen}
                            icon={isFollowed ? 'eye' : 'eye-off'}
                            buttonStyle={localStyles.actionButton}
                            pressed={isFollowed}
                            onPress={toogleFollowState}
                            shortcutText={'W'}
                            disabled={!accessGranted}
                        />
                    </Hotkeys>
                )}
                <View style={localStyles.okContainer}>
                    <Button
                        title={smallScreen ? null : 'Ok'}
                        type={'primary'}
                        icon={smallScreen ? 'x' : null}
                        onPress={closeInteractionBar}
                        shortcutText={'Enter'}
                    />
                </View>
            </View>
        )
    )
}

const localStyles = StyleSheet.create({
    container: {
        height: 56,
        backgroundColor: colors.Grey100,
        borderBottomLeftRadius: 4,
        borderBottomRightRadius: 4,
        borderTopColor: colors.Grey300,
        borderTopWidth: 1,
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 8,
        paddingVertical: 8,
    },
    okContainer: {
        flexDirection: 'row',
        flexGrow: 1,
        justifyContent: 'flex-end',
    },
    actionButton: {
        marginRight: 4,
    },
})
