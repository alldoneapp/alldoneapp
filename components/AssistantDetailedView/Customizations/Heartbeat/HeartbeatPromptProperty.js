import React, { useEffect, useRef, useState } from 'react'
import { StyleSheet, View, Text } from 'react-native'
import Popover from 'react-tiny-popover'
import { useDispatch, useSelector } from 'react-redux'

import styles, { colors } from '../../../styles/global'
import Icon from '../../../Icon'
import Button from '../../../UIControls/Button'
import { hideFloatPopup, showFloatPopup } from '../../../../redux/actions'
import { TASK_DESCRIPTION_MODAL_ID, removeModal, storeModal } from '../../../ModalsManager/modalsManager'
import {
    ASSISTANT_PROMPT_FIELD_HEARTBEAT,
    ASSISTANT_PROMPT_HISTORY_FIELD_HEARTBEAT,
    DEFAULT_HEARTBEAT_PROMPT,
    updateAssistantHeartbeatSettings,
} from '../../../../utils/backends/Assistants/assistantsFirestore'
import AssistantInstructionsModal from '../../../UIComponents/FloatModals/AssistantInstructionsModal/AssistantInstructionsModal'
import { translate } from '../../../../i18n/TranslationService'
import PromptHistoryWrapper from '../PromptHistory/PromptHistoryWrapper'

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

    const currentPrompt = assistant.heartbeatPrompt ?? DEFAULT_HEARTBEAT_PROMPT
    const assistantWithPrompt = {
        ...assistant,
        instructions: currentPrompt,
    }

    return (
        <View style={localStyles.container}>
            <Icon name="edit-3" size={24} color={colors.Text03} style={localStyles.icon} />
            <View style={localStyles.textColumn}>
                <Text style={localStyles.text}>{translate('Heartbeat prompt')}</Text>
                <Text style={localStyles.hint}>{translate('Tip: reply HEARTBEAT_OK to skip posting a message')}</Text>
            </View>
            <View style={localStyles.buttons}>
                <PromptHistoryWrapper
                    disabled={disabled}
                    projectId={projectId}
                    assistant={assistant}
                    promptField={ASSISTANT_PROMPT_FIELD_HEARTBEAT}
                    historyField={ASSISTANT_PROMPT_HISTORY_FIELD_HEARTBEAT}
                    currentPrompt={currentPrompt}
                    title={translate('Recover a heartbeat prompt version')}
                    description={translate('Select a heartbeat prompt version to recover')}
                    restorePrompt={updatePrompt}
                />
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
                    <Button type={'ghost'} icon={'edit-2'} onPress={openModal} disabled={isOpen || disabled} />
                </Popover>
            </View>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flex: 1,
        flexDirection: 'row',
        minHeight: 56,
        paddingLeft: 8,
        paddingVertical: 8,
        alignItems: 'center',
    },
    icon: {
        marginRight: 8,
    },
    textColumn: {
        flexShrink: 1,
    },
    buttons: {
        marginLeft: 'auto',
        flexDirection: 'row',
        alignItems: 'center',
    },
    text: {
        ...styles.subtitle2,
        color: colors.Text03,
    },
    hint: {
        ...styles.caption2,
        color: colors.Text03,
        marginTop: 2,
    },
})
