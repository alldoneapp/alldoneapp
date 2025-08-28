import React, { Component } from 'react'
import { StyleSheet, View } from 'react-native'
import v4 from 'uuid/v4'

import { colors } from '../../../styles/global'
import { MANAGE_TASK_MODAL_ID, removeModal } from '../../../ModalsManager/modalsManager'
import Header from './Header'
import TaskArea from './TaskArea'
import { applyPopoverWidth, dismissPopupInBackground, MODAL_MAX_HEIGHT_GAP } from '../../../../utils/HelperFunctions'
import Backend from '../../../../utils/BackendBridge'
import AddSubtask from './AddSubtask'
import CustomScrollView from '../../../UIControls/CustomScrollView'
import store from '../../../../redux/store'
import { withWindowSizeHook } from '../../../../utils/useWindowSize'
import ProjectHelper from '../../../SettingsView/ProjectsSettings/ProjectHelper'
import URLTrigger from '../../../../URLSystem/URLTrigger'
import NavigationService from '../../../../utils/NavigationService'
import { TASK_ASSIGNEE_ASSISTANT_TYPE } from '../../../TaskListView/Utils/TasksHelper'
import { getDvMainTabLink } from '../../../../utils/LinkingHelper'

class ManageTaskModal extends Component {
    constructor(props) {
        super(props)
        const { task } = this.props
        this.state = {
            subtasks: [],
            taskBeenEdited: task ? task.id : '',
            openModals: store.getState().openModals,
            loggedUserId: store.getState().loggedUser.uid,
            watcherKey: v4(),
            unsubscribe: store.subscribe(this.updateState),
        }
        this.closed = false
    }

    updateState = () => {
        const { openModals } = store.getState()
        const { closeModal, editing } = this.props
        if (!openModals[MANAGE_TASK_MODAL_ID] && !this.closed) {
            this.setState({ openModals })
            this.cleanComponent()
            closeModal('close')

            dismissPopupInBackground(MANAGE_TASK_MODAL_ID, editing)
        }
    }

    componentDidMount() {
        const { projectId, task, closeModal } = this.props
        const { watcherKey, loggedUserId } = this.state
        document.addEventListener('keydown', this.onKeyDown)
        if (task) {
            const loggedUserIsTaskOwner = task.userId === loggedUserId
            const loggedUserCanUpdateObject =
                loggedUserIsTaskOwner || !ProjectHelper.checkIfLoggedUserIsNormalUserInGuide(projectId)

            if (loggedUserCanUpdateObject) {
                Backend.watchSubtasks(projectId, task.id, watcherKey, this.updateSubtasks)
            } else {
                closeModal()
                const url = getDvMainTabLink(projectId, task.id, 'tasks')
                URLTrigger.processUrl(NavigationService, url)
            }
        }
    }

    cleanComponent = () => {
        this.closed = true
        const { task } = this.props
        const { watcherKey } = this.state
        document.removeEventListener('keydown', this.onKeyDown)
        removeModal(MANAGE_TASK_MODAL_ID)
        if (task) {
            Backend.unwatch(watcherKey)
        }
    }

    componentWillUnmount() {
        this.cleanComponent()
    }

    setTaskBeenEdited = value => {
        this.setState({ taskBeenEdited: value })
    }

    updateSubtasks = subtasks => {
        this.setState({ subtasks })
    }

    onKeyDown = event => {
        const { closeModal } = this.props
        const { key } = event
        if (key === 'Escape') {
            closeModal()
        } else if (key === 'Enter') {
            event.preventDefault()
            event.stopPropagation()
        }
    }

    onLayoutContainer = data => {
        const { setMentionModalHeight } = this.props
        if (setMentionModalHeight) {
            setMentionModalHeight(data.nativeEvent.layout.height)
        }
    }

    render() {
        const { subtasks, taskBeenEdited } = this.state
        const {
            projectId,
            editing,
            closeModal,
            editorRef,
            noteId,
            task,
            tagId,
            unwatchTask,
            windowSize,
            objectUrl,
        } = this.props

        const isAssistant = task && task.assigneeType === TASK_ASSIGNEE_ASSISTANT_TYPE

        return (
            <CustomScrollView
                style={[
                    localStyles.container,
                    { maxHeight: windowSize[1] - MODAL_MAX_HEIGHT_GAP },
                    applyPopoverWidth(),
                    this.closed && { opacity: 0 },
                ]}
                showsVerticalScrollIndicator={false}
                nativeID={MANAGE_TASK_MODAL_ID}
            >
                <View onLayout={this.onLayoutContainer}>
                    <Header closeModal={closeModal} editing={editing} />
                    <TaskArea
                        projectId={projectId}
                        closeModal={closeModal}
                        editorRef={editorRef}
                        noteId={noteId}
                        editing={editing}
                        task={task}
                        tagId={tagId}
                        unwatchTask={unwatchTask}
                        startInEditionMode={true}
                        taskBeenEdited={taskBeenEdited}
                        setTaskBeenEdited={this.setTaskBeenEdited}
                        objectUrl={objectUrl}
                    />
                    {!isAssistant &&
                        subtasks.map(subtask => (
                            <TaskArea
                                key={subtask.id}
                                projectId={projectId}
                                closeModal={closeModal}
                                editorRef={editorRef}
                                noteId={noteId}
                                editing={true}
                                task={subtask}
                                tagId={tagId}
                                unwatchTask={unwatchTask}
                                isSubtask={true}
                                taskBeenEdited={taskBeenEdited}
                                setTaskBeenEdited={this.setTaskBeenEdited}
                            />
                        ))}
                    {!isAssistant && editing && (
                        <AddSubtask
                            projectId={projectId}
                            parentTask={task}
                            taskBeenEdited={taskBeenEdited}
                            setTaskBeenEdited={this.setTaskBeenEdited}
                            closeModal={closeModal}
                        />
                    )}
                </View>
            </CustomScrollView>
        )
    }
}
export default withWindowSizeHook(ManageTaskModal)

const localStyles = StyleSheet.create({
    container: {
        flexDirection: 'column',
        paddingHorizontal: 8,
        paddingVertical: 8,
        borderRadius: 4,
        backgroundColor: colors.Secondary400,
        shadowColor: 'rgba(78, 93, 120, 0.56)',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 1,
        shadowRadius: 16,
        elevation: 3,
    },
})
