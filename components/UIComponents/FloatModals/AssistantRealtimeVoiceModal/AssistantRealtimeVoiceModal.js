import React from 'react'
import { StyleSheet, View } from 'react-native'

import { applyPopoverWidth, MODAL_MAX_HEIGHT_GAP } from '../../../../utils/HelperFunctions'
import useWindowSize from '../../../../utils/useWindowSize'
import CustomScrollView from '../../../UIControls/CustomScrollView'
import { colors } from '../../../styles/global'
import ModalHeader from '../ModalHeader'
import OptionItem from './OptionItem'
import { translate } from '../../../../i18n/TranslationService'

const voices = ['marin', 'cedar', 'alloy', 'ash', 'ballad', 'coral', 'echo', 'sage', 'shimmer', 'verse']

export default function AssistantRealtimeVoiceModal({ closeModal, realtimeVoice, updateRealtimeVoice }) {
    const [, height] = useWindowSize()
    const selectVoice = voice => {
        updateRealtimeVoice(voice)
        closeModal()
    }

    return (
        <View>
            <View style={[localStyles.container, applyPopoverWidth(), { maxHeight: height - MODAL_MAX_HEIGHT_GAP }]}>
                <CustomScrollView style={localStyles.scroll} showsVerticalScrollIndicator={false}>
                    <ModalHeader
                        closeModal={closeModal}
                        title={translate('Realtime call voice')}
                        description={translate('Select the voice used for WhatsApp assistant calls')}
                    />
                    {voices.map(voice => (
                        <OptionItem key={voice} voice={voice} selectedVoice={realtimeVoice} selectVoice={selectVoice} />
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
