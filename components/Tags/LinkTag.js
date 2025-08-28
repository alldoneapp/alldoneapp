import React, { useEffect, useRef, useState } from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'

import Icon from '../Icon'
import styles, { colors, windowTagStyle } from '../styles/global'
import URLsTasksTrigger from '../../URLSystem/Tasks/URLsTasksTrigger'
import URLsPeopleTrigger from '../../URLSystem/People/URLsPeopleTrigger'
import URLsProjectsTrigger from '../../URLSystem/Projects/URLsProjectsTrigger'
import URLsNotesTrigger from '../../URLSystem/Notes/URLsNotesTrigger'
import URLsGoalsTrigger from '../../URLSystem/Goals/URLsGoalsTrigger'
import URLsChatsTrigger from '../../URLSystem/Chats/URLsChatsTrigger'
import URLsAssistantsTrigger from '../../URLSystem/Assistants/URLsAssistantsTrigger'
import { URL_NOT_MATCH } from '../../URLSystem/URLSystemTrigger'
import URLsTasks, {
    URL_ROOT,
    URL_TASK_DETAILS,
    URL_TASK_DETAILS_CHAT,
    URL_TASK_DETAILS_NOTE,
} from '../../URLSystem/Tasks/URLsTasks'
import * as URLsTasksConstants from '../../URLSystem/Tasks/URLsTasks'
import * as URLsAssistantsConstants from '../../URLSystem/Assistants/URLsAssistants'
import URLsPeople, {
    URL_PEOPLE_DETAILS,
    URL_PEOPLE_DETAILS_CHAT,
    URL_PEOPLE_DETAILS_NOTE,
} from '../../URLSystem/People/URLsPeople'
import * as URLsPeopleConstants from '../../URLSystem/People/URLsPeople'
import URLsProjects, { URL_PROJECT_DETAILS } from '../../URLSystem/Projects/URLsProjects'
import * as URLsProjectsConstants from '../../URLSystem/Projects/URLsProjects'
import URLsNotes, { URL_NOTE_DETAILS, URL_NOTE_DETAILS_CHAT } from '../../URLSystem/Notes/URLsNotes'
import * as URLsNotesConstants from '../../URLSystem/Notes/URLsNotes'
import URLsGoals, {
    URL_GOAL_DETAILS,
    URL_GOAL_DETAILS_CHAT,
    URL_GOAL_DETAILS_NOTE,
} from '../../URLSystem/Goals/URLsGoals'
import * as URLsGoalsConstants from '../../URLSystem/Goals/URLsGoals'
import URLsSkills, * as URLsSkillsConstants from '../../URLSystem/Skills/URLsSkills'
import URLsChats, { URL_CHAT_DETAILS, URL_CHAT_DETAILS_NOTE } from '../../URLSystem/Chats/URLsChats'
import * as URLsChatsConstants from '../../URLSystem/Chats/URLsChats'
import Backend from '../../utils/BackendBridge'
import TasksHelper from '../TaskListView/Utils/TasksHelper'
import ProjectHelper from '../SettingsView/ProjectsSettings/ProjectHelper'
import { isPrivateNote } from '../NotesView/NotesHelper'
import { useSelector } from 'react-redux'
import URLTrigger from '../../URLSystem/URLTrigger'
import NavigationService from '../../utils/NavigationService'
import {
    addProtocol,
    checkDVLink,
    checkIfUrlBelongsToProjectInTheList,
    handleNestedLinks,
    isValidHost,
} from '../../utils/LinkingHelper'
import useWindowSize from '../../utils/useWindowSize'
import ReactDOM from 'react-dom'
import { usePrevious } from '../../utils/UsePrevious'
import { getModalParams, TAGS_EDIT_OBJECT_MODAL_ID } from '../ModalsManager/modalsManager'
import ContactsHelper from '../ContactsView/Utils/ContactsHelper'
import FeedHelper from '../FeedView/Utils/FeedHelper'
import { translate } from '../../i18n/TranslationService'
import { URL_CONTACT_DETAILS_CHAT, URL_CONTACT_DETAILS_NOTE } from '../../URLSystem/Contacts/URLsContacts'
import { URL_SKILL_DETAILS, URL_SKILL_DETAILS_NOTE, URL_SKILL_DETAILS_CHAT } from '../../URLSystem/Skills/URLsSkills'
import { isPrivateSkill } from '../SettingsView/Profile/Skills/SkillsHelper'
import URLsSkillsTrigger from '../../URLSystem/Skills/URLsSkillsTrigger'
import { checkIfUserIsGuideAdmin } from '../Guides/guidesHelper'
import URLsAssistants, {
    URL_ASSISTANT_DETAILS,
    URL_ASSISTANT_DETAILS_CHAT,
    URL_ASSISTANT_DETAILS_NOTE,
} from '../../URLSystem/Assistants/URLsAssistants'
import { GLOBAL_PROJECT_ID, getAssistant, isGlobalAssistant } from '../AdminPanel/Assistants/assistantsHelper'
import AssistantAvatar from '../AdminPanel/Assistants/AssistantAvatar'
import { cleanTextMetaData, shrinkTagText } from '../../functions/Utils/parseTextUtils'

export const MIN_WIDTH_LINK_TAG = 100

export default function LinkTag({
    link = '',
    style,
    tagStyle,
    inTaskDV,
    useCommentTagStyle,
    onPress,
    disabled = false,
    shortTags,
    expandFullTitle = false,
    expandInNote = false,
    projectId,
    taskId,
    iconSize,
    tagContainerStyle,
    aTagStyle,
    setObjectType,
    setObjectProjectId,
    setObjectData,
    setIsPrivate,
    setUserIsMember,
    avatarSize,
}) {
    const [width, height] = useWindowSize()
    const previousWidth = usePrevious(width)
    const [left, setLeft] = useState(0)
    const loggedUser = useSelector(state => state.loggedUser)
    const activeGuideId = useSelector(state => state.activeGuideId)
    const activeTemplateId = useSelector(state => state.activeTemplateId)
    const areArchivedActive = useSelector(state => state.areArchivedActive)
    const mobile = useSelector(state => state.smallScreenNavigation)
    const tablet = useSelector(state => state.isMiddleScreen)
    const textLimit = mobile ? 15 : tablet ? 20 : shortTags ? 25 : 40
    const [enableLink, setEnableLink] = useState(false)
    const [internalLink, setInternalLink] = useState(false)
    const [tagIcon, setTagIcon] = useState('link')
    const [type, setType] = useState(null)
    const [objectId, setObjectId] = useState('')
    const [title, setTitle] = useState(getDomain(link))
    const [linkUrl, setLinkUrl] = useState(addProtocol(link))
    const [shared, setShared] = useState(false)
    const [maxWidth, setMaxWidth] = useState(0)
    const containerRef = useRef()
    let parent
    let tags

    // The clases in this array should be in the same position as its counterpart in the 'matchersList' above,
    // other wise will cause unexpected issues
    const setterList = [
        URLsTasks,
        URLsPeople,
        URLsProjects,
        URLsNotes,
        URLsGoals,
        URLsChats,
        URLsSkills,
        URLsAssistants,
    ]

    const matchersList = [
        URLsTasksTrigger,
        URLsPeopleTrigger,
        URLsProjectsTrigger,
        URLsNotesTrigger,
        URLsGoalsTrigger,
        URLsChatsTrigger,
        URLsSkillsTrigger,
        URLsAssistantsTrigger,
    ]

    if (expandFullTitle) {
        parent = document.querySelector(`[aria-task-id="${taskId}"]`)
        tags = document.getElementById(`social_tags_${projectId}_${taskId}`)
        if (!parent) {
            parent = document.querySelector('[aria-label="dismissible-edit-item"]')
        }
        if (!parent) {
            parent = document.querySelectorAll(`[data-feed-object="${projectId}_${taskId}"]`)[0]
        }
    } else if (expandInNote) {
        parent = document.getElementById('toolbar')
    }

    const expandTitle = (expandFullTitle || expandInNote) && parent && tagIcon !== 'link'

    useEffect(() => {
        if ((expandFullTitle || expandInNote) && parent) {
            const el = ReactDOM.findDOMNode(containerRef.current)
            const { left } = el.getBoundingClientRect()
            setLeft(getLeft(left))
        }
    }, [])

    useEffect(() => {
        if (expandFullTitle && parent) {
            onLayout()
        } else if (expandInNote && parent) {
            if (width < previousWidth) {
                setMaxWidth(maxWidth - (previousWidth - width) - 50)
            } else {
                onLayout()
            }
        }
    }, [width])

    const getLeft = leftElement => {
        if ((expandFullTitle || expandInNote) && parent) {
            const { left: pLeft } = parent?.getBoundingClientRect()
            return leftElement - pLeft
        }
    }

    const onLayout = () => {
        if (expandFullTitle && parent) {
            const { width: pWidth } = parent?.getBoundingClientRect()
            const { width: tWidth } = tags?.getBoundingClientRect() || { width: 0 }
            let maxWidth = pWidth - left - tWidth - 15
            maxWidth = maxWidth < MIN_WIDTH_LINK_TAG ? pWidth - tWidth - 30 : maxWidth
            setMaxWidth(maxWidth)
        } else if (expandInNote && parent) {
            const { width: pWidth } = parent?.getBoundingClientRect()
            const gutter = 50
            let maxWidth = pWidth - left - gutter
            maxWidth = maxWidth < MIN_WIDTH_LINK_TAG ? pWidth - gutter : maxWidth
            setMaxWidth(maxWidth)
        }
    }

    useEffect(() => {
        const watchId = Backend.getId()
        let { objectType, path, projectId, objectId } = processUrl(getPathname(link))
        let newPath = false

        if (objectType !== '' && path !== '') {
            Backend.watchObjectLTag(objectType, path, watchId, data => {
                if (data != null) {
                    setTitleFromObject(objectType, data)
                    setSharedFromObject(objectType, data)
                    setObjectId(objectId)
                    setType(objectType)
                    setLinkUrl(getPathname(link))
                    setInternalLink(true)
                    setEnableLink(true)
                    setObjectType?.(objectType)
                    setObjectProjectId?.(projectId)
                    objectType === 'people' || objectType === 'assistant'
                        ? setObjectData?.({ ...data, uid: objectId })
                        : setObjectData?.({ ...data, id: objectId })
                    setIsPrivate?.(getIsPrivate(objectType, data, projectId))
                } else {
                    Backend.unwatchObjectLTag(objectType, path, watchId)

                    if (objectType === 'people') {
                        const parts = path.split('/')
                        const userPath = `projectsContacts/${projectId}/contacts/${parts[parts.length - 1]}`
                        newPath = userPath

                        Backend.watchObjectLTag(objectType, userPath, watchId, data => {
                            if (data) {
                                const isPrivate =
                                    ContactsHelper.findUserInProject(projectId, loggedUser.uid) ||
                                    ContactsHelper.isPrivateContact(data)

                                setTitleFromObject(objectType, data)
                                setSharedFromObject(objectType, data)
                                setObjectId(objectId)
                                setType(objectType)
                                setLinkUrl(getPathname(link))
                                setInternalLink(true)
                                setEnableLink(true)
                                setTagIcon('user-aster')
                                setObjectType?.(objectType)
                                setObjectProjectId?.(projectId)
                                setObjectData?.({ ...data, uid: objectId })
                                setIsPrivate?.(isPrivate)
                                setUserIsMember?.(false)
                            } else {
                                Backend.unwatchObjectLTag(objectType, userPath, watchId)
                                setTitle(getDomain(link))
                                setLinkUrl(addProtocol(link))
                            }
                        })
                    } else {
                        setTitle(getDomain(link))
                        setLinkUrl(addProtocol(link))
                    }
                }
            })
        } else {
            // Try to process a generic internal url
            const genericProcess = processGenericUrl(getPathname(link))
            objectType = genericProcess.objectType
            if (objectType !== '') {
                setObjectId(objectId)
                setType(objectType)
                setLinkUrl(getPathname(link))
                setInternalLink(true)
                setEnableLink(true)
            } else {
                setTagIcon('link')
                setEnableLink(true)
            }
        }

        return () => {
            if (objectType !== '' && path !== '') {
                Backend.unwatchObjectLTag(objectType, newPath || path, watchId)
            }
        }
    }, [link])

    const checkIfLinkPointToInactiveGuide = initialUrl => {
        const { realGuideProjectIds } = loggedUser
        const pointingToInactiveGuideId = checkIfUrlBelongsToProjectInTheList(initialUrl, realGuideProjectIds)
        return (
            checkIfUserIsGuideAdmin(loggedUser) &&
            activeGuideId !== pointingToInactiveGuideId &&
            pointingToInactiveGuideId
        )
    }

    const checkIfLinkPointToInactiveTemplate = initialUrl => {
        const { realTemplateProjectIds } = loggedUser
        const pointingToInactiveTemplateId = checkIfUrlBelongsToProjectInTheList(initialUrl, realTemplateProjectIds)
        return activeTemplateId !== pointingToInactiveTemplateId && pointingToInactiveTemplateId
    }

    const checkIfLinkPointToInactivArchived = initialUrl => {
        const { realArchivedProjectIds } = loggedUser
        const pointingToArchivedId =
            !areArchivedActive && checkIfUrlBelongsToProjectInTheList(initialUrl, realArchivedProjectIds)
        return pointingToArchivedId
    }

    const processUrl = pathname => {
        let matchedObj = URL_NOT_MATCH
        let params = null
        let objectType = ''
        let objectId = ''
        let path = ''
        let projectId = ''

        for (let key in matchersList) {
            matchedObj = matchersList[key].match(pathname)
            if (matchedObj !== URL_NOT_MATCH && matchedObj.key !== URL_ROOT) {
                break
            }
        }

        if (matchedObj !== URL_NOT_MATCH && matchedObj.key !== URL_ROOT) {
            params = matchedObj.matches.groups

            switch (true) {
                // Process task
                case matchedObj.key.indexOf(URL_TASK_DETAILS) >= 0: {
                    setTagIcon('check-square')
                    objectType = 'task'
                    objectId = params.taskId
                    path = `items/${params.projectId}/tasks/${params.taskId}`
                    projectId = params.projectId
                    break
                }
                // Process assistant
                case matchedObj.key.indexOf(URL_ASSISTANT_DETAILS) >= 0: {
                    setTagIcon('cpu')
                    objectType = 'assistant'
                    objectId = params.assistantId
                    path = `assistants/${
                        isGlobalAssistant(params.assistantId) ? GLOBAL_PROJECT_ID : params.projectId
                    }/items/${params.assistantId}`
                    projectId = params.projectId
                    break
                }
                // Process people
                case matchedObj.key.indexOf(URL_PEOPLE_DETAILS) >= 0: {
                    setTagIcon('user')
                    objectType = 'people'
                    objectId = params.userId
                    path = `users/${params.userId}`
                    projectId = params.projectId

                    const user = TasksHelper.getUserInProject(projectId, params.userId)
                    if (user?.displayName != null && user?.displayName !== '') {
                        setTitle(user.displayName)
                    } else {
                        const contact = TasksHelper.getContactInProject(projectId, params.userId)
                        if (contact?.displayName != null && contact?.displayName !== '') {
                            setTitle(contact.displayName)
                        }
                    }
                    break
                }
                // Process project
                case matchedObj.key.indexOf(URL_PROJECT_DETAILS) >= 0: {
                    setTagIcon('circle')
                    objectType = 'project'
                    objectId = params.projectId
                    path = `/projects/${params.projectId}`
                    projectId = params.projectId

                    const projectName = ProjectHelper.getProjectNameById(params.projectId)
                    if (projectName != null && projectName !== '') {
                        setTitle(projectName)
                    }
                    break
                }
                // Process note
                case matchedObj.key.indexOf(URL_NOTE_DETAILS) >= 0: {
                    setTagIcon('file-text')
                    objectType = 'note'
                    objectId = params.noteId
                    path = `noteItems/${params.projectId}/notes/${params.noteId}`
                    projectId = params.projectId
                    break
                }
                // Process goal
                case matchedObj.key.indexOf(URL_GOAL_DETAILS) >= 0: {
                    setTagIcon('target')
                    objectType = 'goal'
                    objectId = params.goalId
                    path = `goals/${params.projectId}/items/${params.goalId}`
                    projectId = params.projectId

                    /*const goal = findGoalObject(params.goalId)
                    if (goal?.extendedName != null && goal?.extendedName !== '') {
                        setTitle(goal.extendedName)
                    }*/
                    break
                }
                // Process skill
                case matchedObj.key.indexOf(URL_SKILL_DETAILS) >= 0: {
                    setTagIcon('star')
                    objectType = 'skill'
                    objectId = params.skillId
                    path = `skills/${params.projectId}/items/${params.skillId}`
                    projectId = params.projectId
                    break
                }
                // Process topic
                case matchedObj.key.indexOf(URL_CHAT_DETAILS) >= 0: {
                    setTagIcon('comments-thread')
                    objectType = 'topic'
                    objectId = params.chatId
                    path = `chatObjects/${params.projectId}/chats/${params.chatId}`
                    projectId = params.projectId
                    break
                }
            }

            // check for object note url
            assignObjectNoteIcon(matchedObj)

            // check for object chat url
            assignObjectChatIcon(matchedObj)
        }

        return { objectType, path, projectId, objectId, matchedObj }
    }

    const processGenericUrl = pathname => {
        let keyMatch = -1
        let matchedObj = URL_NOT_MATCH
        let params = null
        let objectType = ''
        let objectId = ''
        let path = ''
        let projectId = ''

        for (let key in matchersList) {
            matchedObj = matchersList[key].match(pathname)
            keyMatch = key
            if (matchedObj !== URL_NOT_MATCH && matchedObj.key !== URL_ROOT) {
                break
            }
        }

        if (matchedObj !== URL_NOT_MATCH && matchedObj.key !== URL_ROOT) {
            params = matchedObj.matches.groups
            setTitle(
                setterList[keyMatch].setTitle(matchedObj.key, true, ...(params ? Object.values(params) : [])) ||
                    `${translate('Generic internal link')}...`
            )

            switch (true) {
                // Process task
                case Object.values(URLsTasksConstants).includes(matchedObj.key): {
                    setTagIcon('check-square')
                    objectType = 'task'
                    break
                }
                // Process assistant
                case Object.values(URLsAssistantsConstants).includes(matchedObj.key): {
                    setTagIcon('cpu')
                    objectType = 'assistant'
                    break
                }
                // Process people
                case Object.values(URLsPeopleConstants).includes(matchedObj.key): {
                    setTagIcon('users')
                    objectType = 'people'
                    break
                }
                // Process project
                case Object.values(URLsProjectsConstants).includes(matchedObj.key): {
                    setTagIcon('circle')
                    objectType = 'project'
                    break
                }
                // Process note
                case Object.values(URLsNotesConstants).includes(matchedObj.key): {
                    setTagIcon('file-text')
                    objectType = 'note'
                    break
                }
                // Process goal
                case Object.values(URLsGoalsConstants).includes(matchedObj.key): {
                    setTagIcon('target')
                    objectType = 'goal'
                    break
                }
                // Process skill
                case Object.values(URLsSkillsConstants).includes(matchedObj.key): {
                    setTagIcon('star')
                    objectType = 'skill'
                    break
                }
                // Process topic
                case Object.values(URLsChatsConstants).includes(matchedObj.key): {
                    setTagIcon('comments-thread')
                    objectType = 'topic'
                    break
                }
            }
        }

        return { objectType, path, projectId, objectId, matchedObj }
    }

    const assignObjectNoteIcon = matchedObj => {
        const notesTabs = [
            URL_TASK_DETAILS_NOTE,
            URL_GOAL_DETAILS_NOTE,
            URL_PEOPLE_DETAILS_NOTE,
            URL_CONTACT_DETAILS_NOTE,
            URL_CHAT_DETAILS_NOTE,
            URL_SKILL_DETAILS_NOTE,
            URL_ASSISTANT_DETAILS_NOTE,
        ]
        if (notesTabs.includes(matchedObj.key)) {
            setTagIcon('file-text')
        }
    }

    const assignObjectChatIcon = matchedObj => {
        const notesTabs = [
            URL_TASK_DETAILS_CHAT,
            URL_GOAL_DETAILS_CHAT,
            URL_NOTE_DETAILS_CHAT,
            URL_PEOPLE_DETAILS_CHAT,
            URL_CONTACT_DETAILS_CHAT,
            URL_SKILL_DETAILS_CHAT,
            URL_ASSISTANT_DETAILS_CHAT,
        ]
        if (notesTabs.includes(matchedObj.key)) {
            setTagIcon('comments-thread')
        }
    }

    const setSharedFromObject = (objectType, data) => {
        setShared(
            (objectType === 'task' && !TasksHelper.isPrivateTask(data)) ||
                (objectType === 'note' && !isPrivateNote(data))
        )
    }

    const setTitleFromObject = (objectType, data) => {
        switch (objectType) {
            case 'task': {
                const cleanedText = cleanTextMetaData(data.extendedName || data.name)
                setTitle(cleanedText)
                break
            }
            case 'assistant': {
                setTitle(data.displayName)
                break
            }
            case 'people': {
                setTitle(data.displayName)
                break
            }
            case 'project': {
                setTitle(data.name)
                break
            }
            case 'note': {
                const cleanedText = cleanTextMetaData(data.extendedTitle || data.title)
                setTitle(cleanedText)
                break
            }
            case 'goal': {
                const cleanedText = cleanTextMetaData(data.extendedName || data.name)
                setTitle(cleanedText)
                break
            }
            case 'skill': {
                const cleanedText = cleanTextMetaData(data.extendedName)
                setTitle(cleanedText)
                break
            }
            case 'topic': {
                const cleanedText = cleanTextMetaData(data.title)
                setTitle(cleanedText)
                break
            }
        }
    }

    const getIsPrivate = (objectType, data, objectProjectId) => {
        if (ContactsHelper.findUserInProject(objectProjectId, loggedUser.uid) === null) {
            return true
        } else {
            switch (objectType) {
                case 'task': {
                    return TasksHelper.isPrivateTask(data)
                }
                case 'assistant': {
                    return false
                }
                case 'people': {
                    const projectIndex = ProjectHelper.getProjectIndexById(projectId)
                    return ContactsHelper.isPrivateUser(projectIndex, data)
                }
                case 'project': {
                    return false
                }
                case 'note': {
                    return isPrivateNote(data)
                }
                case 'goal': {
                    return false
                }
                case 'skill': {
                    return isPrivateSkill(data, null)
                }
                case 'topic': {
                    return FeedHelper.isPrivateTopic(data)
                }
            }
        }
    }

    const openLink = () => {
        if (enableLink) {
            const pointingToInactiveGuideId = checkIfLinkPointToInactiveGuide(linkUrl)
            const pointingToInactiveTemplate = !pointingToInactiveGuideId && checkIfLinkPointToInactiveTemplate(linkUrl)
            const pointingToArchivedGuideId =
                !pointingToInactiveGuideId && !pointingToInactiveTemplate && checkIfLinkPointToInactivArchived(linkUrl)
            if (pointingToInactiveGuideId) {
                window.location.href = linkUrl
            } else if (pointingToInactiveTemplate) {
                window.location.href = linkUrl
            } else if (pointingToArchivedGuideId) {
                window.location.href = linkUrl
            } else if (onPress) {
                onPress()
            } else {
                if (internalLink && getModalParams(TAGS_EDIT_OBJECT_MODAL_ID) == null) {
                    if (!loggedUser.isAnonymous || shared) {
                        checkDVLink(type)
                        URLTrigger.processUrl(NavigationService, linkUrl)
                    }
                } else {
                    window.open(linkUrl, '_blank')
                }
            }
        }
    }

    const getCustomStyle = (customStyle = {}, overwriteStyle = {}) => {
        const baseStyle = inTaskDV
            ? { height: 32, paddingRight: 12, paddingLeft: 7 }
            : useCommentTagStyle
            ? { minHeight: 20, height: 20, paddingRight: 6 }
            : { height: 24 }
        return { ...customStyle, ...baseStyle, ...overwriteStyle }
    }

    const finalCleanup = text => {
        let firstSlash = text.indexOf('/')

        if (firstSlash > -1) {
            return text.substr(0, firstSlash)
        } else {
            return text
        }
    }

    const getShortExternalUrl = title => {
        let shortExternalUrl = finalCleanup(title)
        shortExternalUrl = title.length >= textLimit ? shortExternalUrl + '...' : shortExternalUrl
        return shortExternalUrl
    }

    const getShrinkTagText = (title, textLimit) => {
        const tagText = handleNestedLinks(title)
        return shrinkTagText(tagText, textLimit)
    }

    const getAssistantPhotoURL = () => {
        const assistant = getAssistant(objectId)
        return assistant ? assistant.photoURL50 : ''
    }

    const assistantPhotoURL = tagIcon === 'cpu' ? getAssistantPhotoURL() : ''

    return (
        <TouchableOpacity
            ref={containerRef}
            onLayout={() => onLayout()}
            style={[localStyles.touch, expandTitle && { maxWidth: maxWidth }, tagStyle]}
            disabled={disabled}
        >
            <a
                style={getCustomStyle(
                    expandTitle
                        ? { textDecoration: 'none', maxWidth: maxWidth, cursor: disabled ? 'default' : 'pointer' }
                        : { textDecoration: 'none', cursor: disabled ? 'default' : 'pointer' },
                    aTagStyle
                )}
                href={linkUrl}
                target="_blank"
                onClick={e => {
                    e.stopPropagation()
                    e.preventDefault()
                    if (!disabled) {
                        openLink()
                    }
                }}
                disabled={disabled}
            >
                <View
                    style={[
                        localStyles.urlTag,
                        getCustomStyle(expandTitle && { maxWidth: maxWidth }),
                        tagContainerStyle,
                    ]}
                >
                    {tagIcon === 'cpu' ? (
                        <AssistantAvatar
                            photoURL={assistantPhotoURL}
                            size={avatarSize ? avatarSize : inTaskDV ? 24 : useCommentTagStyle ? 16 : 20}
                            assistantId={objectId}
                        />
                    ) : (
                        <Icon
                            size={iconSize || (inTaskDV ? 18 : useCommentTagStyle ? 14 : 16)}
                            name={tagIcon}
                            color={colors.Primary100}
                        />
                    )}

                    <Text
                        style={[
                            localStyles.urlText,
                            inTaskDV && styles.title6,
                            { paddingLeft: inTaskDV ? 7 : useCommentTagStyle ? 2 : 4 },
                            useCommentTagStyle && { ...styles.caption1 },
                            expandTitle && { whiteSpace: 'nowrap', maxWidth: maxWidth },
                            { ...style, color: colors.Primary100 },
                            !inTaskDV && windowTagStyle(),
                        ]}
                        numberOfLines={1}
                    >
                        {expandTitle
                            ? handleNestedLinks(title)
                            : tagIcon === 'link'
                            ? getShortExternalUrl(title)
                            : getShrinkTagText(title, textLimit)}
                    </Text>
                </View>
            </a>
        </TouchableOpacity>
    )
}

export const getDomain = link => {
    let hostname = link

    if (link.indexOf('//') > -1) {
        hostname = link.split('//')[1]
    }
    hostname = hostname.replace('www.', '')
    return hostname
}

export const getPathname = url => {
    let tmpURL = addProtocol(url)
    try {
        const obj = new URL(tmpURL)
        return obj.host === window.location.host || isValidHost(obj.host) ? obj.pathname : url
    } catch (e) {
        if (url === '') {
            console.log('Blank URL')
        } else {
            console.log(e)
        }
    }

    return url
}

const localStyles = StyleSheet.create({
    touch: {
        display: 'inline-flex',
        flexDirection: 'row',
        alignItems: 'center',
        maxWidth: '100%',
    },
    urlTag: {
        backgroundColor: '#D6EBFF',
        paddingLeft: 4,
        paddingRight: 8,
        borderRadius: 50,
        flexDirection: 'row',
        alignItems: 'center',
    },
    urlText: {
        ...styles.subtitle2,
        color: colors.Primary100,
    },
})
