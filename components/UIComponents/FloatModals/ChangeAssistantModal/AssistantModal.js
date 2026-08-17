import React from 'react'
import { StyleSheet, View } from 'react-native'

import { colors } from '../../../styles/global'
import ModalHeader from '../ModalHeader'
import { applyPopoverWidth } from '../../../../utils/HelperFunctions'
import CustomScrollView from '../../../UIControls/CustomScrollView'
import useWindowSize from '../../../../utils/useWindowSize'
import { translate } from '../../../../i18n/TranslationService'
import AssistantsArea from './AssistantsArea'
import { getSafeAreaModalMaxHeight } from '../../../../utils/modalSafeArea'

export default function AssistantModal({
    closeModal,
    projectId,
    updateAssistant,
    currentAssistantId,
    includeDefaultProjectAssistant = true,
    defaultProjectAssistantAtEnd = false,
    alwaysUpdateOnSelect = false,
}) {
    const [width, height] = useWindowSize()

    return (
        <View>
            <View
                style={[localStyles.container, applyPopoverWidth(), { maxHeight: getSafeAreaModalMaxHeight(height) }]}
            >
                <CustomScrollView style={localStyles.scroll} showsVerticalScrollIndicator={false}>
                    <ModalHeader
                        closeModal={closeModal}
                        title={translate('Select assistant')}
                        description={translate('Select the assistant that will help you')}
                    />
                    <AssistantsArea
                        closeModal={closeModal}
                        projectId={projectId}
                        updateAssistant={updateAssistant}
                        currentAssistantId={currentAssistantId}
                        includeDefaultProjectAssistant={includeDefaultProjectAssistant}
                        defaultProjectAssistantAtEnd={defaultProjectAssistantAtEnd}
                        alwaysUpdateOnSelect={alwaysUpdateOnSelect}
                    />
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
