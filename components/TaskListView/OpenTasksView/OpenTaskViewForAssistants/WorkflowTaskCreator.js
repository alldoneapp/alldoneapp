import React, { useEffect, useMemo, useRef, useState } from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { useDispatch } from 'react-redux'

import Button from '../../../UIControls/Button'
import Icon from '../../../Icon'
import styles, { colors } from '../../../styles/global'
import TaskInputArea from '../../TaskItem/TaskInputArea'
import ExecutionModeButton from '../../TaskItem/ExecutionModeButton'
import { translate } from '../../../../i18n/TranslationService'
import { assistantWorkflowFirstStepHasPrompt } from '../../../../utils/assistantWorkflow'
import { setSelectedNavItem } from '../../../../redux/actions'
import { DV_TAB_ASSISTANT_WORKFLOW } from '../../../../utils/TabNavigationConstants'
import URLsAssistants, { URL_ASSISTANT_DETAILS_WORKFLOW } from '../../../../URLSystem/Assistants/URLsAssistants'
import NavigationService from '../../../../utils/NavigationService'
import { generateTaskFromPreConfig } from '../../../../utils/assistantHelper'
import { TASK_EXECUTION_MODE_WORKFLOW } from '../../../../utils/taskExecutionMode'

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
    const creatingRef = useRef(false)
    const taskInputDraft = useMemo(() => ({ genericData: null, calendarData: null, gmailData: null, executionMode }), [
        executionMode,
    ])

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
            <View
                testID="assistant-workflow-task-editor"
                style={[localStyles.taskEditor, disabled && localStyles.disabled]}
            >
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
                    leftAccessory={
                        <View style={localStyles.addIcon}>
                            <Icon name="plus-square" size={24} color={colors.Primary100} />
                        </View>
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
                <View testID="assistant-workflow-task-actions" style={localStyles.buttonContainer}>
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
    taskEditor: {
        flex: 1,
        marginHorizontal: -16,
        backgroundColor: 'transparent',
        borderWidth: 0,
        borderRadius: 0,
        shadowColor: 'transparent',
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0,
        shadowRadius: 0,
        elevation: 0,
    },
    disabled: {
        opacity: 0.5,
    },
    addIcon: {
        position: 'absolute',
        left: 7,
        top: 7,
        zIndex: 100,
    },
    buttonContainer: {
        minHeight: 55,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'flex-end',
        backgroundColor: colors.Grey100,
        borderTopWidth: 1,
        borderTopColor: colors.Gray300,
        paddingVertical: 7,
        paddingHorizontal: 9,
        marginHorizontal: 8,
        borderBottomLeftRadius: 4,
        borderBottomRightRadius: 4,
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
