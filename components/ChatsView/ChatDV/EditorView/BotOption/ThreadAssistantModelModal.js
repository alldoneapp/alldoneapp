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
} from '../../../../../functions/Assistant/threadAssistantModel'
import { getAssistantDefaultModelOption } from './assistantDefaultModel'
import { themed } from '../../../../../Themes/colorMode'

/**
 * The per-thread model picker (AT-2502).
 *
 * Reuses `AssistantModelModal`'s `OptionItem` rather than the whole modal, because this picker
 * needs one entry the assistant-level one must never have: an explicit way back to the
 * assistant's own model. Without it a thread could be pinned but never unpinned, and "select a
 * model" would be a one-way door.
 *
 * The inherit entry is listed FIRST and names, on a line of its own under it, the model it falls
 * back to (AT-3162), so the choice reads as "follow the assistant: GPT 6.2 Sol" rather than as an
 * abstract reset. The model entries show their Gold rate in the same place.
 */
export default function ThreadAssistantModelModal({
    closeModal,
    selectedModel,
    assistantModel,
    updateModel,
    // AT-3162: the composers' model button reuses this picker. The assistant line applies the
    // choice to the chat its next message starts, so it says so instead of "this thread".
    title = 'Model for this thread',
    description = 'This model is used only in this thread',
}) {
    const [, height] = useWindowSize()

    // `assistantModel` is the ASSISTANT's own setting, never the chat's override: this line names
    // what choosing the entry would fall back to. Resolved as the server resolves it, so an
    // assistant still storing a replaced key (`MODEL_GPT5_6_SOL`) or no model at all is named too.
    // `OptionItem` translates the key itself (AT-2512: never hand it a finished string).
    const assistantDefault = getAssistantDefaultModelOption(assistantModel)
    const inheritOption = {
        text: 'Use assistant model',
        subtitleKey: assistantDefault?.labelKey,
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
                <ModalHeader closeModal={closeModal} title={translate(title)} description={translate(description)} />
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
        boxShadow: themed.PopupShadow,
        elevation: 3,
    },
    scroll: {
        padding: 16,
    },
})
