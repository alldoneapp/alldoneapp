import React from 'react'
import { StyleSheet, View } from 'react-native'

import { colors } from '../../../styles/global'
import ModalHeader from '../ModalHeader'
import { applyPopoverWidth, MODAL_MAX_HEIGHT_GAP } from '../../../../utils/HelperFunctions'
import OptionItem from './OptionItem'
import useWindowSize from '../../../../utils/useWindowSize'
import CustomScrollView from '../../../UIControls/CustomScrollView'
import { translate } from '../../../../i18n/TranslationService'
import {
    MODEL_GPT3_5,
    MODEL_GPT4,
    MODEL_GPT4O,
    MODEL_GPT5_1,
    MODEL_SONAR,
    MODEL_SONAR_PRO,
    MODEL_SONAR_REASONING,
    MODEL_SONAR_REASONING_PRO,
    MODEL_SONAR_DEEP_RESEARCH,
} from '../../../AdminPanel/Assistants/assistantsHelper'

const options = [
    { text: 'GPT 3_5', model: MODEL_GPT3_5, shortcutKey: '1' },
    { text: 'GPT 4', model: MODEL_GPT4, shortcutKey: '2' },
    { text: 'GPT 4o', model: MODEL_GPT4O, shortcutKey: '3' },
    { text: 'GPT 5.1', model: MODEL_GPT5_1, shortcutKey: '4' },
    { text: 'Sonar', model: MODEL_SONAR, shortcutKey: '5' },
    { text: 'Sonar Pro', model: MODEL_SONAR_PRO, shortcutKey: '6' },
    { text: 'Sonar Reasoning', model: MODEL_SONAR_REASONING, shortcutKey: '7' },
    { text: 'Sonar Reasoning Pro', model: MODEL_SONAR_REASONING_PRO, shortcutKey: '8' },
    { text: 'Sonar Deep Research', model: MODEL_SONAR_DEEP_RESEARCH, shortcutKey: '9' },
]

export default function AssistantModelModal({ closeModal, model, updateModel }) {
    const [width, height] = useWindowSize()

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
