import React, { useEffect, useState, useRef } from 'react'
import { View, StyleSheet } from 'react-native'

import { applyPopoverWidth, MODAL_MAX_HEIGHT_GAP } from '../../../../utils/HelperFunctions'
import useWindowSize from '../../../../utils/useWindowSize'
import CustomScrollView from '../../../UIControls/CustomScrollView'
import { translate } from '../../../../i18n/TranslationService'
import ModalHeader from '../ModalHeader'
import PromptArea from './PromptArea'
import ButtonsArea from './ButtonsArea'
import VariablesArea from './VariablesArea'
import { colors } from '../../../styles/global'
import AssistantAvatar from '../../../AdminPanel/Assistants/AssistantAvatar'
import CloseButton from '../../../FollowUp/CloseButton'
import Line from '../GoalMilestoneModal/Line'
import { generateTaskFromPreConfig } from '../../../../utils/assistantHelper'
import { isModalOpen, MENTION_MODAL_ID } from '../../../ModalsManager/modalsManager'
import store from '../../../../redux/store'
import { MENTION_SPACE_CODE } from '../../../Feeds/Utils/HelperFunctions'

export default function PreConfigTaskGeneratorModal({
    projectId,
    closeModal,
    assistant,
    task,
    processPromp,
    defaultContext,
}) {
    const [values, setValues] = useState({})
    const [generatedPrompt, setGeneratedPrompt] = useState(prompt)
    const [previewPrompt, setPreviewPrompt] = useState(prompt)
    const [width, height] = useWindowSize()

    const inputRefs = useRef({})

    const { prompt, variables, name } = task

    const setValue = (name, value) => {
        setValues(state => {
            return { ...state, [name]: value }
        })
    }

    const addTask = async () => {
        closeModal()
        if (processPromp) {
            processPromp(generatedPrompt)
        } else {
            store.dispatch(setPreConfigTaskExecuting(name))
            // Build aiSettings from task configuration
            const aiSettings =
                task.aiModel || task.aiTemperature || task.aiSystemMessage
                    ? {
                          model: task.aiModel,
                          temperature: task.aiTemperature,
                          systemMessage: task.aiSystemMessage,
                      }
                    : null
            // Build taskMetadata including sendWhatsApp
            const taskMetadata = {
                ...(task.taskMetadata || {}),
                sendWhatsApp: !!task.sendWhatsApp,
            }
            generateTaskFromPreConfig(projectId, name, assistant.uid, generatedPrompt, aiSettings, taskMetadata)
        }
    }

    const onPressKey = event => {
        if (isModalOpen(MENTION_MODAL_ID)) return

        if (event.key === 'Enter') {
            event.preventDefault()
            event.stopPropagation()
            addTask()
        } else if (event.key === 'Tab') {
            const refs = Object.values(inputRefs.current)
            if (refs.length > 0) {
                const focusedIndex = refs.findIndex(ref => ref.isFocused())
                if (focusedIndex > -1) {
                    refs[focusedIndex + 1 === refs.length ? 0 : focusedIndex + 1].focus()
                } else {
                    refs[0].focus()
                }
                event.preventDefault()
                event.stopPropagation()
            }
        }
    }

    useEffect(() => {
        document.addEventListener('keydown', onPressKey)
        return () => {
            document.removeEventListener('keydown', onPressKey)
        }
    })

    useEffect(() => {
        // Pre-fill values with defaultContext if available and values are empty
        if (defaultContext && variables.length > 0) {
            const newValues = { ...values }
            let hasChanges = false
            variables.forEach(variable => {
                if (!newValues[variable.name]) {
                    newValues[variable.name] = {
                        raw: `@${defaultContext.name.replaceAll(' ', MENTION_SPACE_CODE)}#${defaultContext.id} `,
                        display: defaultContext.name,
                    }
                    hasChanges = true
                }
            })
            if (hasChanges) {
                setValues(newValues)
            }
        }
    }, [defaultContext])

    useEffect(() => {
        const variablesWithValues = variables.map(variable => {
            const val = values[variable.name]
            let rawValue = ''
            let displayValue = ''

            if (val && typeof val === 'object') {
                rawValue = (val.raw || '').trim()
                displayValue = (val.display || cleanTextMetaData(rawValue)).trim()
            } else {
                rawValue = (val || '').trim()
                displayValue = cleanTextMetaData(rawValue).trim()
            }
            return { name: variable.name, raw: rawValue, display: displayValue }
        })

        let newGeneratedPrompt = prompt
        let newPreviewPrompt = prompt

        variablesWithValues.forEach(variable => {
            const { name, raw, display } = variable
            if (raw) newGeneratedPrompt = newGeneratedPrompt.replaceAll(`$${name}`, raw)
            if (display) newPreviewPrompt = newPreviewPrompt.replaceAll(`$${name}`, display)
        })

        setGeneratedPrompt(newGeneratedPrompt)
        setPreviewPrompt(newPreviewPrompt)
    }, [values])

    return (
        <View style={[localStyles.container, applyPopoverWidth(), { maxHeight: height - MODAL_MAX_HEIGHT_GAP }]}>
            <CustomScrollView style={localStyles.scroll} showsVerticalScrollIndicator={false}>
                <AssistantAvatar photoURL={assistant.photoURL300} assistantId={assistant.uid} size={51} />
                <CloseButton style={localStyles.closeButton} close={closeModal} />
                <ModalHeader
                    title={assistant.displayName}
                    description={translate('Fill out the form to tell the AI Assistant what you need')}
                    closeModal={closeModal}
                    hideCloseButton={true}
                />
                {variables.length > 0 && (
                    <VariablesArea
                        inputRefs={inputRefs}
                        variables={variables}
                        setValue={setValue}
                        values={values}
                        projectId={projectId}
                    />
                )}
                <Line style={{ marginTop: 12, marginBottom: 16 }} />
                <PromptArea
                    generatedPrompt={generatedPrompt}
                    assistantName={assistant.displayName}
                    projectId={projectId}
                />
                <ButtonsArea addTask={addTask} />
            </CustomScrollView>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        backgroundColor: colors.Secondary400,
        borderRadius: 4,
        width: 305,
        shadowColor: 'rgba(78, 93, 120, 0.56)',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 1,
        shadowRadius: 16,
        elevation: 3,
    },
    scroll: {
        paddingTop: 16,
        paddingLeft: 16,
        paddingRight: 16,
        paddingBottom: 16,
    },
    closeButton: {
        top: -8,
        right: -8,
    },
})
