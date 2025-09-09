import React, { Component } from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import Hotkeys from 'react-hot-keys'

import styles, { colors } from '../styles/global'
import Icon from '../Icon'
import store from '../../redux/store'
import EstimationModal from '../UIComponents/FloatModals/EstimationModal/EstimationModal'
import CloseButton from '../FollowUp/CloseButton'
import AttachmentsTag from '../FollowUp/AttachmentsTag'
import WorkflowSelection from './WorkflowSelection'
import TasksHelper, { DONE_STEP, getTaskAutoEstimation, OPEN_STEP } from '../TaskListView/Utils/TasksHelper'
import {
    applyPopoverWidth,
    chronoEntriesOrder,
    getWorkflowStepsIdsSorted,
    getCommentDirectionWhenMoveTaskInTheWorklfow,
    getWorkflowStepId,
} from '../../utils/HelperFunctions'
import { STAYWARD_COMMENT, updateNewAttachmentsData } from '../Feeds/Utils/HelperFunctions'
import { startLoadingData } from '../../redux/actions'
import Shortcut, { SHORTCUT_LIGHT } from '../UIControls/Shortcut'
import RichCommentModal from '../UIComponents/FloatModals/RichCommentModal/RichCommentModal'
import FileTag from '../Tags/FileTag'
import { MENTION_MODAL_ID, removeModal, storeModal, WORKFLOW_MODAL_ID } from '../ModalsManager/modalsManager'
import { translate } from '../../i18n/TranslationService'
import { getUserPresentationData } from '../ContactsView/Utils/ContactsHelper'
import {
    moveTasksFromMiddleOfWorkflow,
    moveTasksFromOpen,
    setTaskAutoEstimation,
} from '../../utils/backends/Tasks/tasksFirestore'
import MainButtons from './MainButtons'
import NextStep from './NextStep'
import ChangeReviewerEstimation from './ChangeReviewerEstimation'
import ChangeAssigneeEstimation from './ChangeAssigneeEstimation'

export const WORKFLOW_FORWARD = 'FORWARD'
export const WORKFLOW_BACKWARD = 'BACKWARD'

export default class WorkflowModal extends Component {
    constructor(props) {
        super(props)
        const storeState = store.getState()

        this._isMounted = false
        this._timeouts = new Set()

        this.state = {
            inComments: false,
            inEstimation: false,
            inWorkflowSelection: false,
            inCalendar: false,
            inEstimationReviewer: false,
            comment: '',
            mentions: [],
            files: [],
            isPrivate: false,
            hasKarma: false,
            estimation: this.props.task.estimations[OPEN_STEP],
            date: '',
            dateText: '',
            steps: this.props.workflow,
            selectedNextStep: OPEN_STEP,
            selectedPreviousStep: OPEN_STEP,
            currentStep: OPEN_STEP,
            selectedCustomStep: false,
            currentStepId: '',
            estimations: {},
            disabledMainButtons: false,
            currentUser: storeState.currentUser,
            smallScreenNavigation: storeState.smallScreenNavigation,
            unsubscribe: store.subscribe(this.updateState),
        }

        this.taskOwner = TasksHelper.getTaskOwner(this.props.task.userId, this.props.projectId)
    }

    componentDidMount() {
        this._isMounted = true
        storeModal(WORKFLOW_MODAL_ID)
        document.addEventListener('keydown', this.followUpModalOnEnter)

        const { workflow: steps, task, pending } = this.props
        if (steps) {
            if (pending) {
                this.isPendingComponentDidMount()
            } else {
                let currentStep
                let currentStepId = ''
                let selectedNextStep = ''
                let selectedPreviousStep = ''
                if (!this.isNotInReview()) {
                    const stepsEntries = Object.entries(steps).sort(chronoEntriesOrder)
                    for (currentStep = 0; currentStep < stepsEntries.length; ++currentStep) {
                        if (stepsEntries[currentStep][0] === task.stepHistory[task.stepHistory.length - 1]) {
                            selectedNextStep = currentStep + 1 < stepsEntries.length ? currentStep + 1 : DONE_STEP
                            selectedPreviousStep = currentStep - 1 > -1 ? currentStep - 1 : OPEN_STEP
                            currentStepId = stepsEntries[currentStep][0]
                            break
                        }
                    }

                    this.setState({
                        steps,
                        currentStep,
                        currentStepId,
                        selectedNextStep,
                        selectedPreviousStep,
                        estimations: { ...task.estimations },
                    })
                } else {
                    if (task.done) {
                        this.setState({
                            steps,
                            currentStep: DONE_STEP,
                            selectedNextStep: OPEN_STEP,
                            selectedPreviousStep: OPEN_STEP,
                            estimations: { ...task.estimations },
                        })
                    } else if (this.isToReview()) {
                        const stepsEntries = Object.entries(steps).sort(chronoEntriesOrder)
                        for (currentStep = 0; currentStep < stepsEntries.length; ++currentStep) {
                            if (stepsEntries[currentStep][0] === task.stepHistory[task.stepHistory.length - 1]) {
                                selectedNextStep = currentStep + 1 < stepsEntries.length ? currentStep + 1 : DONE_STEP
                                selectedPreviousStep = currentStep - 1 > -1 ? currentStep - 1 : OPEN_STEP

                                break
                            }
                        }
                        this.setState({
                            steps,
                            currentStep,
                            selectedNextStep,
                            selectedPreviousStep,
                            estimations: { ...task.estimations },
                        })
                    } else {
                        this.setState({
                            steps,
                            currentStep: OPEN_STEP,
                            selectedNextStep: 0,
                            selectedPreviousStep: 0,
                            estimations: { ...task.estimations },
                        })
                    }
                }
            }
        }
    }

    isPendingComponentDidMount = () => {
        const { workflow: steps, task } = this.props

        const stepsEntries = Object.entries(steps).sort(chronoEntriesOrder)
        const currentStep = task.stepHistory.length - 2
        const selectedNextStep = currentStep + 1 < stepsEntries.length ? currentStep + 1 : DONE_STEP
        const selectedPreviousStep = currentStep - 1 > -1 ? currentStep - 1 : OPEN_STEP

        this.setState({
            steps,
            currentStep,
            selectedNextStep,
            selectedPreviousStep,
            estimations: { ...task.estimations },
        })
    }

    componentWillUnmount() {
        removeModal(WORKFLOW_MODAL_ID)
        document.removeEventListener('keydown', this.followUpModalOnEnter)
        this.state.unsubscribe()
        this._isMounted = false
        // Clear any pending timeouts
        this._timeouts.forEach(id => clearTimeout(id))
        this._timeouts.clear()
    }

    setSafeState = updater => {
        if (this._isMounted) {
            this.setState(updater)
        } else {
            console.debug('[WorkflowModal] setState called after unmount ignored')
        }
    }

    scheduleTimeout = (fn, delay = 0) => {
        const id = setTimeout(() => {
            this._timeouts.delete(id)
            fn()
        }, delay)
        this._timeouts.add(id)
        return id
    }

    updateState = () => {
        const storeState = store.getState()

        if (!this._isMounted) return

        this.setState({
            currentUser: storeState.currentUser,
            smallScreenNavigation: storeState.smallScreenNavigation,
        })
    }

    getCommentAndFiles = (comment, mentions, isPrivate, hasKarma) => {
        this.scheduleTimeout(() => {
            this.setSafeState({ comment, mentions, isPrivate, hasKarma, inComments: false })
        })
    }

    closeCommentsPopover = e => {
        this.scheduleTimeout(() => {
            const { isQuillTagEditorOpen, openModals } = store.getState()
            if (!isQuillTagEditorOpen && !openModals[MENTION_MODAL_ID]) {
                if (e) {
                    e.preventDefault()
                    e.stopPropagation()
                }
                this.setSafeState({ inComments: false })
            }
        })
    }

    blockButtons = () => {
        this.setSafeState({ disabledMainButtons: true })
    }

    removeComment = () => {
        this.setSafeState({ comment: '', mentions: [], files: [] })
    }

    removeFile = index => {
        const newFiles = [...this.state.files]
        newFiles.splice(index, 1)
        this.setSafeState({ files: newFiles })
    }

    setAssigneeEstimationModal = estimation => {
        const { estimations } = this.state
        this.setSafeState({ estimation, estimations: { ...estimations, [OPEN_STEP]: estimation } })
    }

    closeAssigneeEstimationModal = () => {
        this.setSafeState({ inEstimation: false })
    }

    openAssigneeEstimationModal = () => {
        this.setSafeState({ inEstimation: true })
    }

    setReviewerEstimationModal = estimation => {
        const { estimations, steps, currentStep } = this.state

        const stepsEntries = Object.entries(steps).sort(chronoEntriesOrder)
        const stepId = stepsEntries[currentStep][0]

        this.setSafeState({ estimations: { ...estimations, [stepId]: estimation } })
    }

    closeReviewerEstimationModal = () => {
        this.setSafeState({ inEstimationReviewer: false })
    }

    openReviewerEstimationModal = () => {
        this.setSafeState({ inEstimationReviewer: true })
    }

    closeWorkFlowSelection = () => {
        this.setSafeState({ inWorkflowSelection: false })
    }

    openWorkFlowSelection = () => {
        this.setSafeState({ inWorkflowSelection: true })
    }

    onPressClose = () => {
        this.props.cancelPopover()
    }

    selectStep = (stepIndex, hideModal = false) => {
        this.setSafeState({ selectedNextStep: stepIndex, inWorkflowSelection: hideModal, selectedCustomStep: true })
    }

    setAutoEstimation = autoEstimation => {
        const { task, projectId } = this.props
        setTaskAutoEstimation(projectId, task, autoEstimation)
    }

    onDonePress = direction => {
        const { task, projectId, checkBoxId } = this.props
        const { steps, estimations, selectedNextStep, comment, disabledMainButtons } = this.state

        if (disabledMainButtons) return

        this.blockButtons()

        store.dispatch(startLoadingData())

        updateNewAttachmentsData(projectId, comment).then(commentWithAttachments => {
            const { stepHistory } = task
            const stepsIds = getWorkflowStepsIdsSorted(steps)

            const stepToMoveIndex = direction === WORKFLOW_BACKWARD ? OPEN_STEP : selectedNextStep
            const stepToMoveId = getWorkflowStepId(stepToMoveIndex, stepsIds)
            const commentType =
                commentWithAttachments && commentWithAttachments.length > 0
                    ? getCommentDirectionWhenMoveTaskInTheWorklfow(stepToMoveIndex, stepsIds, stepHistory)
                    : STAYWARD_COMMENT

            if (task.userIds.length === 1) {
                moveTasksFromOpen(
                    projectId,
                    task,
                    stepToMoveId,
                    commentWithAttachments,
                    commentType,
                    estimations,
                    checkBoxId
                )
            } else {
                moveTasksFromMiddleOfWorkflow(
                    projectId,
                    task,
                    stepToMoveId,
                    commentWithAttachments,
                    commentType,
                    estimations,
                    checkBoxId
                )
            }
        })

        this.props.hidePopover()
    }

    followUpModalOnEnter = e => {
        if (!this._isMounted) return
        const {
            inComments,
            inEstimation,
            inWorkflowSelection,
            inCalendar,
            inEstimationReviewer,
            disabledMainButtons,
        } = this.state

        if (e.key === 'Enter' && !inComments && !inEstimation && !inEstimationReviewer) {
            if (inWorkflowSelection || inCalendar) {
                this.setSafeState({
                    inComments: false,
                    inEstimation: false,
                    inWorkflowSelection: false,
                    inCalendar: false,
                    inEstimationReviewer: false,
                })
            } else if (!disabledMainButtons) {
                this.onDonePress(WORKFLOW_FORWARD)
            }
        }
    }

    getStepDataForTag = assignee => {
        const { steps, selectedNextStep } = this.state
        if (selectedNextStep === OPEN_STEP) {
            return { nextStepDescription: 'Open', nextStepPhotoURL: assignee.photoURL }
        } else if (selectedNextStep === DONE_STEP) {
            return { nextStepDescription: 'Done', nextStepPhotoURL: '' }
        } else {
            const stepsData = Object.entries(steps).sort(chronoEntriesOrder)[selectedNextStep]

            return {
                nextStepDescription: stepsData[1].description,
                nextStepPhotoURL: getUserPresentationData(stepsData[1].reviewerUid).photoURL,
            }
        }
    }

    isToReview() {
        const { task } = this.props
        const storeState = store.getState()
        return task.userIds.length > 1 && task.userIds[task.userIds.length - 1] === storeState.currentUser.uid
    }

    isNotInReview() {
        const { task } = this.props
        const storeState = store.getState()
        return task.userIds.length === 1 || task.userIds[task.userIds.length - 1] !== storeState.currentUser.uid
    }

    openCommentsPopover = e => {
        e.preventDefault()
        e.stopPropagation()
        this.setState({ inComments: true })
    }

    commentShortcut = (sht, event) => {
        if (event != null) {
            event.preventDefault()
            event.stopPropagation()
        }
        this.setState({ inComments: true })
    }

    render() {
        const {
            comment,
            mentions,
            files,
            isPrivate,
            hasKarma,
            selectedNextStep,
            selectedCustomStep,
            estimations,
            currentStep,
            steps,
            smallScreenNavigation: mobile,
            disabledMainButtons,
        } = this.state
        const { task, pending, projectId, ownerIsWorkstream } = this.props
        const { nextStepDescription, nextStepPhotoURL } = this.getStepDataForTag(this.taskOwner)
        const ownerId = ownerIsWorkstream ? store.getState().loggedUser.uid : task.userId

        return this.state.inComments ? (
            <RichCommentModal
                projectId={projectId}
                objectType={'tasks'}
                objectId={task.id}
                closeModal={this.closeCommentsPopover}
                processDone={this.getCommentAndFiles}
                currentComment={comment}
                currentMentions={mentions}
                currentPrivacy={isPrivate}
                currentKarma={hasKarma}
                inTaskModal={true}
                userGettingKarmaId={ownerId}
                externalAssistantId={task.assistantId}
                objectName={task.name}
            />
        ) : this.state.inEstimation ? (
            <EstimationModal
                projectId={this.props.projectId}
                estimation={estimations[OPEN_STEP]}
                closePopover={this.closeAssigneeEstimationModal}
                setEstimationFn={this.setAssigneeEstimationModal}
                showBackButton={true}
                autoEstimation={getTaskAutoEstimation(projectId, estimations[OPEN_STEP], task.autoEstimation)}
                setAutoEstimation={this.setAutoEstimation}
                showAutoEstimation={!task.isSubtask}
            />
        ) : this.state.inEstimationReviewer ? (
            <EstimationModal
                projectId={this.props.projectId}
                estimation={estimations[task.stepHistory[task.stepHistory.length - 1]]}
                setEstimationFn={this.setReviewerEstimationModal}
                closePopover={this.closeReviewerEstimationModal}
                showBackButton={true}
                autoEstimation={getTaskAutoEstimation(
                    projectId,
                    estimations[task.stepHistory[task.stepHistory.length - 1]],
                    task.autoEstimation
                )}
                setAutoEstimation={this.setAutoEstimation}
                showAutoEstimation={!task.isSubtask}
            />
        ) : this.state.inWorkflowSelection ? (
            <WorkflowSelection
                closePopover={this.closeWorkFlowSelection}
                steps={this.props.workflow}
                task={task}
                assignee={this.taskOwner}
                selectedNextStep={selectedNextStep}
                selectStep={this.selectStep}
                estimations={estimations}
                currentStep={currentStep}
            />
        ) : (
            <View style={[localStyles.container, applyPopoverWidth()]}>
                <View style={localStyles.innerContainer}>
                    <View style={localStyles.heading}>
                        <View style={localStyles.title}>
                            <Text style={[styles.title7, { color: 'white' }]}>
                                {translate(pending ? 'Accept task?' : 'Congrats, you have done it!')}
                            </Text>
                            <Text style={[styles.body2, { color: colors.Text03, width: 273 }]}>
                                {translate('Select from the options below')}
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
                        {currentStep === OPEN_STEP ? (
                            <ChangeAssigneeEstimation
                                projectId={projectId}
                                estimations={estimations}
                                openAssigneeEstimationModal={this.openAssigneeEstimationModal}
                            />
                        ) : (
                            <ChangeReviewerEstimation
                                projectId={projectId}
                                estimations={estimations}
                                openReviewerEstimationModal={this.openReviewerEstimationModal}
                                task={task}
                                steps={steps}
                                currentStep={currentStep}
                            />
                        )}
                        <NextStep
                            selectedNextStep={selectedNextStep}
                            selectedCustomStep={selectedCustomStep}
                            currentStep={currentStep}
                            nextStepDescription={nextStepDescription}
                            nextStepPhotoURL={nextStepPhotoURL}
                            openWorkFlowSelection={this.openWorkFlowSelection}
                        />
                        <MainButtons
                            onDonePress={this.onDonePress}
                            selectedCustomStep={selectedCustomStep}
                            currentStep={currentStep}
                            disabled={disabledMainButtons}
                        />
                    </View>
                </View>
            </View>
        )
    }
}

const localStyles = StyleSheet.create({
    container: {
        flexDirection: 'column',
        width: 305,
        shadowColor: 'rgba(78, 93, 120, 0.56)',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 1,
        shadowRadius: 16,
        elevation: 3,
    },
    innerContainer: {
        flexDirection: 'column',
        borderRadius: 4,
        backgroundColor: colors.Secondary400,
    },
    heading: {
        flexDirection: 'row',
        paddingLeft: 16,
        paddingTop: 8,
        paddingRight: 8,
    },
    title: {
        flexDirection: 'column',
        marginTop: 8,
    },
    subsection: {
        marginTop: 20,
        paddingHorizontal: 16,
    },
    uploadText: {
        color: 'white',
        marginLeft: 8,
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
})
