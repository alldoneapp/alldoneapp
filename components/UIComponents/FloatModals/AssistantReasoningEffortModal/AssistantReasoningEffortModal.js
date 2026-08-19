import React from 'react'
import { StyleSheet, View } from 'react-native'

import { colors } from '../../../styles/global'
import ModalHeader from '../ModalHeader'
import { applyPopoverWidth } from '../../../../utils/HelperFunctions'
import OptionItem from './OptionItem'
import useWindowSize from '../../../../utils/useWindowSize'
import CustomScrollView from '../../../UIControls/CustomScrollView'
import { translate } from '../../../../i18n/TranslationService'
import { SELECTABLE_ASSISTANT_REASONING_EFFORTS } from '../../../../functions/Assistant/selectableAssistantReasoningEfforts'
import { getSafeAreaModalMaxHeight } from '../../../../utils/modalSafeArea'

const options = SELECTABLE_ASSISTANT_REASONING_EFFORTS.map((option, index) => ({
    text: option.labelKey,
    reasoningEffort: option.value,
    shortcutKey: String(index + 1),
}))

export default function AssistantReasoningEffortModal({ closeModal, reasoningEffort, updateReasoningEffort }) {
    const [, height] = useWindowSize()

    const selectReasoningEffort = value => {
        updateReasoningEffort(value)
        closeModal()
    }

    return (
        <View>
            <View
                style={[localStyles.container, applyPopoverWidth(), { maxHeight: getSafeAreaModalMaxHeight(height) }]}
            >
                <CustomScrollView style={localStyles.scroll} showsVerticalScrollIndicator={false}>
                    <ModalHeader
                        closeModal={closeModal}
                        title={translate('Reasoning effort')}
                        description={translate('Select how much reasoning the assistant should use')}
                    />
                    {options.map(option => (
                        <OptionItem
                            key={option.reasoningEffort || 'model-default'}
                            option={option}
                            selectedReasoningEffort={reasoningEffort}
                            selectReasoningEffort={selectReasoningEffort}
                        />
                    ))}
                </CustomScrollView>
            </View>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flexDirection: 'column',
        borderRadius: 4,
        backgroundColor: colors.Secondary400,
        boxShadow: '0px 4px 16px rgba(78,93,120,0.56)',
        elevation: 3,
    },
    scroll: {
        padding: 16,
    },
})
