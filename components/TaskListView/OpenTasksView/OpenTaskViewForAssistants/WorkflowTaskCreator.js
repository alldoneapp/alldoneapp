import React, { useEffect, useMemo, useRef, useState } from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { useDispatch } from 'react-redux'

import Button from '../../../UIControls/Button'
import DismissibleItem from '../../../UIComponents/DismissibleItem'
import styles, { colors } from '../../../styles/global'
import AddTask from '../../AddTask'
import TaskInputArea from '../../TaskItem/TaskInputArea'
import ExecutionModeButton from '../../TaskItem/ExecutionModeButton'
import CheckboxAndIcon from '../../TaskItem/CheckboxAndIcon'
import { translate } from '../../../../i18n/TranslationService'
import { assistantWorkflowFirstStepHasPrompt } from '../../../../utils/assistantWorkflow'
import { setSelectedNavItem } from '../../../../redux/actions'
import { DV_TAB_ASSISTANT_WORKFLOW } from '../../../../utils/TabNavigationConstants'
import URLsAssistants, { URL_ASSISTANT_DETAILS_WORKFLOW } from '../../../../URLSystem/Assistants/URLsAssistants'
import NavigationService from '../../../../utils/NavigationService'
import { generateTaskFromPreConfig } from '../../../../utils/assistantHelper'
import { TASK_EXECUTION_MODE_WORKFLOW } from '../../../../utils/taskExecutionMode'
import { taskEditorLayout } from '../../TaskItem/TaskEditorLayout'

const openAssistantWorkflow = (projectId, assistant, dispatch) => {
    NavigationService.navigate('AssistantDetailedView', {
        assistantId: assistant.uid,
        projectId,
    })
    dispatch(setSelectedNavItem(DV_TAB_ASSISTANT_WORKFLOW))
    URLsAssistants.push(
        URL_ASSISTANT_DETAILS_WORKFLOW,
        { projectId, assistantId: assistant.uid },
        projectId,
        assistant.uid
    )
}

export function WorkflowConfigurationLink({ projectId, assistant }) {
    const dispatch = useDispatch()

    return (
        <TouchableOpacity
            style={localStyles.configurationLink}
            onPress={() => openAssistantWorkflow(projectId, assistant, dispatch)}
            activeOpacity={0.6}
            accessibilityRole="link"
            accessibilityLabel={translate('Configure workflow')}
        >
            <Text style={localStyles.configurationLinkText}>{translate('Configure workflow')}</Text>
        </TouchableOpacity>
    )
}

export default function WorkflowTaskCreator({ projectId, assistant, disabled, showConfigurationLink = true }) {
    const dispatch = useDispatch()
    const [title, setTitle] = useState('')
    const [creating, setCreating] = useState(false)
    const [showWorkflowWarning, setShowWorkflowWarning] = useState(false)
    const [creationError, setCreationError] = useState('')
    const [submissionFeedback, setSubmissionFeedback] = useState('')
    const [executionMode, setExecutionMode] = useState(TASK_EXECUTION_MODE_WORKFLOW)
    const [mentionsModalActive, setMentionsModalActive] = useState(false)
    const inputRef = useRef(null)
    const dismissibleRef = useRef(null)
    const creatingRef = useRef(false)
    const taskInputDraft = useMemo(
        () => ({ genericData: null, calendarData: null, gmailData: null, subtaskIds: [], executionMode }),
        [executionMode]
    )

    const createWorkflowTask = async () => {
        const trimmedTitle = title.trim()
        if (!trimmedTitle || creatingRef.current || disabled) return

        if (
            executionMode === TASK_EXECUTION_MODE_WORKFLOW &&
            !assistantWorkflowFirstStepHasPrompt(assistant, projectId)
        ) {
            setShowWorkflowWarning(true)
            setCreationError('')
            setSubmissionFeedback('')
            return
        }

        creatingRef.current = true
        setCreating(true)
        setShowWorkflowWarning(false)
        setCreationError('')
        setSubmissionFeedback(translate('Submitting task'))
        try {
            await generateTaskFromPreConfig(
                projectId,
                trimmedTitle,
                assistant.uid,
                trimmedTitle,
                null,
                { executionMode },
                { skipNavigation: true, waitForDirectRun: false }
            )
            setTitle('')
            inputRef.current?.clear()
            setSubmissionFeedback(translate('Task submitted'))
        } catch (error) {
            console.error('Could not create assistant workflow task', error)
            setSubmissionFeedback('')
            setCreationError(translate('The workflow task could not be created'))
        } finally {
            creatingRef.current = false
            setCreating(false)
        }
    }

    const updateTitle = value => {
        setTitle(value.replace(/\r?\n|\r/g, ''))
        setShowWorkflowWarning(false)
        setCreationError('')
        setSubmissionFeedback('')
    }

    const handleKeyDown = event => {
        if (event.key === 'Enter' && inputRef.current?.isFocused?.() && !event.shiftKey && !mentionsModalActive) {
            event.preventDefault()
            createWorkflowTask()
        }
    }

    const openTaskEditor = () => {
        if (!disabled) dismissibleRef.current?.openModal(true)
    }

    const handleTaskEditorVisibility = visible => {
        if (visible) return
        setTitle('')
        setExecutionMode(TASK_EXECUTION_MODE_WORKFLOW)
        setMentionsModalActive(false)
        setShowWorkflowWarning(false)
        setCreationError('')
        setSubmissionFeedback('')
    }

    useEffect(() => {
        document.addEventListener('keydown', handleKeyDown)
        return () => {
            document.removeEventListener('keydown', handleKeyDown)
        }
    }, [title, disabled, executionMode, mentionsModalActive])

    return (
        <View style={[localStyles.container, !showConfigurationLink && localStyles.timelineContainer]}>
            {showConfigurationLink && (
                <View style={localStyles.headerRow}>
                    <WorkflowConfigurationLink projectId={projectId} assistant={assistant} />
                </View>
            )}
            <View testID="assistant-workflow-task-section" style={taskEditorLayout.addTaskSection}>
                <DismissibleItem
                    ref={dismissibleRef}
                    onToggleModal={handleTaskEditorVisibility}
                    defaultComponent={
                        <AddTask
                            projectId={projectId}
                            newItem
                            toggleModal={openTaskEditor}
                            hideParentGoalButton
                            isLocked={disabled}
                            disabled={disabled}
                            setRepeatModeOnOpen={false}
                        />
                    }
                    modalComponent={
                        <View testID="assistant-workflow-task-editor" style={taskEditorLayout.inlineEditor}>
                            <TaskInputArea
                                isSubtask={false}
                                tmpTask={taskInputDraft}
                                adding={true}
                                projectId={projectId}
                                accessGranted={!disabled && !creating}
                                loggedUserCanUpdateObject={true}
                                isAssistant={false}
                                inputTask={inputRef}
                                onChangeInputText={updateTitle}
                                setMentionsModalActive={setMentionsModalActive}
                                getInitialText={() => ''}
                                onKeyEnterPressed={createWorkflowTask}
                                autoFocusInput
                                leftAccessory={
                                    <CheckboxAndIcon
                                        tmpTask={taskInputDraft}
                                        isSubtask={false}
                                        adding={true}
                                        accessGranted={!disabled && !creating}
                                        showArrowInAnonymous={false}
                                        loggedUserCanUpdateObject={true}
                                        isAssistant={false}
                                        projectId={projectId}
                                    />
                                }
                                rightAccessory={
                                    <View style={localStyles.executionModeAccessory}>
                                        <ExecutionModeButton
                                            task={taskInputDraft}
                                            disabled={disabled || creating}
                                            onChange={setExecutionMode}
                                            style={localStyles.executionModeButton}
                                            iconOnly
                                        />
                                    </View>
                                }
                            />
                            <View
                                testID="assistant-workflow-task-actions"
                                style={[
                                    taskEditorLayout.actionBar,
                                    taskEditorLayout.inlineActionBar,
                                    localStyles.buttonContainer,
                                ]}
                            >
                                <Button
                                    type="primary"
                                    title={translate('Submit')}
                                    processing={creating}
                                    processingTitle={translate('Submitting task')}
                                    onPress={createWorkflowTask}
                                    disabled={disabled || creating || !title.trim()}
                                    accessibilityLabel={translate('Submit')}
                                    accessible={true}
                                />
                            </View>
                        </View>
                    }
                />
            </View>
            {!!submissionFeedback && (
                <Text
                    style={[styles.body2, localStyles.feedback]}
                    accessibilityLiveRegion="polite"
                    accessibilityLabel={submissionFeedback}
                >
                    {submissionFeedback}
                </Text>
            )}
            {showWorkflowWarning && (
                <View style={localStyles.warning}>
                    <View style={localStyles.warningCopy}>
                        <Text style={[styles.body2, { color: colors.Text02 }]}>
                            {translate('Define the first workflow step prompt before creating a workflow task')}
                        </Text>
                    </View>
                    <Button
                        type="ghost"
                        title={translate('Open workflow')}
                        onPress={() => openAssistantWorkflow(projectId, assistant, dispatch)}
                    />
                </View>
            )}
            {!!creationError && <Text style={[styles.body2, localStyles.error]}>{creationError}</Text>}
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        marginBottom: 24,
    },
    timelineContainer: {
        marginBottom: 0,
    },
    headerRow: {
        minHeight: 22,
        marginTop: 12,
        marginBottom: 4,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'flex-end',
    },
    configurationLink: {
        paddingVertical: 2,
    },
    configurationLinkText: {
        ...styles.caption2,
        color: colors.Text03,
        textDecorationLine: 'underline',
    },
    buttonContainer: {
        alignItems: 'center',
        justifyContent: 'flex-end',
    },
    executionModeAccessory: {
        position: 'absolute',
        top: 8,
        right: 8,
        borderRadius: 50,
        overflow: 'hidden',
    },
    executionModeButton: {
        width: 24,
        height: 24,
        minHeight: 24,
        paddingHorizontal: 0,
        paddingVertical: 0,
        borderRadius: 50,
    },
    warning: {
        marginTop: 8,
        paddingLeft: 12,
        minHeight: 48,
        flexDirection: 'row',
        alignItems: 'center',
        borderRadius: 4,
        backgroundColor: colors.UtilityYellow100,
    },
    warningCopy: {
        flex: 1,
        marginRight: 8,
    },
    error: {
        color: colors.UtilityRed200,
        marginTop: 8,
        marginLeft: 12,
    },
    feedback: {
        color: colors.Primary100,
        marginTop: 8,
        marginLeft: 12,
    },
})
