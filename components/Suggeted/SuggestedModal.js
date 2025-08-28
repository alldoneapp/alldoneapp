import React, { Component } from 'react'
import { Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import styles, { colors } from '../styles/global'
import Icon from '../Icon'
import store from '../../redux/store'
import EstimationModal from '../UIComponents/FloatModals/EstimationModal/EstimationModal'
import Button from '../UIControls/Button'
import Shortcut, { SHORTCUT_LIGHT } from '../UIControls/Shortcut'
import Hotkeys from 'react-hot-keys'
import RichCommentModal from '../UIComponents/FloatModals/RichCommentModal/RichCommentModal'
import FileTag from '../Tags/FileTag'
import { applyPopoverWidth, getWorkflowStepsIdsSorted } from '../../utils/HelperFunctions'
import { FORDWARD_COMMENT, updateNewAttachmentsData } from '../Feeds/Utils/HelperFunctions'
import { FOLLOW_UP_MODAL_ID, MENTION_MODAL_ID, removeModal, storeModal } from '../ModalsManager/modalsManager'
import AttachmentsTag from '../FollowUp/AttachmentsTag'
import CloseButton from '../FollowUp/CloseButton'
import ProjectHelper from '../SettingsView/ProjectsSettings/ProjectHelper'
import AssigneeAndObserversModal from '../UIComponents/FloatModals/AssigneeAndObserversModal/AssigneeAndObserversModal'
import { hideFloatPopup } from '../../redux/actions'
import { cloneDeep, isEqual } from 'lodash'
import TasksHelper, { DONE_STEP, getTaskAutoEstimation, OPEN_STEP } from '../TaskListView/Utils/TasksHelper'
import { translate } from '../../i18n/TranslationService'
import { WORKSTREAM_ID_PREFIX } from '../Workstreams/WorkstreamHelper'
import { getEstimationIconByValue } from '../../utils/EstimationHelper'
import {
    nextStepSuggestedTask,
    setTaskAutoEstimation,
    updateSuggestedTask,
} from '../../utils/backends/Tasks/tasksFirestore'
import { createObjectMessage } from '../../utils/backends/Chats/chatsComments'
export default class SuggestedModal extends Component {
    constructor(props) {
        super(props)
        const storeState = store.getState()

        let task = this.props.task
        let clonedTask = cloneDeep(task)
        if (clonedTask.completed === undefined) {
            clonedTask.completed = null
        }
        this.projectIndex = ProjectHelper.getProjectIndexById(this.props.projectId)

        this.state = {
            tmpTask: clonedTask,
            inComments: false,
            inEstimation: false,
            comment: '',
            files: [],
            mentions: [],
            commentIsPrivate: false,
            hasKarma: false,
            estimation: this.props.task.estimations[OPEN_STEP],
            smallScreenNavigation: storeState.smallScreenNavigation,
            unsubscribe: store.subscribe(this.updateState),
            loggedUser: storeState.loggedUser,
        }
    }

    componentDidMount() {
        storeModal(FOLLOW_UP_MODAL_ID)
        document.addEventListener('keydown', this.onEnter)
    }

    componentWillUnmount() {
        removeModal(FOLLOW_UP_MODAL_ID)
        document.removeEventListener('keydown', this.onEnter)
        this.state.unsubscribe()
    }

    updateState = () => {
        const storeState = store.getState()

        this.setState({
            smallScreenNavigation: storeState.smallScreenNavigation,
        })
    }

    getCommentAndFiles = (comment, mentions, commentIsPrivate, hasKarma) => {
        this.setState({ comment, mentions, commentIsPrivate, hasKarma, inComments: false })
    }

    closeCommentsPopover = e => {
        const { isQuillTagEditorOpen, openModals } = store.getState()
        if (!isQuillTagEditorOpen && !openModals[MENTION_MODAL_ID]) {
            if (e) {
                e.preventDefault()
                e.stopPropagation()
            }
            this.setState({ inComments: false })
        }
    }

    removeComment = () => {
        this.setState({ comment: '', mentions: [], files: [] })
    }

    removeFile = index => {
        const newFiles = [...this.state.files]
        newFiles.splice(index, 1)
        this.setState({ files: newFiles })
    }

    openEstimationModal = () => {
        this.setState({ inEstimation: true })
    }

    closeEstimationModal = () => {
        this.setState({ inEstimation: false })
    }

    setEstimation = estimation => {
        this.setState({ estimation })
    }

    onPressClose = () => {
        this.props.cancelPopover()
    }

    onDonePress = accept => {
        const { comment, estimation, tmpTask, loggedUser } = this.state
        const { projectId, task, hidePopover, checkBoxId } = this.props

        hidePopover()
        updateNewAttachmentsData(projectId, comment).then(commentWithAttachments => {
            if (accept) {
                if (task.userId === tmpTask.userId) {
                    updateSuggestedTask(projectId, task.id, {
                        suggestedBy: null,
                        estimations: { [OPEN_STEP]: estimation },
                    })
                } else {
                    updateSuggestedTask(projectId, task.id, {
                        userId: tmpTask.userId,
                        userIds: [tmpTask.userId],
                        currentReviewerId: tmpTask.userId,
                        suggestedBy: task.creatorId === tmpTask.userId ? null : task.suggestedBy,
                        estimations: { [OPEN_STEP]: estimation },
                    })
                }
                if (comment) {
                    createObjectMessage(
                        projectId,
                        task.id,
                        commentWithAttachments,
                        'tasks',
                        FORDWARD_COMMENT,
                        null,
                        null
                    )
                }
            } else {
                const { currentUser } = store.getState()
                const hasWorkflow = Object.keys(currentUser.workflow?.[projectId] || {}).length > 0
                const stepId = hasWorkflow ? getWorkflowStepsIdsSorted(currentUser.workflow[projectId])[0] : DONE_STEP
                const estimations = { ...task.estimations, [OPEN_STEP]: estimation }
                nextStepSuggestedTask(projectId, stepId, task, estimations, comment, checkBoxId)
            }
        })
    }

    onEnter = e => {
        const { inComments, inWorkflowSelection, inAssignee, inEstimation } = this.state
        if (e.key === 'Enter' && !inComments && !inWorkflowSelection && !inAssignee && !inEstimation) {
            this.onDonePress(true)
        }
    }

    commentShortcut = (sht, event) => {
        if (event != null) {
            event.preventDefault()
            event.stopPropagation()
        }
        this.setState({ inComments: true })
    }

    tasksAreEquals = (task, tmpTask) => {
        return isEqual(
            { ...task, name: task.name.trim(), extendedName: task.name.trim() },
            { ...tmpTask, name: tmpTask.name.trim(), extendedName: tmpTask.name.trim() }
        )
    }

    openCommentsPopover = e => {
        e.preventDefault()
        e.stopPropagation()
        this.setState({ inComments: true })
    }

    setAssigneeBeforeSave = (user, observers) => {
        const { task } = this.props
        const { tmpTask } = this.state

        tmpTask.userId = user.uid
        tmpTask.observersIds = observers.map(user => user.uid).filter(uid => tmpTask.userId !== uid)

        const {
            dueDateByObserversIds,
            estimationsByObserverIds,
        } = TasksHelper.mergeDueDateAndEstimationsByObserversIds(
            task.dueDateByObserversIds,
            tmpTask.observersIds,
            task.estimationsByObserverIds
        )
        tmpTask.dueDateByObserversIds = dueDateByObserversIds
        tmpTask.estimationsByObserverIds = estimationsByObserverIds

        if (!this.tasksAreEquals(task, tmpTask)) {
            this.setState({ tmpTask: tmpTask }, () => {
                if (this.directAction) {
                    this.updateTask(null, false, true)
                }
            })
        }
    }

    delayHidePopover = () => {
        // This timeout is necessary to stop the propagation of the click
        // to close the Modal
        setTimeout(async () => {
            this.setState({ inAssignee: false })
            store.dispatch(hideFloatPopup())
        })
    }

    setAutoEstimation = autoEstimation => {
        const { projectId, task } = this.props
        setTaskAutoEstimation(projectId, task, autoEstimation)
    }

    render() {
        const { projectId, task } = this.props
        const {
            comment,
            mentions,
            files,
            commentIsPrivate,
            hasKarma,
            inComments,
            inEstimation,
            inAssignee,
            estimation,
            smallScreenNavigation: mobile,
            tmpTask,
        } = this.state

        const { photoURL: photoURLCreator, displayName } = TasksHelper.getUserInProject(projectId, task.creatorId) ||
            TasksHelper.getContactInProject(projectId, task.creatorId) || {
                photoURL: `${window.location.origin}/images/generic-user.svg`,
                displayName: translate('Unknown user'),
            }

        const { photoURL: photoURLAssignee } = TasksHelper.getUserInProject(projectId, tmpTask.userId) ||
            TasksHelper.getContactInProject(projectId, tmpTask.userId) ||
            (tmpTask.userId.startsWith(WORKSTREAM_ID_PREFIX) && { photoURL: 'workstream' }) || {
                photoURL: `${window.location.origin}/images/generic-user.svg`,
            }

        return inComments ? (
            <RichCommentModal
                projectId={projectId}
                objectType={'tasks'}
                objectId={task.id}
                closeModal={this.closeCommentsPopover}
                processDone={this.getCommentAndFiles}
                currentComment={comment}
                currentMentions={mentions}
                currentPrivacy={commentIsPrivate}
                currentKarma={hasKarma}
                inTaskModal={true}
                userGettingKarmaId={task.userId}
                externalAssistantId={task.assistantId}
                objectName={task.name}
            />
        ) : inEstimation ? (
            <EstimationModal
                projectId={projectId}
                estimation={estimation}
                setEstimationFn={this.setEstimation}
                closePopover={this.closeEstimationModal}
                showBackButton={true}
                autoEstimation={getTaskAutoEstimation(projectId, estimation, task.autoEstimation)}
                setAutoEstimation={this.setAutoEstimation}
                showAutoEstimation={!task.isSubtask}
            />
        ) : inAssignee ? (
            <AssigneeAndObserversModal
                projectIndex={this.projectIndex}
                object={tmpTask}
                closePopover={this.delayHidePopover}
                delayClosePopover={this.delayHidePopover}
                saveDataBeforeSaveObject={this.setAssigneeBeforeSave}
                inSuggestedModal
            />
        ) : (
            <View style={[localStyles.container, applyPopoverWidth()]}>
                <View style={localStyles.heading}>
                    <View style={localStyles.title}>
                        <View style={{ flexDirection: 'row' }}>
                            <Image source={{ uri: photoURLCreator }} style={localStyles.logo} />
                            <Text style={[styles.title7, { color: 'white' }]}>
                                {translate('Suggested by')} {displayName.split(' ')[0]}
                            </Text>
                        </View>
                        <Text style={[styles.body2, { color: colors.Text03 }]}>
                            {translate('Suggested by description')}
                        </Text>
                    </View>
                    <CloseButton close={this.onPressClose} />
                </View>

                <View style={localStyles.subsection}>
                    <View style={[localStyles.estimationSection, { flexDirection: 'column' }]}>
                        <Hotkeys keyName={'1'} onKeyDown={this.commentShortcut} filter={e => true}>
                            <TouchableOpacity style={localStyles.estimation} onPress={this.openCommentsPopover}>
                                <Icon name="message-circle" size={24} color="white" />
                                <Text style={[styles.subtitle1, localStyles.uploadText]}>
                                    {translate('Add comment')}
                                </Text>
                                <View style={{ marginLeft: 'auto' }}>
                                    {!mobile ? (
                                        <Shortcut text={'1'} theme={SHORTCUT_LIGHT} />
                                    ) : (
                                        <Icon name={'chevron-right'} size={24} color={colors.Text03} />
                                    )}
                                </View>
                            </TouchableOpacity>
                        </Hotkeys>

                        {comment !== '' || files.length > 0 ? (
                            <View style={localStyles.commentSection}>
                                {comment !== '' ? (
                                    <View style={{ marginRight: 4 }}>
                                        <AttachmentsTag
                                            text={comment.substring(0, 20)}
                                            removeTag={this.removeComment}
                                            ico="message-circle"
                                            maxWidth={133}
                                        />
                                    </View>
                                ) : null}

                                {files.map((file, i) => {
                                    return (
                                        <View style={{ marginRight: i % 2 === 0 ? 0 : 4, marginBottom: 8 }}>
                                            <FileTag
                                                key={i}
                                                file={file}
                                                canBeRemoved={true}
                                                onCloseFile={() => this.removeFile(i)}
                                                textStyle={{ maxWidth: 80 }}
                                            />
                                        </View>
                                    )
                                })}
                            </View>
                        ) : null}
                    </View>

                    <View style={[localStyles.estimationSection, localStyles.estimationContainer]}>
                        <Hotkeys keyName={'2'} onKeyDown={this.openEstimationModal} filter={e => true}>
                            <TouchableOpacity style={localStyles.estimation} onPress={this.openEstimationModal}>
                                <Icon
                                    name={`count-circle-${getEstimationIconByValue(projectId, estimation)}`}
                                    size={24}
                                    color="white"
                                />
                                <Text style={[styles.subtitle1, localStyles.uploadText]}>
                                    {translate('Change estimation')}
                                </Text>
                                <View style={{ marginLeft: 'auto' }}>
                                    {!mobile ? (
                                        <Shortcut text={'2'} theme={SHORTCUT_LIGHT} />
                                    ) : (
                                        <Icon name={'chevron-right'} size={24} color={colors.Text03} />
                                    )}
                                </View>
                            </TouchableOpacity>
                        </Hotkeys>
                    </View>

                    <View style={localStyles.itemsContainer}>
                        <Hotkeys keyName={'3'} onKeyDown={() => this.setState({ inAssignee: true })} filter={e => true}>
                            <TouchableOpacity
                                style={localStyles.estimation}
                                onPress={() => this.setState({ inAssignee: true })}
                            >
                                {photoURLAssignee === 'workstream' ? (
                                    <Icon
                                        name="workstream"
                                        size={20}
                                        color={colors.Text03}
                                        style={{ marginRight: 8 }}
                                    />
                                ) : (
                                    <Image source={{ uri: photoURLAssignee }} style={localStyles.logo} />
                                )}
                                <Text style={[styles.subtitle1, { color: '#fff' }]}>{translate('Assignee')}</Text>
                                <View style={{ marginLeft: 'auto' }}>
                                    {!mobile ? (
                                        <Shortcut text={'3'} theme={SHORTCUT_LIGHT} />
                                    ) : (
                                        <Icon name={'chevron-right'} size={24} color={colors.Text03} />
                                    )}
                                </View>
                            </TouchableOpacity>
                        </Hotkeys>
                    </View>

                    <View style={localStyles.doneButtonContainer}>
                        <Button
                            disabled={task.userId !== tmpTask.userId}
                            icon="next-workflow"
                            title={translate('Go to next step')}
                            type="secondary"
                            buttonStyle={{ marginRight: 8 }}
                            onPress={() => this.onDonePress(false)}
                        />
                        <Button title={translate('Accept')} type={'primary'} onPress={() => this.onDonePress(true)} />
                    </View>
                </View>
            </View>
        )
    }
}

const localStyles = StyleSheet.create({
    container: {
        width: 305,
        flexDirection: 'column',
        borderRadius: 4,
        backgroundColor: colors.Secondary400,
        shadowColor: 'rgba(78, 93, 120, 0.56)',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 1,
        shadowRadius: 16,
        elevation: 3,
    },
    heading: {
        paddingLeft: 16,
        paddingTop: 8,
        paddingRight: 8,
    },
    title: {
        flexDirection: 'column',
        marginTop: 8,
    },
    estimationContainer: {
        borderTopColor: colors.funnyWhite,
        borderTopWidth: 1,
    },
    itemsContainer: {
        borderTopColor: colors.funnyWhite,
        borderTopWidth: 1,
        borderBottomColor: colors.funnyWhite,
        borderBottomWidth: 1,
        paddingVertical: 8,
        marginHorizontal: -16,
        paddingHorizontal: 16,
    },
    subsection: {
        marginTop: 20,
        paddingHorizontal: 16,
    },
    uploadText: {
        color: 'white',
        marginLeft: 8,
    },
    doneButtonContainer: {
        height: 72,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        paddingTop: 16,
    },
    estimation: {
        height: 40,
        width: '100%',
        flexDirection: 'row',
        alignItems: 'center',
    },
    estimationSection: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 8,
        marginHorizontal: -16,
        paddingHorizontal: 16,
    },
    commentSection: {
        marginTop: 10,
        alignSelf: 'flex-start',
        flexDirection: 'row',
        overflow: 'hidden',
        flexWrap: 'wrap',
    },
    logo: {
        width: 20,
        height: 20,
        borderRadius: 100,
        marginRight: 8,
    },
})
