import React, { useEffect, useState } from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'

import styles, { colors, hexColorToRGBa } from '../../styles/global'
import Icon from '../../Icon'
import Button from '../../UIControls/Button'
import CustomScrollView from '../../UIControls/CustomScrollView'
import CustomTextInput3 from '../../Feeds/CommentsTextInput/CustomTextInput3'
import { COMMENT_MODAL_THEME } from '../../Feeds/CommentsTextInput/textInputHelper'
import ModalHeader from '../../UIComponents/FloatModals/ModalHeader'
import { TASK_TYPE_PROMPT } from '../../UIComponents/FloatModals/PreConfigTaskModal/TaskModal'
import { applyPopoverWidth, MODAL_MAX_HEIGHT_GAP } from '../../../utils/HelperFunctions'
import useWindowSize from '../../../utils/useWindowSize'
import { translate } from '../../../i18n/TranslationService'
import { getPreConfigTasksForProject } from '../../../utils/backends/Assistants/assistantsFirestore'

const CUSTOM_PROMPT_ID = null

/**
 * Picks what an AI workflow step actually does: one of the assistant's pre-configured tasks, or a
 * custom prompt typed here.
 *
 * `$variable` placeholders are normally filled in by a human right before the prompt runs. A
 * workflow run is unattended, so the values are captured here instead and stored on the step.
 */
export default function AiStepActionModal({ projectId, assistantId, step, onChange, closeModal }) {
    const [width, height] = useWindowSize()

    const [preConfigTasks, setPreConfigTasks] = useState([])
    const [loading, setLoading] = useState(true)
    const [selectedTaskId, setSelectedTaskId] = useState(step.aiPreConfigTaskId || CUSTOM_PROMPT_ID)
    const [customPrompt, setCustomPrompt] = useState(step.aiPreConfigTaskId ? '' : step.aiPrompt || '')
    const [variableValues, setVariableValues] = useState(step.aiVariableValues || {})

    useEffect(() => {
        let cancelled = false

        getPreConfigTasksForProject(projectId)
            .then(tasks => {
                if (cancelled) return
                setPreConfigTasks(
                    tasks.filter(task => task.assistantId === assistantId && task.type === TASK_TYPE_PROMPT)
                )
            })
            .catch(error => {
                if (!cancelled) console.error('Failed to load assistant pre-config tasks:', error)
            })
            .finally(() => {
                if (!cancelled) setLoading(false)
            })

        return () => {
            cancelled = true
        }
    }, [projectId, assistantId])

    const selectedTask = preConfigTasks.find(task => task.id === selectedTaskId) || null
    const variables = selectedTask ? selectedTask.variables || [] : []
    const isCustom = selectedTaskId === CUSTOM_PROMPT_ID

    const missingVariable = variables.some(variable => !(variableValues[variable.name] || '').trim())
    const disableSave = isCustom ? !customPrompt.trim() : !selectedTask || missingVariable

    const save = () => {
        if (disableSave) return

        // Keep a snapshot of the prompt alongside the id: the run reads the pre-config task live so
        // later edits to it take effect, and falls back to this copy if the task is deleted.
        onChange(
            isCustom
                ? {
                      aiPreConfigTaskId: null,
                      aiActionName: translate('Custom prompt'),
                      aiPrompt: customPrompt.trim(),
                      aiVariableValues: {},
                  }
                : {
                      aiPreConfigTaskId: selectedTask.id,
                      aiActionName: selectedTask.name || '',
                      aiPrompt: selectedTask.prompt || '',
                      aiVariableValues: variables.reduce(
                          (acc, variable) => ({ ...acc, [variable.name]: variableValues[variable.name] || '' }),
                          {}
                      ),
                  }
        )
        closeModal()
    }

    const renderOption = (id, label) => {
        const active = selectedTaskId === id
        return (
            <TouchableOpacity
                key={id === CUSTOM_PROMPT_ID ? 'custom' : id}
                style={[localStyles.option, active && localStyles.optionActive]}
                onPress={() => setSelectedTaskId(id)}
            >
                <Text style={[styles.subtitle1, localStyles.optionText]} numberOfLines={1}>
                    {label}
                </Text>
                {active && <Icon name="check" size={20} color={colors.Primary100} />}
            </TouchableOpacity>
        )
    }

    return (
        <View style={[localStyles.container, applyPopoverWidth(), { maxHeight: height - MODAL_MAX_HEIGHT_GAP }]}>
            <CustomScrollView style={localStyles.scroll} showsVerticalScrollIndicator={false}>
                <ModalHeader
                    title={translate('Assistant action')}
                    description={translate('Choose what the assistant does when a task reaches this step')}
                    closeModal={closeModal}
                />

                {loading ? (
                    <Text style={[styles.body2, localStyles.hint]}>{translate('Loading')}</Text>
                ) : (
                    <View style={localStyles.optionList}>
                        {preConfigTasks.map(task => renderOption(task.id, task.name))}
                        {renderOption(CUSTOM_PROMPT_ID, translate('Custom prompt'))}
                    </View>
                )}

                {isCustom && (
                    <View style={localStyles.section}>
                        <Text style={localStyles.label}>{translate('Prompt')}</Text>
                        <CustomTextInput3
                            containerStyle={localStyles.promptInput}
                            initialTextExtended={customPrompt}
                            placeholder={translate('Type the prompt the assistant will run')}
                            placeholderTextColor={colors.Text03}
                            multiline={true}
                            numberOfLines={4}
                            onChangeText={setCustomPrompt}
                            disabledTags={true}
                            styleTheme={COMMENT_MODAL_THEME}
                            disabledTabKey={true}
                        />
                    </View>
                )}

                {variables.map(variable => (
                    <View key={variable.name} style={localStyles.section}>
                        <Text style={localStyles.label}>{`$${variable.name}`}</Text>
                        <CustomTextInput3
                            containerStyle={localStyles.input}
                            initialTextExtended={variableValues[variable.name] || ''}
                            placeholder={translate('Type a value for this variable')}
                            placeholderTextColor={colors.Text03}
                            multiline={false}
                            numberOfLines={1}
                            singleLine={true}
                            onChangeText={value =>
                                setVariableValues(current => ({ ...current, [variable.name]: value }))
                            }
                            disabledTags={true}
                            styleTheme={COMMENT_MODAL_THEME}
                            disabledTabKey={true}
                        />
                    </View>
                ))}

                <View style={localStyles.buttons}>
                    <Button title={translate('Cancel')} type={'secondary'} onPress={closeModal} />
                    <Button
                        title={translate('Done')}
                        type={'primary'}
                        buttonStyle={{ marginLeft: 8 }}
                        onPress={save}
                        disabled={disableSave}
                    />
                </View>
            </CustomScrollView>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        backgroundColor: colors.Secondary400,
        borderRadius: 4,
        shadowColor: 'rgba(78, 93, 120, 0.56)',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 1,
        shadowRadius: 16,
        elevation: 3,
    },
    scroll: {
        padding: 16,
    },
    optionList: {
        marginHorizontal: -8,
    },
    option: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingVertical: 8,
        paddingHorizontal: 8,
        borderRadius: 4,
    },
    optionActive: {
        backgroundColor: hexColorToRGBa(colors.Text03, 0.16),
    },
    optionText: {
        color: '#ffffff',
        flex: 1,
        marginRight: 8,
    },
    section: {
        marginTop: 16,
    },
    label: {
        ...styles.subtitle2,
        color: colors.Text02,
        marginBottom: 4,
    },
    hint: {
        color: colors.Text03,
    },
    input: {
        ...styles.body1,
        color: '#ffffff',
        paddingVertical: 3,
        paddingHorizontal: 16,
        borderWidth: 1,
        borderColor: colors.Grey400,
        borderRadius: 4,
        minHeight: 42,
        maxHeight: 42,
    },
    promptInput: {
        ...styles.body1,
        color: '#ffffff',
        paddingVertical: 8,
        paddingHorizontal: 16,
        borderWidth: 1,
        borderColor: colors.Grey400,
        borderRadius: 4,
        minHeight: 96,
    },
    buttons: {
        flexDirection: 'row',
        justifyContent: 'flex-end',
        marginTop: 24,
    },
})
