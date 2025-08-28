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
    TEMPERATURE_HIGH,
    TEMPERATURE_LOW,
    TEMPERATURE_NORMAL,
    TEMPERATURE_VERY_HIGH,
    TEMPERATURE_VERY_LOW,
} from '../../../AdminPanel/Assistants/assistantsHelper'

const options = [
    { text: 'Very low', temperature: TEMPERATURE_VERY_LOW, shortcutKey: '1' },
    { text: 'Low', temperature: TEMPERATURE_LOW, shortcutKey: '2' },
    { text: 'Normal', temperature: TEMPERATURE_NORMAL, shortcutKey: '3' },
    { text: 'High', temperature: TEMPERATURE_HIGH, shortcutKey: '4' },
    { text: 'Very high', temperature: TEMPERATURE_VERY_HIGH, shortcutKey: '5' },
]

export default function AssistantTemperatureModal({ closeModal, temperature, updateTemperature }) {
    const [width, height] = useWindowSize()

    const selectTemperature = temperature => {
        updateTemperature(temperature)
        closeModal()
    }

    return (
        <View>
            <View style={[localStyles.container, applyPopoverWidth(), { maxHeight: height - MODAL_MAX_HEIGHT_GAP }]}>
                <CustomScrollView style={localStyles.scroll} showsVerticalScrollIndicator={false}>
                    <ModalHeader
                        closeModal={closeModal}
                        title={translate('Assistant temperature')}
                        description={translate('Select the AI temperature')}
                    />
                    {options.map(data => (
                        <OptionItem
                            key={data.temperature}
                            temperatureData={data}
                            selectTemperature={selectTemperature}
                            selectedTemperature={temperature}
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
