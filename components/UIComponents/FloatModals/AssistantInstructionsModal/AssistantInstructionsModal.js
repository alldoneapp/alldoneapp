import React from 'react'
import { StyleSheet, View } from 'react-native'

import { colors } from '../../../styles/global'
import EditForm from './EditForm'
import { translate } from '../../../../i18n/TranslationService'
import ModalHeader from '../ModalHeader'
import useModalSizing from '../../../../hooks/useModalSizing'
import { themed } from '../../../../Themes/colorMode'

export default function AssistantInstructionsModal({
    disabled,
    assistant,
    closeModal,
    updateInstructions,
    title = translate('System Message Instructions'),
    description = translate('Here you can enter the instructions'),
    placeholder = translate('Type to add instructions'),
}) {
    const { instructions: initialInstructions } = assistant
    const { isSheet: isMobile, width: sheetWidth, windowWidth, windowHeight } = useModalSizing()
    const modalWidth = isMobile ? sheetWidth : Math.min(windowWidth * 0.9, 1200)
    const maxInputHeight = isMobile ? windowHeight * 0.5 : 500

    const setInstructions = instructions => {
        updateInstructions(instructions)
        closeModal()
    }

    return (
        <View>
            <View style={[localStyles.container, { width: modalWidth }, isMobile && localStyles.mobileContainer]}>
                <View style={localStyles.innerContainer}>
                    <ModalHeader title={title} description={description} closeModal={closeModal} />
                    <EditForm
                        disabled={disabled}
                        setInstructions={setInstructions}
                        initialInstructions={initialInstructions}
                        maxInputHeight={maxInputHeight}
                        isMobile={isMobile}
                        placeholder={placeholder}
                    />
                </View>
            </View>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flexDirection: 'column',
        paddingHorizontal: 16,
        paddingVertical: 16,
        borderRadius: 4,
        backgroundColor: colors.Secondary400,
        boxShadow: themed.PopupShadow,
        elevation: 3,
        height: 'auto',
        minWidth: 600,
    },
    mobileContainer: {
        minWidth: 'auto',
        paddingHorizontal: 8,
        paddingVertical: 8,
    },
    innerContainer: {
        paddingHorizontal: 8,
        paddingVertical: 8,
    },
})
