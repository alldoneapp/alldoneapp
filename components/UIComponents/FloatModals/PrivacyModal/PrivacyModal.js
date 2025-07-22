import React, { useState, useEffect } from 'react'
import { StyleSheet, View } from 'react-native'
import { useSelector } from 'react-redux'
import { union } from 'lodash'

import { colors } from '../../../styles/global'
import { applyPopoverWidth, MODAL_MAX_HEIGHT_GAP } from '../../../../utils/HelperFunctions'
import {
    DEFAULT_SKILL_PRIVACY_OBJECT_TYPE,
    FEED_CHAT_OBJECT_TYPE,
    FEED_CONTACT_OBJECT_TYPE,
    FEED_GOAL_OBJECT_TYPE,
    FEED_NOTE_OBJECT_TYPE,
    FEED_PROJECT_OBJECT_TYPE,
    FEED_PUBLIC_FOR_ALL,
    FEED_SKILL_OBJECT_TYPE,
    FEED_TASK_OBJECT_TYPE,
    FEED_USER_OBJECT_TYPE,
} from '../../../Feeds/Utils/FeedsConstants'
import store from '../../../../redux/store'
import ProjectHelper from '../../../SettingsView/ProjectsSettings/ProjectHelper'
import Backend from '../../../../utils/BackendBridge'
import TasksHelper from '../../../TaskListView/Utils/TasksHelper'
import { PRIVACY_MODAL_ID, removeModal, storeModal } from '../../../ModalsManager/modalsManager'
import { withWindowSizeHook } from '../../../../utils/useWindowSize'
import {
    getWorkstreamById,
    getWorkstreamMembers,
    getWorkstreamUserIds,
    isWorkstream,
    WORKSTREAM_ID_PREFIX,
} from '../../../Workstreams/WorkstreamHelper'
import SearchForm from '../AssigneeAndObserversModal/Form/SearchForm'
import ContactsHelper from '../../../ContactsView/Utils/ContactsHelper'
import { translate } from '../../../../i18n/TranslationService'
import SetPrivacyButton from './SetPrivacyButton'
import OptionsList from './OptionsList'
import ModalHeader from '../ModalHeader'
import Line from '../GoalMilestoneModal/Line'
import { BatchWrapper } from '../../../../functions/BatchWrapper/batchWrapper'
import { setProjectContactPrivacy } from '../../../../utils/backends/Contacts/contactsFirestore'
import { setTaskPrivacy } from '../../../../utils/backends/Tasks/tasksFirestore'
import { updateNotePrivacy } from '../../../../utils/backends/Notes/notesFirestore'
import { updateChatPrivacy } from '../../../../utils/backends/Chats/chatsFirestore'
import { setUserPrivacyInProject } from '../../../../utils/backends/Users/usersFirestore'

const getOwnersId = (object, objectType) => {
    switch (objectType) {
        case FEED_USER_OBJECT_TYPE:
            return [object.uid]
        case FEED_CONTACT_OBJECT_TYPE:
            return [object.recorderUserId]
        case FEED_PROJECT_OBJECT_TYPE:
            return [object.creatorId]
        case FEED_TASK_OBJECT_TYPE:
            return [object.userId]
        case FEED_NOTE_OBJECT_TYPE:
            return [object.userId]
        case FEED_CHAT_OBJECT_TYPE:
            return [object.creatorId]
        case FEED_GOAL_OBJECT_TYPE:
            return object.assigneesIds
        case FEED_SKILL_OBJECT_TYPE:
            return [object.userId]
        case DEFAULT_SKILL_PRIVACY_OBJECT_TYPE:
            return [object.userId]
    }
}

const getObjectTypeData = objectType => {
    switch (objectType) {
        case FEED_USER_OBJECT_TYPE:
            return { ownerText: 'User itself', objectText: 'user' }
        case FEED_CONTACT_OBJECT_TYPE:
            return { ownerText: 'Creator', objectText: 'contact' }
        case FEED_PROJECT_OBJECT_TYPE:
            return { ownerText: 'Creator', objectText: 'project' }
        case FEED_TASK_OBJECT_TYPE:
            return { ownerText: 'Assignee', objectText: 'task' }
        case FEED_NOTE_OBJECT_TYPE:
            return { ownerText: 'Owner', objectText: 'note' }
        case FEED_CHAT_OBJECT_TYPE:
            return { ownerText: 'Creator', objectText: 'chat' }
        case FEED_GOAL_OBJECT_TYPE:
            return { ownerText: 'Assignee', objectText: 'goal' }
        case FEED_SKILL_OBJECT_TYPE:
            return { ownerText: 'Owner', objectText: 'skill' }
        case DEFAULT_SKILL_PRIVACY_OBJECT_TYPE:
            return { ownerText: 'Owner', objectText: 'skill' }
    }
}

export const getAllOwnerIds = (projectId, ownerIds) => {
    let secondaryOwnersIds = []

    ownerIds.forEach(ownerId => {
        if (isWorkstream(ownerId)) {
            const memebersIds = getWorkstreamMembers(projectId, ownerId).filter(
                id => !secondaryOwnersIds.includes(id) && !ownerIds.includes(id)
            )
            secondaryOwnersIds - [...secondaryOwnersIds, ...memebersIds]
        } else {
            const mainOwnerContact = TasksHelper.getContactInProject(projectId, ownerId)
            if (mainOwnerContact && !secondaryOwnersIds.includes(mainOwnerContact.recorderUserId))
                secondaryOwnersIds.push(mainOwnerContact.recorderUserId)
        }
    })

    return [...ownerIds, ...secondaryOwnersIds]
}

function PrivacyModal({
    projectId,
    object,
    closePopover,
    delayClosePopover,
    objectType,
    savePrivacyBeforeSaveObject,
    callback,
    style,
    windowSize,
}) {
    const project = useSelector(state => state.loggedUserProjectsMap[projectId])
    const [isPrivate, setIsPrivate] = useState(false)
    const [tmpIsPublicFor, setTmpIsPublicFor] = useState([])
    const [optionList, setOptionList] = useState([])
    const [activeOptionIndex, setActiveOptionIndex] = useState(0)
    const [filterText, setFilterText] = useState('')

    const PUBLIC_ITEM = 0
    const PRIVATE_ITEM = 1

    const ownerIds = getOwnersId(object, objectType)
    const userWithPermanentAccessIds = getAllOwnerIds(projectId, ownerIds)
    const { ownerText, objectText } = getObjectTypeData(objectType)

    const selectItem = () => {
        switch (activeOptionIndex) {
            case PUBLIC_ITEM: {
                done(false, [FEED_PUBLIC_FOR_ALL])
                break
            }
            case PRIVATE_ITEM: {
                done(true, tmpIsPublicFor)
                break
            }
            default: {
                const isPublicFor = selectUser(null, optionList[activeOptionIndex], activeOptionIndex)
                done(true, isPublicFor)
                break
            }
        }
    }

    const setPublic = () => {
        setIsPrivate(false)
        setTmpIsPublicFor(userWithPermanentAccessIds)
    }

    const setPrivate = () => {
        setIsPrivate(true)
    }

    const selectUser = (e, userId, index) => {
        if (e) {
            e.preventDefault()
            e.stopPropagation()
        }

        setIsPrivate(true)
        setActiveOptionIndex(index)

        if (userWithPermanentAccessIds.includes(userId)) {
            return tmpIsPublicFor
        }

        if (isWorkstream(userId)) {
            const workstreamUserIds = getWorkstreamUserIds(projectId, userId)
            let selectedUserIds
            if (tmpIsPublicFor.includes(userId)) {
                selectedUserIds = tmpIsPublicFor.filter(uid => uid !== userId && !workstreamUserIds.includes(uid))
                selectedUserIds = union(selectedUserIds, userWithPermanentAccessIds)
                selectedUserIds.forEach(uid => {
                    if (isWorkstream(uid)) {
                        const wsUserIds = getWorkstreamUserIds(projectId, uid)
                        selectedUserIds = union(selectedUserIds, wsUserIds)
                    }
                })
            } else {
                selectedUserIds = union(tmpIsPublicFor, workstreamUserIds, [userId])
            }
            setTmpIsPublicFor(selectedUserIds)
            return selectedUserIds
        }

        let selectedUserIds
        if (tmpIsPublicFor.includes(userId)) {
            let isInSelectedWorkstream = false
            tmpIsPublicFor.forEach(uid => {
                if (isWorkstream(uid) && getWorkstreamUserIds(projectId, uid).includes(userId))
                    isInSelectedWorkstream = true
            })
            selectedUserIds = isInSelectedWorkstream ? tmpIsPublicFor : tmpIsPublicFor.filter(uid => uid !== userId)
        } else {
            selectedUserIds = [...tmpIsPublicFor, userId]
        }
        setTmpIsPublicFor(selectedUserIds)
        return selectedUserIds
    }

    const done = async (isPrivate, isPublicFor) => {
        if (savePrivacyBeforeSaveObject) {
            objectType === FEED_GOAL_OBJECT_TYPE || objectType === FEED_SKILL_OBJECT_TYPE
                ? closePopover()
                : delayClosePopover()
            savePrivacyBeforeSaveObject(isPrivate, isPublicFor)
        } else {
            switch (objectType) {
                case FEED_GOAL_OBJECT_TYPE:
                    Backend.updateGoalPrivacy(projectId, isPublicFor, object)
                    break
                case FEED_TASK_OBJECT_TYPE:
                    setTaskPrivacy(projectId, object.id, isPrivate, isPublicFor, object)
                    break
                case FEED_NOTE_OBJECT_TYPE:
                    updateNotePrivacy(projectId, object.id, isPrivate, isPublicFor, object.followersIds, false, object)
                    break
                case FEED_CONTACT_OBJECT_TYPE:
                    setProjectContactPrivacy(projectId, object, object.uid, isPrivate, isPublicFor)
                    break
                case FEED_USER_OBJECT_TYPE:
                    setUserPrivacyInProject({ id: projectId }, object, isPrivate, isPublicFor)
                    break
                case FEED_CHAT_OBJECT_TYPE:
                    updateChatPrivacy(projectId, object.id, 'topics', isPublicFor)
                    break
                case FEED_SKILL_OBJECT_TYPE:
                    Backend.updateSkillPrivacy(projectId, object, isPublicFor)
                    break
            }
            if (callback) callback(isPrivate, isPublicFor)
            closePopover()
        }
    }

    const onKeyDown = event => {
        const { key } = event

        if (key === 'Enter') {
            selectItem()
        } else if (key === 'Escape') {
            if (delayClosePopover) {
                delayClosePopover()
            } else if (closePopover) {
                closePopover()
            }
        } else {
            return
        }

        event.preventDefault()
        event.stopPropagation()
    }

    useEffect(() => {
        document.addEventListener('keydown', onKeyDown)
        return () => {
            document.removeEventListener('keydown', onKeyDown)
        }
    })

    useEffect(() => {
        storeModal(PRIVACY_MODAL_ID)
        return () => {
            removeModal(PRIVACY_MODAL_ID)
        }
    }, [])

    const generateOptionsList = () => {
        const { workstreamIds, userIds } = project

        let restOptionList = userIds.filter(uid => !ownerIds.includes(uid))
        if (objectType === FEED_TASK_OBJECT_TYPE || objectType === FEED_GOAL_OBJECT_TYPE) {
            restOptionList = [...workstreamIds.filter(uid => !ownerIds.includes(uid)), ...restOptionList]
        }

        if (filterText.trim())
            restOptionList = restOptionList.filter(uid => {
                const isWorkstream = uid.startsWith(WORKSTREAM_ID_PREFIX)
                const user = isWorkstream
                    ? getWorkstreamById(projectId, uid)
                    : TasksHelper.getPeopleById(uid, projectId)
                return ContactsHelper.matchContactSearch(user, filterText, project.index)
            })

        const optionList = [PUBLIC_ITEM, PRIVATE_ITEM, ...ownerIds, ...restOptionList]

        setOptionList(optionList)
        setActiveOptionIndex(0)
    }

    useEffect(() => {
        generateOptionsList()
    }, [projectId, project.userIds, project.workstreamIds, filterText])

    const setInitialStates = () => {
        const { isPublicFor } = object
        const isPublic = isPublicFor.includes(FEED_PUBLIC_FOR_ALL)

        let filteredIsPublicFor = isPublicFor.filter(element => element !== FEED_PUBLIC_FOR_ALL)
        const selectedUsers = union(filteredIsPublicFor, userWithPermanentAccessIds)

        setTmpIsPublicFor(selectedUsers)
        setIsPrivate(!isPublic)
        setActiveOptionIndex(isPublic ? PUBLIC_ITEM : PRIVATE_ITEM)
    }

    useEffect(() => {
        setInitialStates()
    }, [])

    return (
        <View
            style={[
                localStyles.container,
                applyPopoverWidth(),
                { maxHeight: windowSize[1] - MODAL_MAX_HEIGHT_GAP },
                style,
            ]}
        >
            <View style={localStyles.section}>
                <ModalHeader
                    closeModal={() => {
                        delayClosePopover()
                    }}
                    title={translate(
                        DEFAULT_SKILL_PRIVACY_OBJECT_TYPE
                            ? 'Select who will see the new skills'
                            : `Select who will see this ${objectText}`
                    )}
                    description={translate('Decide if you want to have some privacy')}
                />
            </View>

            <View style={[localStyles.section, { marginBottom: 8 }]}>
                <SearchForm setText={setFilterText} />
            </View>

            <OptionsList
                projectId={projectId}
                isPrivate={isPrivate}
                setPublic={setPublic}
                setPrivate={setPrivate}
                activeOptionIndex={activeOptionIndex}
                ownerText={ownerText}
                selectUser={selectUser}
                optionList={optionList}
                tmpIsPublicFor={tmpIsPublicFor}
                setActiveOptionIndex={setActiveOptionIndex}
                ownerIds={ownerIds}
                userWithPermanentAccessIds={userWithPermanentAccessIds}
            />

            <Line />

            <SetPrivacyButton
                onPress={() => {
                    done(isPrivate, isPrivate ? tmpIsPublicFor : [FEED_PUBLIC_FOR_ALL])
                }}
            />
        </View>
    )
}

export default withWindowSizeHook(PrivacyModal)

const localStyles = StyleSheet.create({
    container: {
        backgroundColor: colors.Secondary400,
        paddingTop: 16,
        paddingBottom: 8,
        borderRadius: 4,
        shadowColor: 'rgba(78, 93, 120, 0.56)',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 1,
        shadowRadius: 16,
        elevation: 3,
    },
    section: {
        paddingLeft: 16,
        paddingRight: 16,
    },
})
