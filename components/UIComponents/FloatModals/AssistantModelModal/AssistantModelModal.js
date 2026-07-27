import React from 'react'
import { StyleSheet, View } from 'react-native'

import { colors } from '../../../styles/global'
import ModalHeader from '../ModalHeader'
import { applyPopoverWidth, MODAL_MAX_HEIGHT_GAP } from '../../../../utils/HelperFunctions'
import OptionItem from './OptionItem'
import useWindowSize from '../../../../utils/useWindowSize'
import CustomScrollView from '../../../UIControls/CustomScrollView'
import { translate } from '../../../../i18n/TranslationService'
import { SELECTABLE_ASSISTANT_MODELS } from '../../../../functions/Assistant/selectableAssistantModels'

const options = SELECTABLE_ASSISTANT_MODELS.map(({ model, labelKey }) => ({
    text: labelKey,
    model,
    shortcutKey: '',
}))

export default function AssistantModelModal({ closeModal, model, updateModel }) {
    const [, height] = useWindowSize()

    const selectModel = model => {
        updateModel(model)
        closeModal()
    }

    return (
        <View>
            <View style={[localStyles.container, applyPopoverWidth(), { maxHeight: height - MODAL_MAX_HEIGHT_GAP }]}>
                <CustomScrollView style={localStyles.scroll} showsVerticalScrollIndicator={false}>
                    <ModalHeader
                        closeModal={closeModal}
                        title={translate('Assistant model')}
                        description={translate('Select the AI model')}
                    />
                    {options.map(data => (
                        <OptionItem key={data.model} modelData={data} selectModel={selectModel} selectedModel={model} />
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
        shadowColor: 'rgba(78, 93, 120, 0.56)',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 1,
        shadowRadius: 16,
        elevation: 3,
    },
    scroll: {
        padding: 16,
    },
})
