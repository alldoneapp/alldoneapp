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
import store from '../../../../redux/store'
import { setPreConfigTaskExecuting } from '../../../../redux/actions'

export default function PreConfigTaskGeneratorModal({ projectId, closeModal, assistant, task, processPromp }) {
    const [values, setValues] = useState({})
    const [generatedPrompt, setGeneratedPrompt] = useState(prompt)
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
            store.dispatch(setPreConfigTaskExecuting(true))
            generateTaskFromPreConfig(projectId, name, assistant.uid, generatedPrompt)
        }
    }

    const onPressKey = event => {
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
        const variablesWithValues = variables.map(variable => {
            return { name: variable.name, value: (values[variable.name] || '').trim() }
        })

        let generatedPrompt = prompt
        variablesWithValues.forEach(variable => {
            const { name, value } = variable
            if (value.trim()) generatedPrompt = generatedPrompt.replaceAll(`$${name}`, value)
        })

        setGeneratedPrompt(generatedPrompt)
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
                    <VariablesArea inputRefs={inputRefs} variables={variables} setValue={setValue} values={values} />
                )}
                <Line style={{ marginTop: 12, marginBottom: 16 }} />
                <PromptArea generatedPrompt={generatedPrompt} assistantName={assistant.displayName} />
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
