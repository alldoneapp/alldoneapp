import React, { Component } from 'react'
import { StyleSheet, View } from 'react-native'
import v4 from 'uuid/v4'
import ReactQuill from 'react-quill'
import { cloneDeep, isEqual } from 'lodash'
import Hotkeys from 'react-hot-keys'
import Popover from 'react-tiny-popover'

import { colors } from '../../../styles/global'
import TasksHelper, { OPEN_STEP, TASK_ASSIGNEE_ASSISTANT_TYPE } from '../../../TaskListView/Utils/TasksHelper'
import Backend from '../../../../utils/BackendBridge'
import { updateNewAttachmentsData } from '../../../Feeds/Utils/HelperFunctions'
import CustomTextInput3 from '../../../Feeds/CommentsTextInput/CustomTextInput3'
import {
    CREATE_SUBTASK_MODAL_THEME,
    CREATE_TASK_MODAL_THEME,
    NOT_ALLOW_EDIT_TAGS,
} from '../../../Feeds/CommentsTextInput/textInputHelper'
import store from '../../../../redux/store'
import {
    exitsOpenModals,
    MANAGE_TASK_MODAL_ID,
    setModalParams,
    TAGS_EDIT_OBJECT_MODAL_ID,
} from '../../../ModalsManager/modalsManager'
import Button from '../../../UIControls/Button'
import NavigationService from '../../../../utils/NavigationService'
import URLTrigger from '../../../../URLSystem/URLTrigger'
import EstimationWrapper from './EstimationWrapper'
import ConfirmationModal from './ConfirmationModal'
import AssigneeWrapper from './AssigneeWrapper'
import DueDateWrapper from './DueDateWrapper'
import CommentWrapper from './CommentWrapper'
import PrivacyWrapper from './PrivacyWrapper'
import HighlightWrapper from './HighlightWrapper'
import FollowUpWrapper from './FollowUpWrapper'
import { execShortcutFn } from '../../ShortcutCheatSheet/HelperFunctions'
import TaskIcon from './TaskIcon'
import { getSelection } from '../../../NotesView/NotesDV/EditorView/mentionsHelper'
import { formatUrl, getDvMainTabLink, getUrlObject } from '../../../../utils/LinkingHelper'
import { FEED_TASK_OBJECT_TYPE } from '../../../Feeds/Utils/FeedsConstants'
import { exportRef } from '../../../NotesView/NotesDV/EditorView/NotesEditorView'
import { setSelectedNavItem, setTmpInputTextTask, updateTaskSuggestedCommentModalData } from '../../../../redux/actions'
import { getWorkstreamById, isWorkstream, WORKSTREAM_ID_PREFIX } from '../../../Workstreams/WorkstreamHelper'
import { translate } from '../../../../i18n/TranslationService'
import { getPathname } from '../../../Tags/LinkTag'
import ProjectHelper from '../../../SettingsView/ProjectsSettings/ProjectHelper'
import { DV_TAB_TASK_PROPERTIES } from '../../../../utils/TabNavigationConstants'
import { getAssistant } from '../../../AdminPanel/Assistants/assistantsHelper'
import {
    createFollowUpTask,
    setTaskAutoEstimation,
    updateTask,
    uploadNewSubTask,
} from '../../../../utils/backends/Tasks/tasksFirestore'
import { createTaskWithService } from '../../../../utils/backends/Tasks/TaskServiceFrontendHelper'

const Delta = ReactQuill.Quill.import('delta')

export default class TaskEditionMode extends Component {
    constructor(props) {
        super(props)

        const { task, projectId, parentTask } = props
        const { loggedUser, selectedNote: parentNote } = store.getState()

        const tempTask = task ? cloneDeep(task) : TasksHelper.getNewDefaultTask()
        const editorId = v4()
        let initialOps = null
        if (!task) {
            tempTask.userId = parentTask ? parentTask.userId : loggedUser.uid
            tempTask.userIds = parentTask ? parentTask.userIds : [loggedUser.uid]
            tempTask.currentReviewerId = tempTask.userId

            initialOps = parentTask ? null : this.getSelectedContent(editorId)

            if (parentNote.isPrivate) {
                tempTask.isPrivate = parentNote.isPrivate
                tempTask.isPublicFor = parentNote.isPublicFor
            }
        }
        const assignee =
            tempTask.assigneeType === TASK_ASSIGNEE_ASSISTANT_TYPE
                ? getAssistant(tempTask.userId)
                : isWorkstream(tempTask.userId)
                ? getWorkstreamById(projectId, tempTask.userId)
                : TasksHelper.getUserInProject(projectId, tempTask.userId) ||
                  TasksHelper.getContactInProject(projectId, tempTask.userId)

        this.state = {
            tempTask: Backend.mapTaskData(tempTask.id, tempTask),
            assignee,
            showSuggestedComment: false,
            showConfirmationModal: false,
            linkedParentNotesUrl: [],
            linkedParentTasksUrl: [],
            linkedParentContactsUrl: [],
            linkedParentProjectsUrl: [],
            linkedParentGoalsUrl: [],
            linkedParentSkillsUrl: [],
            linkedParentAssistantsUrl: [],
            editorId,
            initialOps,
        }
    }

    componentDidUpdate(prevProps, prevState) {
        if (this.props.task && !isEqual(this.props.task, prevProps.task)) {
            const newTempTaskState = Backend.mapTaskData(this.props.task.id, cloneDeep(this.props.task))
            const newAssignee =
                newTempTaskState.assigneeType === TASK_ASSIGNEE_ASSISTANT_TYPE
                    ? getAssistant(newTempTaskState.userId)
                    : isWorkstream(newTempTaskState.userId)
                    ? getWorkstreamById(this.props.projectId, newTempTaskState.userId)
                    : TasksHelper.getUserInProject(this.props.projectId, newTempTaskState.userId) ||
                      TasksHelper.getContactInProject(this.props.projectId, newTempTaskState.userId)

            this.setState({ tempTask: newTempTaskState, assignee: newAssignee })
        } else if (this.props.task && prevProps.task && this.props.task.dueDate !== prevProps.task.dueDate) {
            const newTempTaskState = Backend.mapTaskData(this.props.task.id, cloneDeep(this.props.task))
            const newAssignee =
                newTempTaskState.assigneeType === TASK_ASSIGNEE_ASSISTANT_TYPE
                    ? getAssistant(newTempTaskState.userId)
                    : isWorkstream(newTempTaskState.userId)
                    ? getWorkstreamById(this.props.projectId, newTempTaskState.userId)
                    : TasksHelper.getUserInProject(this.props.projectId, newTempTaskState.userId) ||
                      TasksHelper.getContactInProject(this.props.projectId, newTempTaskState.userId)
            this.setState({ tempTask: newTempTaskState, assignee: newAssignee })
        }
    }

    componentDidMount() {
        const { editorId } = this.state
        setModalParams(MANAGE_TASK_MODAL_ID, { editorId }, true)
        document.addEventListener('keydown', this.onKeyDown)
    }

    setShowSuggestedComment = () => {
        this.setState({ showSuggestedComment: true })
    }

    getSelectedContent = editorId => {
        const { editorRef, projectId } = this.props
        const editor = editorRef.getEditor()
        const selection = getSelection()
        const selectionContent = editor.getContents(selection.index, selection.length)

        const content = cloneDeep(selectionContent)
        for (let i = 0; i < content.ops.length; i++) {
            const op = content.ops[i]
            const { attachment, customImageFormat, videoFormat, taskTagFormat } = op.insert
            if (attachment || customImageFormat || videoFormat || taskTagFormat) {
                let uri = ''
                let objectId
                if (attachment) {
                    uri = attachment.uri
                } else if (customImageFormat) {
                    uri = customImageFormat.uri
                } else if (videoFormat) {
                    uri = videoFormat.uri
                } else if (taskTagFormat) {
                    objectId = taskTagFormat.taskId
                    uri = `${window.location.origin}${getDvMainTabLink(projectId, objectId, 'tasks')}`
                }
                const rootUrl = formatUrl(uri)
                const url = getUrlObject(uri, rootUrl, projectId, editorId, '', objectId)
                content.ops[i].insert = { url }
            } else if (typeof content.ops[i].insert === 'string') {
                content.ops[i].insert = content.ops[i].insert.replace(/(\r\n|\n|\r)/gm, ' ')
            }
        }
        return content
    }

    componentWillUnmount() {
        document.removeEventListener('keydown', this.onKeyDown)
    }

    enterKeyAction = () => {
        if (!exitsOpenModals([TAGS_EDIT_OBJECT_MODAL_ID, MANAGE_TASK_MODAL_ID])) {
            this.actionDoneButton()
        }
    }

    onKeyDown = event => {
        const { key } = event
        if (key === 'Enter') {
            this.enterKeyAction()
        }
    }

    setName = (
        extendedName,
        linkedParentNotesUrl,
        linkedParentTasksUrl,
        linkedParentContactsUrl,
        linkedParentProjectsUrl,
        linkedParentGoalsUrl,
        linkedParentSkillsUrl,
        linkedParentAssistantsUrl
    ) => {
        const { tempTask } = this.state
        const { editing } = this.props
        tempTask.extendedName = extendedName
        if (extendedName !== '') {
            this.setState({
                linkedParentNotesUrl,
                linkedParentTasksUrl,
                linkedParentContactsUrl,
                linkedParentProjectsUrl,
                linkedParentGoalsUrl,
                linkedParentSkillsUrl,
                linkedParentAssistantsUrl,
            })
        }
        if (!editing) {
            store.dispatch(setTmpInputTextTask(extendedName))
        }
        this.setState({ tempTask })
    }

    setEstimation = estimationValue => {
        if (estimationValue !== undefined) {
            const { tempTask } = this.state
            const { editing } = this.props
            tempTask.estimations[OPEN_STEP] = estimationValue
            editing ? this.setTask(tempTask, null) : this.createTask(tempTask)
        }
    }

    setAutoEstimation = autoEstimation => {
        const { projectId, editing } = this.props
        const { tempTask } = this.state
        if (editing) setTaskAutoEstimation(projectId, tempTask, autoEstimation)
        this.setState({ tempTask: { ...tempTask, autoEstimation } })
    }

    addFollowUpTask = (date, inBacklog) => {
        const { tempTask } = this.state
        const { projectId, toggleEditionMode } = this.props
        toggleEditionMode()
        const followUpdueDate = inBacklog ? Number.MAX_SAFE_INTEGER : date.valueOf()
        createFollowUpTask(projectId, tempTask, followUpdueDate, '', 0)
    }

    setDueDate = dueDate => {
        if (dueDate !== undefined) {
            const { tempTask } = this.state
            const { editing } = this.props
            tempTask.dueDate = dueDate
            editing ? this.setTask(tempTask, null) : this.createTask(tempTask, true)
        }
    }

    setToBacklog = () => {
        const { tempTask } = this.state
        const { editing } = this.props
        tempTask.dueDate = Number.MAX_SAFE_INTEGER
        editing ? this.setTask(tempTask, null) : this.createTask(tempTask, true)
    }

    setColor = color => {
        const { tempTask } = this.state
        const { editing } = this.props
        tempTask.hasStar = color
        editing ? this.setTask(tempTask, null) : this.createTask(tempTask)
    }

    setPrivacy = (isPrivate, isPublicFor) => {
        const { tempTask } = this.state
        tempTask.isPrivate = isPrivate
        tempTask.isPublicFor = isPublicFor
        this.createTask(tempTask)
    }

    setComment = (newComment, isPrivate, hasKarma) => {
        const { tempTask } = this.state
        const { projectId } = this.props
        updateNewAttachmentsData(projectId, newComment).then(async commentWithAttachments => {
            const commentData = {
                comment: commentWithAttachments,
                commentIsPrivate: isPrivate,
                commentHasKarma: hasKarma,
            }
            this.setTask(tempTask, commentData)
        })
    }

    setObserversDirectly = observers => {
        const { tempTask } = this.state
        const observersIds = observers.map(user => user.uid)

        if (!isEqual(observersIds, tempTask.observersIds)) {
            tempTask.observersIds = observersIds
            this.setState({ tempTask })
            this.setTask(tempTask, null)
        }
    }

    setAssignee = (user, observers) => {
        const { uid } = user
        const { tempTask } = this.state
        const { editing, task } = this.props
        const observersIds = observers.map(user => user.uid)

        if (uid !== tempTask.userId || !isEqual(observersIds, tempTask.observersIds)) {
            tempTask.userId = uid
            tempTask.observersIds = observersIds

            if (editing && uid === task.userId) {
                tempTask.userIds = task.userIds
                tempTask.stepHistory = task.stepHistory
                tempTask.currentReviewerId = task.currentReviewerId
            } else {
                tempTask.userIds = [uid]
                tempTask.stepHistory = [OPEN_STEP]
                tempTask.currentReviewerId = uid
            }

            this.setState({ tempTask, assignee: user })
        }
    }

    insertTag = taskId => {
        const { editorRef, noteId, objectUrl } = this.props
        const editor = editorRef.getEditor()
        const selection = getSelection()
        const taskTagFormat = { id: v4(), taskId, editorId: noteId, objectUrl }
        const delta = new Delta()
        delta.retain(selection.index)
        delta.insert({ taskTagFormat })
        delta.insert(' ')
        if (selection.length > 0) {
            delta.delete(selection.length)
        }
        editor.updateContents(delta, 'user')
        editor.setSelection(selection.index + 2, 0, 'user')
    }

    openConfirmationModal = () => {
        this.setState({ showConfirmationModal: true })
    }

    closeConfirmationModal = () => {
        this.setState({ showConfirmationModal: false })
    }

    deleteTask = () => {
        const { task, projectId, closeModal, unwatchTask, isSubtask } = this.props
        this.closeConfirmationModal()

        if (isSubtask) {
            Backend.deleteTask(task, projectId)
        } else {
            setTimeout(() => {
                closeModal()
                setTimeout(() => {
                    unwatchTask?.()
                    this.removeTag()
                    Backend.deleteTask(task, projectId)
                }, 400)
            }, 400)
        }
    }

    removeTag = () => {
        const { editorRef, tagId } = this.props
        const editor = editorRef.getEditor()
        const ops = [...editor.getContents().ops]
        for (let i = 0; i < ops.length; i++) {
            const { taskTagFormat } = ops[i].insert
            if (taskTagFormat && taskTagFormat.id === tagId) {
                ops.splice(i, 1)
                editor.setContents(ops, 'user')
                break
            }
        }
    }

    actionDoneButton = (...params) => {
        params[3] && this.setShowSuggestedComment()
        const { editing, closeModal, toggleEditionMode, parentTask, noteId, projectId } = this.props
        const { tempTask } = this.state
        const { loggedUser } = store.getState()
        const needUpdate = this.needBeUpdated()

        if (loggedUser.uid !== tempTask.userId) {
            const isContact = !!TasksHelper.getContactInProject(projectId, tempTask.userId)
            tempTask.suggestedBy = isContact || tempTask.userId.startsWith(WORKSTREAM_ID_PREFIX) ? null : loggedUser.uid
        } else if (loggedUser.uid === tempTask.userId) {
            tempTask.suggestedBy = null
        }

        if (editing) {
            needUpdate ? this.setTask(tempTask, null) : toggleEditionMode()
        } else {
            if (parentTask) {
                needUpdate ? this.createTask(tempTask, parentTask.userId !== tempTask.userId) : toggleEditionMode()
            } else {
                needUpdate ? this.createTask(tempTask) : closeModal()
            }
        }
        const editorElement = document.getElementById(`${noteId}ParentScroll`)
        if (editorElement && exportRef) {
            const scrollTop = editorElement.children[0].scrollTop
            exportRef.getEditor().focus()
            editorElement.children[0].scrollTop = scrollTop
        }
    }

    createTask = async (tempTask, convertSubtask) => {
        const { projectId, closeModal, parentTask, toggleEditionMode, noteId } = this.props
        const { showSuggestedComment } = this.state

        tempTask.name = TasksHelper.getTaskNameWithoutMeta(tempTask.extendedName)
        store.dispatch(setTmpInputTextTask(''))

        let storedTask
        if (parentTask) {
            toggleEditionMode()
            storedTask = convertSubtask
                ? await createTaskWithService(
                      {
                          projectId,
                          ...tempTask,
                      },
                      {
                          awaitForTaskCreation: true,

                          notGenerateMentionTasks: false,
                          notGenerateUpdates: false,
                      }
                  )
                : await uploadNewSubTask(projectId, parentTask, { ...tempTask }, false, true)
        } else {
            closeModal('close')
            storedTask = await createTaskWithService(
                {
                    projectId,
                    ...tempTask,
                    containerNotesIds: [noteId],
                },
                {
                    awaitForTaskCreation: true,

                    notGenerateMentionTasks: false,
                    notGenerateUpdates: false,
                }
            )
            this.insertTag(storedTask.id)
        }
        this.trySetLinkedObjects(storedTask)
        if (showSuggestedComment) {
            setTimeout(() => {
                store.dispatch(updateTaskSuggestedCommentModalData(true, projectId, storedTask, tempTask.extendedName))
            })
        }
        return storedTask
    }

    trySetLinkedObjects = task => {
        const {
            linkedParentNotesUrl,
            linkedParentTasksUrl,
            linkedParentContactsUrl,
            linkedParentProjectsUrl,
            linkedParentGoalsUrl,
            linkedParentSkillsUrl,
            linkedParentAssistantsUrl,
        } = this.state
        const { projectId } = this.props
        Backend.setLinkedParentObjects(
            projectId,
            {
                linkedParentNotesUrl,
                linkedParentTasksUrl,
                linkedParentContactsUrl,
                linkedParentProjectsUrl,
                linkedParentGoalsUrl,
                linkedParentSkillsUrl,
                linkedParentAssistantsUrl,
            },
            { type: 'task', id: task.id }
        )
    }

    setTask = async (tempTask, commentData) => {
        const { projectId, task, toggleEditionMode, closeModal } = this.props
        const { assignee, showSuggestedComment } = this.state
        const { loggedUser } = store.getState()

        const comment = commentData ? commentData.comment : ''

        loggedUser.uid !== tempTask.userId ? closeModal('close') : toggleEditionMode()
        if (showSuggestedComment) {
            setTimeout(() => {
                store.dispatch(updateTaskSuggestedCommentModalData(true, projectId, tempTask, tempTask.extendedName))
            })
        }

        tempTask.name = TasksHelper.getTaskNameWithoutMeta(tempTask.extendedName)
        const oldAssignee =
            tempTask.userId === task.userId
                ? assignee
                : TasksHelper.getUserInProject(projectId, task.userId) ||
                  TasksHelper.getContactInProject(projectId, task.userId) ||
                  getWorkstreamById(projectId, task.userId)

        const commentMentions = TasksHelper.getMentionUsersFromTitle(projectId, comment)
        await updateTask(
            projectId,
            tempTask,
            task,
            oldAssignee,
            comment,
            commentMentions,

            false
        )
        this.trySetLinkedObjects(tempTask)
    }

    openDetailedView = async () => {
        const { projectId, task: originalTask, editing, closeModal, parentTask, objectUrl } = this.props
        const { tempTask } = this.state

        closeModal()

        if (editing) {
            const task = originalTask
            const url = objectUrl != null ? getPathname(objectUrl) : getDvMainTabLink(projectId, task.id, 'tasks')
            setTimeout(() => {
                URLTrigger.processUrl(NavigationService, url)
            }, 400)
        } else {
            const task = parentTask
                ? await this.createTask(tempTask, parentTask.userId !== tempTask.userId)
                : await this.createTask(tempTask)

            setTimeout(() => {
                NavigationService.navigate('TaskDetailedView', {
                    task,
                    projectId,
                })
                store.dispatch(setSelectedNavItem(DV_TAB_TASK_PROPERTIES))
            }, 400)
        }
    }

    needBeUpdated = () => {
        const { editing, task } = this.props
        const { tempTask } = this.state
        const { extendedName, userId } = tempTask

        const cleanedName = extendedName.trim()

        if (!cleanedName) {
            return false
        }

        if (!editing || cleanedName !== task.extendedName.trim() || userId !== task.userId) {
            return true
        }

        return false
    }

    onPressIcon = () => {
        const { pressIcon } = this.props
        pressIcon(false)
    }

    onLongPressIcon = () => {
        const { pressIcon } = this.props
        pressIcon(true)
    }

    render() {
        const { projectId, editing, isSubtask, parentTask, task } = this.props
        const { assignee, tempTask, showConfirmationModal, editorId, initialOps } = this.state
        const { extendedName, done, userIds, inDone } = tempTask
        const photoURL = assignee.photoURL
        const cleanedName = extendedName.trim()

        const isSubtaskInGuide =
            (isSubtask || (task && task.isSubtask)) && !!ProjectHelper.getProjectById(projectId)?.parentTemplateId

        const isAssistant = task && task.assigneeType === TASK_ASSIGNEE_ASSISTANT_TYPE

        return (
            <View style={{ marginBottom: task ? 16 : 0 }}>
                <View style={localStyles.inputContainer}>
                    <TaskIcon
                        editing={editing}
                        task={tempTask}
                        inEditionMode={true}
                        onPress={this.onPressIcon}
                        onLongPress={isAssistant ? this.onPressIcon : this.onLongPressIcon}
                        isSubtask={isSubtask}
                    />
                    <CustomTextInput3
                        placeholder={translate(parentTask ? 'Type to add new subtask' : 'Type to add task')}
                        placeholderTextColor={colors.Text03}
                        onChangeText={this.setName}
                        multiline={true}
                        externalTextStyle={localStyles.textInputText}
                        caretColor="white"
                        autoFocus={true}
                        setMentionsModalActive={() => {}}
                        projectId={projectId}
                        styleTheme={isSubtask ? CREATE_SUBTASK_MODAL_THEME : CREATE_TASK_MODAL_THEME}
                        containerStyle={{ marginTop: -5 }}
                        initialTextExtended={editing ? extendedName : store.getState().tmpInputTextTask}
                        externalEditorId={editorId}
                        inGenericTask={tempTask.genericData ? true : false}
                        disabledEdition={tempTask.genericData || isAssistant}
                        genericData={tempTask.genericData}
                        userIdAllowedToEditTags={tempTask.genericData ? NOT_ALLOW_EDIT_TAGS : null}
                        initialDeltaOps={initialOps?.ops?.length > 0 && initialOps}
                        initialCursorIndex={0}
                        forceTriggerEnterActionForBreakLines={() => {
                            setTimeout(() => {
                                this.enterKeyAction()
                            }, 1000)
                        }}
                    />
                    <AssigneeWrapper
                        task={tempTask}
                        projectId={projectId}
                        setAssigneeAndObservers={this.setAssignee}
                        photoURL={photoURL}
                        updateTask={this.actionDoneButton}
                        disabled={!cleanedName || isSubtaskInGuide}
                        setObserversDirectly={this.setObserversDirectly}
                    />
                </View>
                <View style={localStyles.actionsBar}>
                    <View style={localStyles.buttonsLeft}>
                        <Hotkeys
                            keyName={'alt+o'}
                            disabled={!editing && !cleanedName}
                            onKeyDown={(sht, event) =>
                                execShortcutFn(this.openDetaliedBtnRef, this.openDetailedView, event)
                            }
                            filter={e => true}
                        >
                            <Button
                                ref={ref => (this.openDetaliedBtnRef = ref)}
                                icon={'maximize-2'}
                                iconColor={colors.Text04}
                                buttonStyle={{ backgroundColor: colors.Secondary200, marginRight: 8 }}
                                onPress={this.openDetailedView}
                                disabled={!editing && !cleanedName}
                                shortcutText={'O'}
                                forceShowShortcut={true}
                            />
                        </Hotkeys>
                        {!done && userIds.length === 1 && (
                            <DueDateWrapper
                                task={tempTask}
                                projectId={projectId}
                                setDueDate={this.setDueDate}
                                setToBacklog={this.setToBacklog}
                                disabled={!cleanedName}
                            />
                        )}
                        {editing && (
                            <CommentWrapper task={tempTask} projectId={projectId} setComment={this.setComment} />
                        )}
                        {!editing && (
                            <PrivacyWrapper
                                object={tempTask}
                                objectType={FEED_TASK_OBJECT_TYPE}
                                projectId={projectId}
                                setPrivacy={this.setPrivacy}
                                disabled={!cleanedName}
                            />
                        )}
                        <HighlightWrapper object={tempTask} setColor={this.setColor} disabled={!cleanedName} />
                        {!inDone && userIds.length === 1 && !isAssistant && (
                            <EstimationWrapper
                                task={tempTask}
                                projectId={projectId}
                                setEstimation={this.setEstimation}
                                setAutoEstimation={this.setAutoEstimation}
                            />
                        )}
                        {done && !isAssistant && (
                            <FollowUpWrapper task={tempTask} createFollowUpTask={this.addFollowUpTask} />
                        )}
                        {editing && (
                            <Hotkeys
                                keyName={'alt+del'}
                                onKeyDown={(sht, event) =>
                                    execShortcutFn(this.removeBtnRef, this.openConfirmationModal, event)
                                }
                                filter={e => true}
                            >
                                <Button
                                    ref={ref => (this.removeBtnRef = ref)}
                                    icon={'trash-2'}
                                    iconColor={colors.Text04}
                                    buttonStyle={{ backgroundColor: 'transparent', marginRight: 4 }}
                                    onPress={this.openConfirmationModal}
                                    shortcutText={'Del'}
                                    forceShowShortcut={true}
                                    disabled={showConfirmationModal}
                                />
                            </Hotkeys>
                        )}
                    </View>
                    <Button
                        icon={this.needBeUpdated() ? (editing ? 'save' : 'plus') : 'x'}
                        iconColor={'#ffffff'}
                        type={'primary'}
                        onPress={this.actionDoneButton}
                        shortcutText={'Enter'}
                        forceShowShortcut={true}
                    />
                </View>
                <Popover
                    content={
                        <ConfirmationModal closeModal={this.closeConfirmationModal} deleteTask={this.deleteTask} />
                    }
                    align={'start'}
                    position={['bottom']}
                    contentLocation={{ top: 0, left: 0 }}
                    isOpen={showConfirmationModal}
                >
                    <View />
                </Popover>
            </View>
        )
    }
}

const localStyles = StyleSheet.create({
    inputContainer: {
        borderColor: '#182A6D',
        borderWidth: 1,
        borderTopStartRadius: 4,
        flexDirection: 'row',
        padding: 8,
        paddingBottom: 3,
        minHeight: 64,
    },
    textInputText: {
        // ...styles.body1,
        color: '#ffffff',
    },
    actionsBar: {
        height: 56,
        backgroundColor: colors.Secondary300,
        borderTopEndRadius: 4,
        padding: 8,
        flexDirection: 'row',
    },
    buttonsLeft: {
        flexDirection: 'row',
        flex: 1,
    },
})
