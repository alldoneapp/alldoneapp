import React, { useState } from 'react'
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native'
import { useDispatch, useSelector } from 'react-redux'

import Button from '../../../UIControls/Button'
import Icon from '../../../Icon'
import styles, { colors } from '../../../styles/global'
import { translate } from '../../../../i18n/TranslationService'
import { createTaskWithService } from '../../../../utils/backends/Tasks/TaskServiceFrontendHelper'
import { assistantWorkflowFirstStepHasPrompt, buildAssistantWorkflowTask } from '../../../../utils/assistantWorkflow'
import { setSelectedNavItem } from '../../../../redux/actions'
import { DV_TAB_ASSISTANT_WORKFLOW } from '../../../../utils/TabNavigationConstants'
import URLsAssistants, { URL_ASSISTANT_DETAILS_WORKFLOW } from '../../../../URLSystem/Assistants/URLsAssistants'
import NavigationService from '../../../../utils/NavigationService'

export default function WorkflowTaskCreator({ projectId, assistant, disabled }) {
    const dispatch = useDispatch()
    const creatorId = useSelector(state => state.loggedUser.uid)
    const [title, setTitle] = useState('')
    const [creating, setCreating] = useState(false)
    const [showWorkflowWarning, setShowWorkflowWarning] = useState(false)
    const [creationError, setCreationError] = useState('')

    const openWorkflow = () => {
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

    const createWorkflowTask = async () => {
        const trimmedTitle = title.trim()
        if (!trimmedTitle || creating || disabled) return

        if (!assistantWorkflowFirstStepHasPrompt(assistant, projectId)) {
            setShowWorkflowWarning(true)
            setCreationError('')
            return
        }

        setCreating(true)
        setShowWorkflowWarning(false)
        setCreationError('')
        try {
            await createTaskWithService(
                buildAssistantWorkflowTask({
                    assistant,
                    projectId,
                    creatorId,
                    title: trimmedTitle,
                }),
                {
                    awaitForTaskCreation: true,
                    notGenerateMentionTasks: false,
                    notGenerateUpdates: false,
                }
            )
            setTitle('')
        } catch (error) {
            console.error('Could not create assistant workflow task', error)
            setCreationError(translate('The workflow task could not be created'))
        } finally {
            setCreating(false)
        }
    }

    return (
        <View style={localStyles.container}>
            <View style={localStyles.headerRow}>
                <Text style={localStyles.header}>{translate('Workflow tasks')}</Text>
                <TouchableOpacity
                    style={localStyles.configurationLink}
                    onPress={openWorkflow}
                    activeOpacity={0.6}
                    accessibilityRole="link"
                    accessibilityLabel={translate('Configure workflow')}
                >
                    <Text style={localStyles.configurationLinkText}>{translate('Configure workflow')}</Text>
                </TouchableOpacity>
            </View>
            <View style={[localStyles.inputRow, disabled && localStyles.disabled]}>
                <TouchableOpacity
                    style={localStyles.addButton}
                    onPress={createWorkflowTask}
                    activeOpacity={0.35}
                    disabled={disabled || creating || !title.trim()}
                    accessibilityRole="button"
                    accessibilityLabel={translate('Add task')}
                >
                    <Icon name="plus-square" size={24} color={colors.Primary100} />
                </TouchableOpacity>
                <TextInput
                    value={title}
                    onChangeText={value => {
                        setTitle(value)
                        setShowWorkflowWarning(false)
                        setCreationError('')
                    }}
                    onSubmitEditing={createWorkflowTask}
                    placeholder={translate('Type to add new task')}
                    placeholderTextColor={colors.Text03}
                    style={[styles.body1, localStyles.input]}
                    editable={!disabled && !creating}
                    returnKeyType="done"
                />
            </View>
            {showWorkflowWarning && (
                <View style={localStyles.warning}>
                    <View style={localStyles.warningCopy}>
                        <Text style={[styles.body2, { color: colors.Text02 }]}>
                            {translate('Define the first workflow step prompt before creating a workflow task')}
                        </Text>
                    </View>
                    <Button type="ghost" title={translate('Open workflow')} onPress={openWorkflow} />
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
    headerRow: {
        minHeight: 22,
        marginTop: 12,
        marginBottom: 4,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    header: {
        ...styles.subtitle2,
        color: colors.Text01,
    },
    configurationLink: {
        paddingVertical: 2,
    },
    configurationLinkText: {
        ...styles.caption2,
        color: colors.Text03,
        textDecorationLine: 'underline',
    },
    inputRow: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        minHeight: 40,
        paddingHorizontal: 8,
        marginHorizontal: -8,
        borderRadius: 4,
        backgroundColor: '#ffffff',
    },
    disabled: {
        opacity: 0.5,
    },
    addButton: {
        marginTop: 8,
    },
    input: {
        flex: 1,
        minHeight: 40,
        color: colors.Text01,
        marginLeft: 12,
        paddingHorizontal: 0,
        paddingVertical: 5,
        outlineStyle: 'none',
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
})
