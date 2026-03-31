import React, { useEffect, useRef, useState } from 'react'
import { StyleSheet, View, Text } from 'react-native'
import Popover from 'react-tiny-popover'
import { useDispatch, useSelector } from 'react-redux'

import styles, { colors } from '../../../styles/global'
import Icon from '../../../Icon'
import Button from '../../../UIControls/Button'
import { hideFloatPopup, showFloatPopup } from '../../../../redux/actions'
import { TASK_DESCRIPTION_MODAL_ID, removeModal, storeModal } from '../../../ModalsManager/modalsManager'
import { updateAssistantHeartbeatSettings } from '../../../../utils/backends/Assistants/assistantsFirestore'
import AssistantInstructionsModal from '../../../UIComponents/FloatModals/AssistantInstructionsModal/AssistantInstructionsModal'
import { translate } from '../../../../i18n/TranslationService'

const DEFAULT_PROMPT =
    'Check the done tasks today, comment on it and/or the chat history with one sentence and ask the user if he already did the focus task (remind him) or if there are any other ways you can help.'

export default function HeartbeatPromptProperty({ disabled, projectId, assistant }) {
    const dispatch = useDispatch()
    const mobile = useSelector(state => state.smallScreenNavigation)
    const [isOpen, setIsOpen] = useState(false)
    const isOpenRef = useRef(false)

    const openModal = () => {
        setIsOpen(true)
        dispatch(showFloatPopup())
        storeModal(TASK_DESCRIPTION_MODAL_ID)
    }

    const closeModal = () => {
        setIsOpen(false)
        dispatch(hideFloatPopup())
        removeModal(TASK_DESCRIPTION_MODAL_ID)
    }

    useEffect(() => {
        isOpenRef.current = isOpen
    }, [isOpen])

    useEffect(() => {
        return () => {
            if (isOpenRef.current) {
                dispatch(hideFloatPopup())
                removeModal(TASK_DESCRIPTION_MODAL_ID)
            }
        }
    }, [])

    const updatePrompt = instructions => {
        updateAssistantHeartbeatSettings(projectId, assistant, { heartbeatPrompt: instructions })
    }

    const assistantWithPrompt = {
        ...assistant,
        instructions: assistant.heartbeatPrompt ?? DEFAULT_PROMPT,
    }

    return (
        <View style={localStyles.container}>
            <Icon name="edit-3" size={24} color={colors.Text03} style={localStyles.icon} />
            <Text style={localStyles.text}>{translate('Heartbeat prompt')}</Text>
            <View style={{ marginLeft: 'auto' }}>
                <Popover
                    content={
                        <AssistantInstructionsModal
                            disabled={disabled}
                            updateInstructions={updatePrompt}
                            closeModal={closeModal}
                            assistant={assistantWithPrompt}
                        />
                    }
                    align={'center'}
                    position={['bottom']}
                    onClickOutside={closeModal}
                    isOpen={isOpen}
                    contentLocation={null}
                >
                    <Button type={'ghost'} icon={'edit'} onPress={openModal} disabled={isOpen || disabled} />
                </Popover>
            </View>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flex: 1,
        flexDirection: 'row',
        maxHeight: 56,
        minHeight: 56,
        height: 56,
        paddingLeft: 8,
        paddingVertical: 8,
        alignItems: 'center',
    },
    icon: {
        marginRight: 8,
    },
    text: {
        ...styles.subtitle2,
        color: colors.Text03,
    },
})
