import React from 'react'
import { Dimensions, StyleSheet, View } from 'react-native'

import { colors } from '../../../styles/global'
import EditForm from './EditForm'
import { translate } from '../../../../i18n/TranslationService'
import ModalHeader from '../ModalHeader'

export default function AssistantInstructionsModal({ disabled, assistant, closeModal, updateInstructions }) {
    const { instructions: initialInstructions } = assistant
    const { width: windowWidth, height: windowHeight } = Dimensions.get('window')
    const isMobile = windowWidth < 600
    const modalWidth = isMobile ? windowWidth - 32 : Math.min(windowWidth * 0.9, 1200)
    const maxInputHeight = isMobile ? windowHeight * 0.5 : 500

    const setInstructions = instructions => {
        updateInstructions(instructions)
        closeModal()
    }

    return (
        <View>
            <View style={[localStyles.container, { width: modalWidth }, isMobile && localStyles.mobileContainer]}>
                <View style={localStyles.innerContainer}>
                    <ModalHeader
                        title={translate('System Message Instructions')}
                        description={translate(`Here you can enter the instructions`)}
                        closeModal={closeModal}
                    />
                    <EditForm
                        disabled={disabled}
                        setInstructions={setInstructions}
                        initialInstructions={initialInstructions}
                        maxInputHeight={maxInputHeight}
                        isMobile={isMobile}
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
        shadowColor: 'rgba(78, 93, 120, 0.56)',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 1,
        shadowRadius: 16,
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
