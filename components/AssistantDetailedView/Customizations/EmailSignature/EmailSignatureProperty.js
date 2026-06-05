import React, { useEffect, useRef, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import Popover from 'react-tiny-popover'
import { useDispatch } from 'react-redux'

import styles, { colors } from '../../../styles/global'
import Icon from '../../../Icon'
import Button from '../../../UIControls/Button'
import { hideFloatPopup, showFloatPopup } from '../../../../redux/actions'
import { TASK_DESCRIPTION_MODAL_ID, removeModal, storeModal } from '../../../ModalsManager/modalsManager'
import AssistantInstructionsModal from '../../../UIComponents/FloatModals/AssistantInstructionsModal/AssistantInstructionsModal'
import { DEFAULT_EMAIL_SIGNATURE } from '../../../AdminPanel/Assistants/assistantsHelper'
import { updateAssistantEmailSignature } from '../../../../utils/backends/Assistants/assistantsFirestore'
import { translate } from '../../../../i18n/TranslationService'

export default function EmailSignatureProperty({ disabled, projectId, assistant }) {
    const dispatch = useDispatch()
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

    const updateSignature = emailSignature => {
        updateAssistantEmailSignature(projectId, assistant, emailSignature)
    }

    const assistantWithSignature = {
        ...assistant,
        instructions: typeof assistant.emailSignature === 'string' ? assistant.emailSignature : DEFAULT_EMAIL_SIGNATURE,
    }

    return (
        <View style={localStyles.container}>
            <Icon name="mail" size={24} color={colors.Text03} style={localStyles.icon} />
            <Text style={localStyles.text}>{translate('Email signature')}</Text>
            <View style={localStyles.buttons}>
                <Popover
                    content={
                        <AssistantInstructionsModal
                            disabled={disabled}
                            updateInstructions={updateSignature}
                            closeModal={closeModal}
                            assistant={assistantWithSignature}
                            title={translate('Email signature')}
                            description={translate('Here you can enter the email signature')}
                            placeholder={translate('Type to add an email signature')}
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
    buttons: {
        marginLeft: 'auto',
        flexDirection: 'row',
        alignItems: 'center',
    },
})
