import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { Dimensions } from 'react-native'
import ReactQuill from 'react-quill'
import v4 from 'uuid/v4'
import { useDispatch, useSelector } from 'react-redux'

import {
    setAssistantEnabled,
    setIsQuillTagEditorOpen,
    setQuillEditorProjectId,
    setQuillTextInputProjectIdsByEditorId,
} from '../../../redux/actions'
import CustomScrollView from '../../UIControls/CustomScrollView'
import WrapperMentionsModal from './WrapperMentionsModal'
import {
    ALLOWED_FORMATS,
    cleanTagsInteractionsPopus,
    COMMENT_MODAL_THEME,
    CREATE_PROJECT_THEME_DEFAULT,
    CREATE_SUBTASK_MODAL_THEME,
    CREATE_TASK_MODAL_THEME,
    createPlaceholder,
    getElementOffset,
    GOAL_THEME,
    MENTION_MODAL_CONTACTS_TAB,
    MENTION_MODAL_GOALS_TAB,
    MENTION_MODAL_NOTES_TAB,
    MENTION_MODAL_RIGHT_MARGIN,
    MENTION_MODAL_TASKS_TAB,
    MENTION_MODAL_TOPICS_TAB,
    MENTION_MODAL_WIDTH,
    NEW_TOPIC_MODAL_THEME,
    NOT_USER_MENTIONED,
    onCopy,
    processPastedText,
    processPastedTextWithBreakLines,
    QUILL_EDITOR_TEXT_INPUT_TYPE,
    SEARCH_THEME,
    SUBTASK_THEME,
    TASK_THEME,
    updateTextUsingDeltaOps,
    beforeUndoRedo,
    CREATE_PROJECT_THEME_MODERN,
    INVITE_THEME_MODERN,
    INVITE_THEME_DEFAULT,
} from './textInputHelper'
import {
    ATTACHMENT_TRIGGER,
    IMAGE_TRIGGER,
    KARMA_TRIGGER,
    MENTION_SPACE_CODE,
    MILESTONE_TAG_TRIGGER,
    VIDEO_TRIGGER,
} from '../Utils/HelperFunctions'
import './styles.css'
import {
    formatUrl,
    getUrlObject,
    isValidContactLink,
    isValidGoalLink,
    isValidSkillLink,
    isValidNoteLink,
    isValidProjectLink,
    isValidTaskLink,
    isValidAssistantLink,
    getDvMainTabLink,
} from '../../../utils/LinkingHelper'
import Backend from '../../../utils/BackendBridge'
import ProjectHelper, { ALL_PROJECTS_INDEX } from '../../SettingsView/ProjectsSettings/ProjectHelper'
import TasksHelper from '../../TaskListView/Utils/TasksHelper'
import { setTaskAssistant } from '../../../utils/backends/Tasks/tasksFirestore'
import { setNoteAssistant } from '../../../utils/backends/Notes/notesFirestore'
import { setUserAssistant } from '../../../utils/backends/Users/usersFirestore'
import { setContactAssistant, copyContactToProject } from '../../../utils/backends/Contacts/contactsFirestore'
import { setGoalAssistant } from '../../../utils/backends/Goals/goalsFirestore'
import { setSkillAssistant } from '../../../utils/backends/Skills/skillsFirestore'
import { updateChatAssistant } from '../../../utils/backends/Chats/chatsFirestore'
import { GLOBAL_PROJECT_ID, isGlobalAssistant } from '../../AdminPanel/Assistants/assistantsHelper'

const Delta = ReactQuill.Quill.import('delta')

export let quillTextInputRefs = {}
export let quillTextInputProjectIds = {}
export let quillTextInputIsCalendarTask = {}

function CustomTextInput3(
    {
        placeholder,
        onChangeText,
        onChangeDelta,
        fixedHeight,
        maxHeight,
        disabledEdition,
        containerStyle,
        projectIndex,
        projectId,
        setMentionsModalActive,
        initialTextExtended,
        styleTheme,
        singleLine,
        disabledTags,
        disabledMentions,
        onKeyPress,
        isMobileView,
        keyboardType,
        userIdAllowedToEditTags,
        inMentionsEditionTag,
        selectUserToMentionEditTag,
        inGenericTask,
        genericData,
        setInputCursorIndex,
        setEditor,
        initialDeltaOps,
        initialCursorIndex,
        disabledEnterKey,
        disabledTabKey,
        setInitialLinkedObject,
        otherFormats,
        externalEditorId,
        keepBreakLines,
        onCustomSelectionChange,
        isCalendarTask,
        forceTriggerEnterActionForBreakLines,
        characterLimit,
        setShowRunOutGoalModal,
        chatAssistantData,
        setAssistantId,
        autoFocus,
        onMentionSelected,
    },
    ref
) {
    const dispatch = useDispatch()
    const showMentionPopupRef = useRef(false)
    const quillRef = useRef(null)
    const reactQuillRef = useRef(null)
    const selectionRef = useRef({ index: 0, length: 0 })
    const mentionTextRef = useRef('')
    const quillKeyboardBindingsTabRef = useRef(null)

    const gold = useSelector(state => state.loggedUser.gold)
    const loggedUserId = useSelector(state => state.loggedUser.uid)
    const loggedUserProjects = useSelector(state => state.loggedUserProjects)

    const [userEditingTagsId, setUserEditingTagsId] = useState(
        userIdAllowedToEditTags ? userIdAllowedToEditTags : loggedUserId
    )
    const [editorId, setEditorId] = useState(externalEditorId ? externalEditorId : v4())
    const [editorElement, setEditorElement] = useState(null)
    const [containerElement, setContainerElement] = useState(null)
    const [selectionBounds, setSelectionBounds] = useState({ top: 0, left: 0 })
    const [html, setHtml] = useState('')
    const [mentionModalHeight, setMentionModalHeight] = useState(0)
    const [flag, setFlag] = useState(false)

    projectIndex =
        projectId === GLOBAL_PROJECT_ID
            ? ALL_PROJECTS_INDEX
            : projectIndex
            ? projectIndex
            : projectId && ProjectHelper.getProjectIndexById(projectId)
    const innerProjectId = projectId ? projectId : projectIndex ? loggedUserProjects[projectIndex].id : undefined

    const textRef = useRef('')
    const mentionStartIndexRef = useRef(0)
    const mentionLastHalfTextRef = useRef('')

    const processPastedFn = keepBreakLines ? processPastedTextWithBreakLines : processPastedText

    const allowMentions = !disabledTags && !disabledMentions && !inMentionsEditionTag

    //MENTIONS
    const tryToOpenMentionModalBySelection = contentLength => {
        if (allowMentions && contentLength === textRef.current.length) {
            const previousCharacter = textRef.current[selectionRef.current.index - 1]
            if (previousCharacter === '@') {
                const previousPreviousCharacter = textRef.current[selectionRef.current.index - 2]
                if (!previousPreviousCharacter || previousPreviousCharacter.match(/\s|&/)) {
                    startToMention(textRef.current, selectionRef.current.index)
                }
            }
        }
    }

    const startToMention = (text, cursorIndex) => {
        showMentionPopupRef.current = true
        if (setMentionsModalActive) {
            setMentionsModalActive(true)
        }

        mentionStartIndexRef.current = cursorIndex

        let lastHalfText = text.substring(cursorIndex)
        if (lastHalfText[0] === '&') {
            mentionTextRef.current = ''
            mentionLastHalfTextRef.current = lastHalfText
        } else {
            const wordsInLastHalf = lastHalfText.split(/\s|&/)
            mentionTextRef.current = wordsInLastHalf[0] ? wordsInLastHalf[0] : ''
            const newCursorIndex = cursorIndex + wordsInLastHalf[0].length
            lastHalfText = text.substring(newCursorIndex)
            mentionLastHalfTextRef.current = lastHalfText
            setTimeout(() => {
                quillRef.current.setSelection(newCursorIndex, 0, 'user')
            })
        }
    }

    const updateMentionText = text => {
        if (showMentionPopupRef.current) {
            mentionTextRef.current = text.substring(
                mentionStartIndexRef.current,
                text.length - mentionLastHalfTextRef.current.length
            )
        }
    }

    const checkMentionModalState = contentLength => {
        if (showMentionPopupRef.current) {
            const { index: cursorIndex, length: selectionLength } = selectionRef.current
            const mentionEndIndex = contentLength - mentionLastHalfTextRef.current.length

            if (cursorIndex < mentionStartIndexRef.current || cursorIndex + selectionLength > mentionEndIndex) {
                insertNormalMention()
            }
        } else {
            tryToOpenMentionModalBySelection(contentLength)
        }
    }

    const insertNormalMention = () => {
        const mentionText = mentionTextRef.current
        const mentionPosition = mentionStartIndexRef.current

        closeMentionPopup()
        const cleanText = mentionText.trim()
        if (cleanText.length > 0 && !inMentionsEditionTag) {
            selectionRef.current = { index: mentionPosition - 1, length: 0 }
            let parsedText = cleanText.replaceAll(/\s+/g, ' ')
            parsedText = parsedText.replaceAll(' ', MENTION_SPACE_CODE)
            const mention = {
                text: parsedText,
                id: v4(),
                userId: NOT_USER_MENTIONED,
                editorId,
                userEditingTagsId,
            }
            const delta = new Delta()
            delta.retain(selectionRef.current.index)
            delta.insert({ mention })
            delta.insert(' ')
            delta.delete(mentionText.length + 1)
            quillRef.current.updateContents(delta, 'user')
            if (quillRef.current.getSelection().length > 0) {
                quillRef.current.setSelection(selectionRef.current.index, 0, 'user')
            }
        }
        setFlag(!flag)
    }

    const selectItemToMention = async (item, activeTab) => {
        if (onMentionSelected) onMentionSelected(item, activeTab)
        if (selectUserToMentionEditTag) {
            selectUserToMentionEditTag(item)
        } else if (activeTab === MENTION_MODAL_CONTACTS_TAB) {
            if (item.isAssistant) {
                const { uid: assistantId } = item
                selectionRef.current = { index: mentionStartIndexRef.current - 1, length: 0 }
                const assistantUrl = `${window.location.origin}${getDvMainTabLink(
                    projectId,
                    assistantId,
                    'assistants'
                )}`
                const execRes = formatUrl(assistantUrl)
                if (execRes) {
                    const url = getUrlObject(assistantUrl, execRes, projectId, editorId, userIdAllowedToEditTags)
                    const delta = new Delta()
                    delta.retain(mentionStartIndexRef.current - 1)
                    delta.insert({ url })
                    delta.insert(' ')
                    delta.delete(mentionTextRef.current.length + 1)
                    quillRef.current.updateContents(delta, 'user')

                    if (chatAssistantData) {
                        const { objectId, objectAssistantId, objectType } = chatAssistantData
                        if (objectAssistantId !== assistantId) {
                            setAssistantId?.(assistantId)
                            switch (objectType) {
                                case 'tasks':
                                    setTaskAssistant(projectId, objectId, assistantId, true)
                                    break
                                case 'notes':
                                    setNoteAssistant(projectId, objectId, assistantId, true)
                                    break
                                case 'contacts':
                                    const isUser = !!TasksHelper.getUserInProject(projectId, objectId)
                                    isUser
                                        ? setUserAssistant(projectId, objectId, assistantId, true)
                                        : setContactAssistant(projectId, objectId, assistantId, true)
                                    break
                                case 'users':
                                    setUserAssistant(projectId, objectId, assistantId, true)
                                    break
                                case 'goals':
                                    setGoalAssistant(projectId, objectId, assistantId, true)
                                    break
                                case 'skills':
                                    setSkillAssistant(projectId, objectId, assistantId, true)
                                    break
                                case 'topics':
                                    updateChatAssistant(projectId, objectId, assistantId)
                                    break
                            }
                        }
                        if (gold > 0) {
                            dispatch(setAssistantEnabled(true))
                        } else {
                            if (setShowRunOutGoalModal) setShowRunOutGoalModal(true)
                        }
                    }
                }
            } else {
                // Copy contact to current project if selected from a different project
                let contactUserId = item.uid
                if (item.projectId && innerProjectId && item.projectId !== innerProjectId) {
                    const copiedContact = await copyContactToProject(innerProjectId, item)
                    if (copiedContact) contactUserId = copiedContact.uid
                }

                const contactName = item.displayName.replaceAll(' ', MENTION_SPACE_CODE)
                selectionRef.current = { index: mentionStartIndexRef.current - 1, length: 0 }
                const mention = { text: contactName, id: v4(), userId: contactUserId, editorId, userEditingTagsId }
                const delta = new Delta()
                delta.retain(mentionStartIndexRef.current - 1)
                delta.insert({ mention })
                delta.insert(' ')
                delta.delete(mentionTextRef.current.length + 1)
                quillRef.current.updateContents(delta, 'user')
            }
        } else if (activeTab === MENTION_MODAL_TASKS_TAB) {
            if (item.isPreConfigTask) {
                // Pre-configured task from AI assistant - create special URL
                const { id: taskId, assistantId, name: taskName } = item
                const assistantProjectId = isGlobalAssistant(assistantId) ? GLOBAL_PROJECT_ID : projectId
                selectionRef.current = { index: mentionStartIndexRef.current - 1, length: 0 }

                const preConfigTaskUrl = `${window.location.origin}${getDvMainTabLink(
                    projectId,
                    taskId,
                    'preConfigTasks'
                )}?assistantId=${assistantId}&assistantProjectId=${assistantProjectId}&name=${encodeURIComponent(
                    taskName || ''
                )}`

                const execRes = formatUrl(preConfigTaskUrl)
                if (execRes) {
                    const url = getUrlObject(preConfigTaskUrl, execRes, projectId, editorId, userIdAllowedToEditTags)
                    const delta = new Delta()
                    delta.retain(mentionStartIndexRef.current - 1)
                    delta.insert({ url })
                    delta.insert(' ')
                    delta.delete(mentionTextRef.current.length + 1)
                    quillRef.current.updateContents(delta, 'user')
                }
            } else {
                // Regular task
                const { id } = item
                selectionRef.current = { index: mentionStartIndexRef.current - 1, length: 0 }
                const taskUrl = `${window.location.origin}${getDvMainTabLink(projectId, id, 'tasks')}`
                const execRes = formatUrl(taskUrl)
                if (execRes) {
                    const url = getUrlObject(taskUrl, execRes, projectId, editorId, userIdAllowedToEditTags)
                    const delta = new Delta()
                    delta.retain(mentionStartIndexRef.current - 1)
                    delta.insert({ url })
                    delta.insert(' ')
                    delta.delete(mentionTextRef.current.length + 1)
                    quillRef.current.updateContents(delta, 'user')
                }
            }
        } else if (activeTab === MENTION_MODAL_NOTES_TAB) {
            const { id } = item
            selectionRef.current = { index: mentionStartIndexRef.current - 1, length: 0 }
            const noteUrl = `${window.location.origin}${getDvMainTabLink(projectId, id, 'notes')}`
            const execRes = formatUrl(noteUrl)
            if (execRes) {
                const url = getUrlObject(noteUrl, execRes, projectId, editorId, userIdAllowedToEditTags)
                const delta = new Delta()
                delta.retain(mentionStartIndexRef.current - 1)
                delta.insert({ url })
                delta.insert(' ')
                delta.delete(mentionTextRef.current.length + 1)
                quillRef.current.updateContents(delta, 'user')
            }
        } else if (activeTab === MENTION_MODAL_TOPICS_TAB) {
            const { id } = item
            selectionRef.current = { index: mentionStartIndexRef.current - 1, length: 0 }
            const topicUrl = `${window.location.origin}${getDvMainTabLink(projectId, id, 'chats')}`
            const execRes = formatUrl(topicUrl)
            if (execRes) {
                const url = getUrlObject(topicUrl, execRes, projectId, editorId, userIdAllowedToEditTags)
                const delta = new Delta()
                delta.retain(mentionStartIndexRef.current - 1)
                delta.insert({ url })
                delta.insert(' ')
                delta.delete(mentionTextRef.current.length + 1)
                quillRef.current.updateContents(delta, 'user')
            }
        } else if (activeTab === MENTION_MODAL_GOALS_TAB) {
            const { id } = item
            selectionRef.current = { index: mentionStartIndexRef.current - 1, length: 0 }
            const goalUrl = `${window.location.origin}${getDvMainTabLink(projectId, id, 'goals')}`
            const execRes = formatUrl(goalUrl)
            if (execRes) {
                const url = getUrlObject(goalUrl, execRes, projectId, editorId, userIdAllowedToEditTags)
                const delta = new Delta()
                delta.retain(mentionStartIndexRef.current - 1)
                delta.insert({ url })
                delta.insert(' ')
                delta.delete(mentionTextRef.current.length + 1)
                quillRef.current.updateContents(delta, 'user')
            }
        }

        setTimeout(() => {
            closeMentionPopup()
            setFlag(prev => !prev)
            quillRef.current.focus()
        })
    }

    const closeMentionPopup = () => {
        if (showMentionPopupRef.current) {
            showMentionPopupRef.current = false
            if (setMentionsModalActive) {
                setMentionsModalActive(false)
            }
            mentionStartIndexRef.current = 0
            mentionLastHalfTextRef.current = ''
            mentionTextRef.current = ''
        }
    }

    const getMentionModalLocation = selectionIndex => {
        const mentionModalParentOffset = getElementOffset(document.body)
        const editorOffset = getElementOffset(editorElement)

        const { bottom, left } = quillRef.current.getBounds(selectionIndex)

        const windowWidth = Dimensions.get('window').width
        const windowHeight = Dimensions.get('window').height

        let bounds = {}
        if (inMentionsEditionTag) {
            bounds = {
                left: editorOffset.left - mentionModalParentOffset.left - 61,
                top: bottom + (editorOffset.top - mentionModalParentOffset.top) + 16,
            }
        } else {
            bounds = {
                left: left + editorOffset.left - mentionModalParentOffset.left,
                top: bottom + (editorOffset.top - mentionModalParentOffset.top),
            }
        }

        const rightBoundary = windowWidth - MENTION_MODAL_WIDTH - MENTION_MODAL_RIGHT_MARGIN
        const bottomBoundary = windowHeight - mentionModalHeight - MENTION_MODAL_RIGHT_MARGIN
        if (bounds.left + mentionModalParentOffset.left > rightBoundary) {
            bounds.left = rightBoundary - mentionModalParentOffset.left
        }

        if (bounds.top + mentionModalParentOffset.top > bottomBoundary) {
            bounds.top = bottomBoundary - mentionModalParentOffset.top
        }
        const spaceBetweenAtAndModal = 12
        bounds.top += spaceBetweenAtAndModal
        setSelectionBounds(bounds)
    }

    useEffect(() => {
        if (mentionModalHeight > 0 && (!showMentionPopupRef.current || inMentionsEditionTag)) {
            getMentionModalLocation(
                selectionRef.current.index === 0 ? textRef.current.length : selectionRef.current.index
            )
        }
    }, [mentionModalHeight])

    //MAIN FUNCTIONS
    const onChangeSelection = (selection, source, content) => {
        if (selection && editorElement) {
            onCustomSelectionChange?.(selection, quillRef)
            const { index, length } = selection
            selectionRef.current = { index, length }
        }

        if (!disabledTags && !disabledMentions && selection && editorElement) {
            if (!showMentionPopupRef.current || inMentionsEditionTag) {
                getMentionModalLocation(selectionRef.current.index)
            }
        }

        if (inMentionsEditionTag && !showMentionPopupRef.current) {
            showMentionPopupRef.current = true
            setMentionsModalActive(true)
        }

        if (disabledTags || inMentionsEditionTag) {
            return
        }

        if (!disabledMentions && selection && editorElement) {
            const contentLength = content.getLength() - 1
            checkMentionModalState(contentLength)
        }

        if (selection && setInputCursorIndex) {
            setInputCursorIndex(selection.index)
        }
    }

    const updateText = (htmlContent, delta) => {
        setHtml(htmlContent)
        const newDelta = onChangeDelta?.(delta, quillRef, editorId, userEditingTagsId) || delta
        const newText = updateTextUsingDeltaOps(newDelta.ops, textRef.current, value => {
            textRef.current = value
        })

        if (forceTriggerEnterActionForBreakLines) {
            for (let i = 0; i < newDelta.ops.length; i++) {
                const op = newDelta.ops[i]
                if (op.insert && op.insert === '\n') {
                    forceTriggerEnterActionForBreakLines()
                    break
                }
            }
        }

        if (!disabledMentions) {
            updateMentionText(newText)
        }

        if (!showMentionPopupRef.current && allowMentions) {
            const lastCharacter = newText[selectionRef.current.index - 1]
            const previousToLastCharacter = newText[selectionRef.current.index - 2]
            const previousPreviousToLastCharacter = newText[selectionRef.current.index - 3]
            const nextCharacter = newText[selectionRef.current.index]

            if (lastCharacter === '@' && (!previousToLastCharacter || previousToLastCharacter.match(/\s|&/))) {
                startToMention(newText, selectionRef.current.index)
            } else if (nextCharacter === '@' && (!lastCharacter || lastCharacter.match(/\s|&/))) {
                startToMention(newText, selectionRef.current.index + 1)
            } else if (
                lastCharacter &&
                lastCharacter !== '@' &&
                !lastCharacter.match(/\s|&/) &&
                previousToLastCharacter === '@' &&
                (!previousPreviousToLastCharacter || previousPreviousToLastCharacter.match(/\s|&/))
            ) {
                startToMention(newText, selectionRef.current.index - 1)
            }
        }

        if (inMentionsEditionTag && !showMentionPopupRef.current) {
            showMentionPopupRef.current = true
            setMentionsModalActive(true)
        }

        if (disabledTags || inMentionsEditionTag) {
            if (onChangeText) {
                onChangeText(newText)
            }
            processCharacterLimit()
            return
        }

        if (onChangeText) {
            const {
                extendedText,
                linkedTasksUrls,
                linkedNotesUrls,
                linkedContactsUrls,
                linkedProjectsUrls,
                linkedGoalsUrls,
                linkedSkillsUrls,
                linkedAssistantUrls,
            } = getFinalText()
            onChangeText(
                extendedText,
                linkedNotesUrls,
                linkedTasksUrls,
                linkedContactsUrls,
                linkedProjectsUrls,
                linkedGoalsUrls,
                linkedSkillsUrls,
                linkedAssistantUrls
            )
        }

        processCharacterLimit()
    }

    const processCharacterLimit = () => {
        if (characterLimit) {
            const length = quillRef.current.getLength()
            if (length > characterLimit) quillRef.current.deleteText(characterLimit, length)
        }
    }

    const processInitialText = () => {
        if (initialTextExtended && initialTextExtended.length > 0) {
            let delta = new Delta()
            if (disabledTags || inMentionsEditionTag) {
                delta.insert(initialTextExtended)
            } else {
                if (isCalendarTask) {
                    delta = reactQuillRef.current.getEditor().clipboard.convert(initialTextExtended)
                } else {
                    delta = processPastedFn(
                        initialTextExtended,
                        Delta,
                        innerProjectId,
                        editorId,
                        userEditingTagsId,
                        inGenericTask,
                        genericData,
                        quillRef.current,
                        false,
                        null,
                        false
                    )
                }
            }

            quillRef.current.updateContents(delta)
            quillRef.current.setSelection(initialTextExtended.length, 0)
            setInitialLinkedObject && getLinkedUrlInitialText()
        }
    }

    const getFinalText = () => {
        if (disabledTags || inMentionsEditionTag) {
            return textRef.current
        }
        const deltaContent = quillRef.current.getContents()
        let finalText = ''
        let finalTextExtended = ''
        const linkedNotesUrls = []
        const linkedTasksUrls = []
        const linkedContactsUrls = []
        const linkedProjectsUrls = []
        const linkedGoalsUrls = []
        const linkedSkillsUrls = []
        const linkedAssistantUrls = []

        for (let i = 0; i < deltaContent.ops.length; i++) {
            const op = deltaContent.ops[i]
            const { insert } = op
            const {
                mention,
                hashtag,
                email,
                url,
                commentTagFormat,
                attachment,
                customImageFormat,
                videoFormat,
                karma,
                milestoneTag,
            } = insert

            let beforeSpace = ''
            if (i > 0) {
                const previousInsert = deltaContent.ops[i - 1].insert
                if (
                    typeof previousInsert !== 'string' ||
                    previousInsert.length === 0 ||
                    previousInsert[previousInsert.length - 1] !== ' '
                ) {
                    beforeSpace = ' '
                }
            }

            let afterSpace = ''
            if (i + 1 < deltaContent.ops.length) {
                const nextInsert = deltaContent.ops[i + 1].insert
                if (typeof nextInsert !== 'string' || nextInsert.length === 0 || nextInsert[0] !== ' ') {
                    afterSpace = ' '
                }
            }

            if (commentTagFormat) {
                const commentTagFormatText = `&${commentTagFormat.text}`
                finalText += beforeSpace + commentTagFormatText + afterSpace
                finalTextExtended += beforeSpace + commentTagFormatText + afterSpace
            } else if (mention) {
                const mentionText = `@${mention.text.replaceAll(' ', MENTION_SPACE_CODE)}`
                const mextionTextExtended =
                    mention.userId === NOT_USER_MENTIONED ? mentionText : `${mentionText}#${mention.userId}`
                finalText += beforeSpace + mentionText + afterSpace
                finalTextExtended += beforeSpace + mextionTextExtended + afterSpace

                if (mention.userId !== NOT_USER_MENTIONED) {
                    const objectType = TasksHelper.getPeopleTypeUsingId(mention.userId, innerProjectId)
                    const contactUrl = `${window.origin}${getDvMainTabLink(innerProjectId, mention.userId, objectType)}`
                    if (linkedContactsUrls.indexOf(contactUrl) < 0) {
                        linkedContactsUrls.push(contactUrl)
                    }
                }
            } else if (karma) {
                const karmaText = `${KARMA_TRIGGER}${karma.userId}`
                finalText += beforeSpace + karmaText + afterSpace
                finalTextExtended += beforeSpace + karmaText + afterSpace
            } else if (milestoneTag) {
                const milestoneText = `${MILESTONE_TAG_TRIGGER}${milestoneTag.text}${MILESTONE_TAG_TRIGGER}${milestoneTag.milestoneId}`
                finalText += beforeSpace + milestoneText + afterSpace
                finalTextExtended += beforeSpace + milestoneText + afterSpace
            } else if (attachment) {
                const attachmentText = `${ATTACHMENT_TRIGGER}${attachment.uri}${ATTACHMENT_TRIGGER}${attachment.text}${ATTACHMENT_TRIGGER}${attachment.isNew}`
                finalText += beforeSpace + attachment.text + afterSpace
                finalTextExtended += beforeSpace + attachmentText + afterSpace
            } else if (customImageFormat) {
                const imageText = `${IMAGE_TRIGGER}${customImageFormat.uri}${IMAGE_TRIGGER}${customImageFormat.resizedUri}${IMAGE_TRIGGER}${customImageFormat.text}${IMAGE_TRIGGER}${customImageFormat.isNew}`
                finalText += beforeSpace + customImageFormat.text + afterSpace
                finalTextExtended += beforeSpace + imageText + afterSpace
            } else if (videoFormat) {
                const videoText = `${VIDEO_TRIGGER}${videoFormat.uri}${VIDEO_TRIGGER}${videoFormat.text}${VIDEO_TRIGGER}${videoFormat.isNew}`
                finalText += beforeSpace + videoFormat.text + afterSpace
                finalTextExtended += beforeSpace + videoText + afterSpace
            } else if (hashtag) {
                const hashtagText = `#${hashtag.text}`
                finalText += beforeSpace + hashtagText + afterSpace
                finalTextExtended += beforeSpace + hashtagText + afterSpace
            } else if (email) {
                finalText += beforeSpace + email.text + afterSpace
                finalTextExtended += beforeSpace + email.text + afterSpace
            } else if (url) {
                finalText += beforeSpace + url.url + afterSpace
                finalTextExtended += beforeSpace + url.url + afterSpace
                if (isValidTaskLink(url.url, innerProjectId) && linkedTasksUrls.indexOf(url.url) < 0)
                    linkedTasksUrls.push(url.url)
                else if (isValidNoteLink(url.url, innerProjectId) && linkedNotesUrls.indexOf(url.url) < 0)
                    linkedNotesUrls.push(url.url)
                else if (isValidContactLink(url.url, innerProjectId) && linkedContactsUrls.indexOf(url.url) < 0)
                    linkedContactsUrls.push(url.url)
                else if (isValidProjectLink(url.url, innerProjectId) && linkedProjectsUrls.indexOf(url.url) < 0)
                    linkedProjectsUrls.push(url.url)
                else if (isValidGoalLink(url.url, innerProjectId) && linkedGoalsUrls.indexOf(url.url) < 0)
                    linkedGoalsUrls.push(url.url)
                else if (isValidSkillLink(url.url, innerProjectId) && linkedSkillsUrls.indexOf(url.url) < 0)
                    linkedSkillsUrls.push(url.url)
                else if (isValidAssistantLink(url.url, innerProjectId) && linkedAssistantUrls.indexOf(url.url) < 0)
                    linkedAssistantUrls.push(url.url)
            } else {
                if (isValidTaskLink(insert, innerProjectId) && linkedTasksUrls.indexOf(insert) < 0)
                    linkedTasksUrls.push(insert)
                else if (isValidNoteLink(insert, innerProjectId) && linkedNotesUrls.indexOf(insert) < 0)
                    linkedNotesUrls.push(insert)
                else if (isValidContactLink(insert, innerProjectId) && linkedContactsUrls.indexOf(insert))
                    linkedContactsUrls.push(insert)
                else if (isValidProjectLink(insert, innerProjectId) && linkedProjectsUrls.indexOf(insert))
                    linkedProjectsUrls.push(insert)
                else if (isValidGoalLink(insert, innerProjectId) && linkedGoalsUrls.indexOf(insert))
                    linkedGoalsUrls.push(insert)
                else if (isValidSkillLink(insert, innerProjectId) && linkedSkillsUrls.indexOf(insert))
                    linkedSkillsUrls.push(insert)
                else if (isValidAssistantLink(insert, innerProjectId) && linkedAssistantUrls.indexOf(insert))
                    linkedAssistantUrls.push(insert)
                finalText += insert
                finalTextExtended += insert
            }
        }

        finalText = finalText.substring(0, finalText.length - 1)
        finalTextExtended = finalTextExtended.substring(0, finalTextExtended.length - 1)
        return {
            extendedText: finalTextExtended,
            linkedTasksUrls,
            linkedNotesUrls,
            linkedContactsUrls,
            linkedProjectsUrls,
            linkedGoalsUrls,
            linkedSkillsUrls,
            linkedAssistantUrls,
        }
    }

    //OTHERS
    const getLinkedUrlInitialText = () => {
        let initialLinkedTasksUrls = []
        let initialNotesUrls = []
        let initialContactsUrls = []
        let initialProjectsUrls = []
        let initialGoalsUrls = []
        let initialSkillsUrls = []
        let initialAssistantUrls = []

        const deltaContent = quillRef.current.getContents()

        for (let i = 0; i < deltaContent.ops.length; i++) {
            const op = deltaContent.ops[i]
            const { insert } = op
            const { mention, url } = insert

            if (mention) {
                if (mention.userId !== NOT_USER_MENTIONED) {
                    const objectType = TasksHelper.getPeopleTypeUsingId(mention.userId, innerProjectId)
                    const contactUrl = `${window.origin}${getDvMainTabLink(innerProjectId, mention.userId, objectType)}`
                    if (initialContactsUrls.indexOf(contactUrl) < 0) {
                        initialContactsUrls.push(contactUrl)
                    }
                }
            } else if (url) {
                if (isValidTaskLink(url.url, innerProjectId) && initialLinkedTasksUrls.indexOf(url.url) < 0)
                    initialLinkedTasksUrls.push(url.url)
                else if (isValidNoteLink(url.url, innerProjectId) && initialNotesUrls.indexOf(url.url) < 0)
                    initialNotesUrls.push(url.url)
                else if (isValidContactLink(url.url, innerProjectId) && initialContactsUrls.indexOf(url.url) < 0)
                    initialContactsUrls.push(url.url)
                else if (isValidProjectLink(url.url, innerProjectId) && initialProjectsUrls.indexOf(url.url) < 0)
                    initialProjectsUrls.push(url.url)
                else if (isValidGoalLink(url.url, innerProjectId) && initialGoalsUrls.indexOf(url.url) < 0)
                    initialGoalsUrls.push(url.url)
                else if (isValidSkillLink(url.url, innerProjectId) && initialSkillsUrls.indexOf(url.url) < 0)
                    initialSkillsUrls.push(url.url)
                else if (isValidAssistantLink(url.url, innerProjectId) && initialAssistantUrls.indexOf(url.url) < 0)
                    initialAssistantUrls.push(url.url)
            }
        }
        setInitialLinkedObject(
            initialLinkedTasksUrls,
            initialNotesUrls,
            initialContactsUrls,
            initialProjectsUrls,
            initialGoalsUrls,
            initialSkillsUrls,
            initialAssistantUrls
        )
    }

    const getFormats = () => {
        if (!disabledTags && !inMentionsEditionTag) {
            const formats = otherFormats ? [...ALLOWED_FORMATS, ...otherFormats] : [...ALLOWED_FORMATS]
            if (inGenericTask) {
                formats.push('commentTagFormat')
            }
            if (isCalendarTask) {
                formats.push('bold', 'italic', 'underline', 'bullet', 'list', 'attachment')
            }
            return formats
        }
        return []
    }

    const onKeyDown = event => {
        const { key, ctrlKey, shiftKey } = event
        if (
            key === 'Delete' &&
            mentionLastHalfTextRef.current &&
            selectionRef.current.index === textRef.current.length - mentionLastHalfTextRef.current.length
        ) {
            mentionLastHalfTextRef.current = mentionLastHalfTextRef.current.substring(1)
        }

        if (showMentionPopupRef.current) {
            const isPaste = ctrlKey && (key === 'v' || key === 'V')
            if (isPaste) {
                event.preventDefault()
            }
        }

        if (keyboardType === 'numeric') {
            const isPaste = ctrlKey && (key === 'v' || key === 'V')
            const digitRegExp = /\d/
            const isDelete = key === 'Backspace' || key === 'Delete'

            if (!digitRegExp.test(key) && !isPaste && !isDelete) {
                event.preventDefault()
            }
        }

        if (onKeyPress) {
            onKeyPress(key)
        }

        if (key === 'Enter' && singleLine) {
            event.preventDefault()
        }

        if (key === 'Enter' && !singleLine && !disabledEnterKey) {
            event.preventDefault()
            if (shiftKey && quillRef.current.hasFocus()) {
                const delta = new Delta()
                delta.retain(selectionRef.current.index)
                delta.insert('\n')
                quillRef.current.updateContents(delta, 'user')
                quillRef.current.setSelection(selectionRef.current.index + 1, 0, 'user')
            }
        }

        if ((key === 'ArrowUp' || key === 'ArrowDown' || key === 'Enter') && showMentionPopupRef.current) {
            event.preventDefault()
        }
    }

    const unmountComponent = () => {
        dispatch(setIsQuillTagEditorOpen(false))

        if (!inMentionsEditionTag) {
            cleanTagsInteractionsPopus()
        }
    }

    useEffect(() => {
        if (quillRef.current) {
            showMentionPopupRef.current
                ? delete quillRef.current.keyboard.bindings[9]
                : (quillRef.current.keyboard.bindings[9] = quillKeyboardBindingsTabRef.current)
        }
    }, [showMentionPopupRef.current])

    useEffect(() => {
        if (containerElement) {
            if (styleTheme === SEARCH_THEME) {
                if (isMobileView) {
                    containerElement.classList.add('ql-searchTextInputContainer')
                    editorElement.classList.add('ql-modalTextInputEditor')
                } else {
                    containerElement.classList.remove('ql-searchTextInputContainer')
                    editorElement.classList.remove('ql-modalTextInputEditor')
                }
            }
        }
    }, [isMobileView])

    useEffect(() => {
        document.addEventListener('keydown', onKeyDown)
        return () => {
            document.removeEventListener('keydown', onKeyDown)
        }
    })

    useEffect(() => {
        return () => {
            const deltaContent = quillRef.current.getContents()
            for (let i = 0; i < deltaContent.ops.length; i++) {
                const { hashtag } = deltaContent.ops[i].insert
                if (hashtag) {
                    Backend.unwatchHastagsColors(hashtag.id)
                }
            }
        }
    }, [])

    useEffect(() => {
        dispatch(setQuillTextInputProjectIdsByEditorId(editorId, projectId))
        quillTextInputProjectIds[editorId] = projectId
        quillTextInputIsCalendarTask[editorId] = isCalendarTask
        return () => {
            dispatch(setQuillTextInputProjectIdsByEditorId(editorId, ''))
            delete quillTextInputProjectIds[editorId]
            delete quillTextInputIsCalendarTask[editorId]
        }
    }, [editorId])

    useEffect(() => {
        if (!disabledTags && !inMentionsEditionTag) {
            dispatch(setQuillEditorProjectId(innerProjectId))
        }

        quillRef.current = reactQuillRef.current.getEditor()
        if (autoFocus) quillRef.current.focus()
        quillKeyboardBindingsTabRef.current = quillRef.current.keyboard.bindings[9]

        if (disabledTabKey) {
            delete quillRef.current.keyboard.bindings[9]
        }

        if (setEditor) {
            setEditor(quillRef.current)
        }

        const containerElement = document.getElementsByClassName(`ql-container-${editorId}`)[0]
        containerElement.classList.add('ql-textInputContainer')

        const editorElement = document.getElementsByClassName(`ql-editor-${editorId}`)[0]
        editorElement.classList.add('ql-textInputEditor')
        if (styleTheme === TASK_THEME) {
            editorElement.classList.add('ql-taskTextInputEditor')
            containerElement.classList.add('ql-taskTextInputContainer')
        } else if (styleTheme === GOAL_THEME) {
            editorElement.classList.add('ql-taskTextInputEditor')
            editorElement.classList.add('ql-goalTextInputEditor')
            containerElement.classList.add('ql-taskTextInputContainer')
        } else if (styleTheme === SUBTASK_THEME) {
            editorElement.classList.add('ql-subtaskTextInputEditor')
            containerElement.classList.add('ql-subtaskTextInputContainer')
        } else if (styleTheme === COMMENT_MODAL_THEME) {
            editorElement.classList.add('ql-modalTextInputEditor')
        } else if (styleTheme === NEW_TOPIC_MODAL_THEME) {
            editorElement.classList.add('ql-newTopicModalTextInputEditor')
            editorElement.classList.add('ql-modalTextInputEditor')
        } else if (styleTheme === CREATE_TASK_MODAL_THEME) {
            editorElement.classList.add('ql-createTaskModalTextInputEditor')
            editorElement.classList.add('ql-modalTextInputEditor')
        } else if (styleTheme === CREATE_SUBTASK_MODAL_THEME) {
            containerElement.classList.add('ql-createSubtaskModalTextInputContainer')
            editorElement.classList.add('ql-createSubtaskModalTextInputEditor')
            editorElement.classList.add('ql-modalTextInputEditor')
        } else if (styleTheme === SEARCH_THEME) {
            if (isMobileView) {
                containerElement.classList.add('ql-searchTextInputContainer')
                editorElement.classList.add('ql-modalTextInputEditor')
            }
        } else if (styleTheme === INVITE_THEME_DEFAULT) {
            editorElement.classList.add('ql-inviteDefaultTextInputEditor')
        } else if (styleTheme === INVITE_THEME_MODERN) {
            editorElement.classList.add('ql-inviteModernTextInputEditor')
        } else if (styleTheme === CREATE_PROJECT_THEME_DEFAULT) {
            editorElement.classList.add('ql-modalTextInputEditor')
            containerElement.classList.add('ql-createDefaultProjectTextInputContainer')
        } else if (styleTheme === CREATE_PROJECT_THEME_MODERN) {
            editorElement.classList.add('ql-modalTextInputEditorModern')
            containerElement.classList.add('ql-createModernProjectTextInputContainer')
        }

        if (singleLine) {
            editorElement.classList.add('ql-textInputEditorSingleLine')
        }

        editorElement.addEventListener('copy', event => {
            onCopy(event, quillRef.current, projectId, false)
        })

        editorElement.addEventListener('cut', event => {
            onCopy(event, quillRef.current, projectId, true)
        })

        setEditorElement(editorElement)
        setContainerElement(containerElement)

        initialDeltaOps ? quillRef.current.setContents(initialDeltaOps) : processInitialText()

        if (initialCursorIndex !== null && initialCursorIndex !== undefined) {
            quillRef.current.setSelection(initialCursorIndex, 0)
        }
        return unmountComponent
    }, [])

    useImperativeHandle(ref, () => ({
        getEditorId: () => {
            return editorId
        },
        getEditor: () => {
            return quillRef.current
        },
        focus: () => {
            quillRef.current.focus()
        },
        blur: () => {
            quillRef.current.blur()
        },
        clear: () => {
            document.querySelector(`.ql-container-${editorId} .ql-editor`).innerHTML = ''
            showMentionPopupRef.current = false
            selectionRef.current = { index: 0, length: 0 }
            mentionTextRef.current = ''
            setSelectionBounds({ top: 0, left: 0 })
            textRef.current = ''
            setHtml('')
            mentionStartIndexRef.current = 0
            mentionLastHalfTextRef.current = ''
        },
        isFocused: () => {
            return quillRef.current.hasFocus()
        },
        clearAndSetContent: text => {
            // Clear existing content
            document.querySelector(`.ql-container-${editorId} .ql-editor`).innerHTML = ''
            showMentionPopupRef.current = false
            selectionRef.current = { index: 0, length: 0 }
            mentionTextRef.current = ''
            setSelectionBounds({ top: 0, left: 0 })
            textRef.current = ''
            setHtml('')
            mentionStartIndexRef.current = 0
            mentionLastHalfTextRef.current = ''

            // Set new content
            if (text && text.length > 0) {
                const delta = processPastedFn(
                    text,
                    Delta,
                    innerProjectId,
                    editorId,
                    userEditingTagsId,
                    inGenericTask,
                    genericData,
                    quillRef.current,
                    false,
                    null,
                    false
                )
                quillRef.current.updateContents(delta)
                quillRef.current.setSelection(quillRef.current.getLength(), 0)
                setInitialLinkedObject && getLinkedUrlInitialText()
            }
        },
        triggerMention: () => {
            quillRef.current.focus()
            const range = quillRef.current.getSelection()
            const index = range ? range.index : quillRef.current.getLength()
            quillRef.current.insertText(index, '@', 'user')
            quillRef.current.setSelection(index + 1, 0)
        },
    }))

    return (
        <CustomScrollView
            style={[
                containerStyle,
                {
                    height: fixedHeight ? fixedHeight : '100%',
                    maxHeight: maxHeight ? maxHeight : 'auto',
                    overflow: 'hidden',
                },
            ]}
        >
            <ReactQuill
                ref={el => {
                    reactQuillRef.current = el
                    quillTextInputRefs[editorId] = el
                }}
                modules={{
                    toolbar: false,
                    autoformat: true,
                    history: {
                        maxStack: 100,
                        userOnly: true,
                        beforeUndoRedo,
                    },
                }}
                value={html}
                onChange={updateText}
                placeholder={createPlaceholder(
                    placeholder,
                    QUILL_EDITOR_TEXT_INPUT_TYPE,
                    editorId,
                    keyboardType,
                    singleLine,
                    userEditingTagsId,
                    disabledEnterKey
                )}
                onChangeSelection={onChangeSelection}
                formats={getFormats()}
                readOnly={disabledEdition}
            />

            {showMentionPopupRef.current && (
                <WrapperMentionsModal
                    mentionText={inMentionsEditionTag ? textRef.current.trim() : mentionTextRef.current}
                    selectItemToMention={selectItemToMention}
                    projectId={innerProjectId}
                    contentLocation={selectionBounds}
                    setMentionModalHeight={setMentionModalHeight}
                    keepFocus={() => {
                        quillRef.current.focus()
                    }}
                    inMentionsEditionTag={inMentionsEditionTag}
                    insertNormalMention={insertNormalMention}
                />
            )}
        </CustomScrollView>
    )
}

export default forwardRef(CustomTextInput3)
