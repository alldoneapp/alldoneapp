import React from 'react'
import { StyleSheet, View } from 'react-native'

import { colors } from '../../../../styles/global'
import ModalHeader from '../../../../UIComponents/FloatModals/ModalHeader'
import OptionItem from '../../../../UIComponents/FloatModals/AssistantModelModal/OptionItem'
import CustomScrollView from '../../../../UIControls/CustomScrollView'
import { applyPopoverWidth } from '../../../../../utils/HelperFunctions'
import useWindowSize from '../../../../../utils/useWindowSize'
import { translate } from '../../../../../i18n/TranslationService'
import { getSafeAreaModalMaxHeight } from '../../../../../utils/modalSafeArea'
import {
    INHERIT_ASSISTANT_MODEL,
    THREAD_ASSISTANT_MODEL_OPTIONS,
    getThreadAssistantModelName,
} from '../../../../../functions/Assistant/threadAssistantModel'

/**
 * The per-thread model picker (AT-2502).
 *
 * Reuses `AssistantModelModal`'s `OptionItem` rather than the whole modal, because this picker
 * needs one entry the assistant-level one must never have: an explicit way back to the
 * assistant's own model. Without it a thread could be pinned but never unpinned, and "select a
 * model" would be a one-way door.
 *
 * The inherit entry is listed FIRST and names the model it would fall back to, so the choice
 * reads as "follow the assistant (Sol)" rather than as an abstract reset.
 */
export default function ThreadAssistantModelModal({ closeModal, selectedModel, assistantModel, updateModel }) {
    const [, height] = useWindowSize()

    const assistantName = getThreadAssistantModelName(assistantModel)
    const inheritOption = {
        text: assistantName
            ? `${translate('Use assistant model')} (${assistantName})`
            : translate('Use assistant model'),
        model: INHERIT_ASSISTANT_MODEL,
        shortcutKey: '',
    }
    const options = [
        inheritOption,
        ...THREAD_ASSISTANT_MODEL_OPTIONS.map(({ labelKey, value, tokensPerGold }) => ({
            text: labelKey,
            model: value,
            tokensPerGold,
            shortcutKey: '',
        })),
    ]

    const selectModel = model => {
        updateModel(model)
        closeModal()
    }

    return (
        <View style={[localStyles.container, applyPopoverWidth(), { maxHeight: getSafeAreaModalMaxHeight(height) }]}>
            <CustomScrollView style={localStyles.scroll} showsVerticalScrollIndicator={false}>
                <ModalHeader
                    closeModal={closeModal}
                    title={translate('Model for this thread')}
                    description={translate('This model is used only in this thread')}
                />
                {options.map(data => (
                    <OptionItem
                        key={data.model}
                        modelData={data}
                        selectModel={selectModel}
                        selectedModel={selectedModel || INHERIT_ASSISTANT_MODEL}
                    />
                ))}
            </CustomScrollView>
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
