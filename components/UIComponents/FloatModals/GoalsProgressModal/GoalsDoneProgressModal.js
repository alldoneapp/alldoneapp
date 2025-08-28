import React from 'react'
import { StyleSheet, View } from 'react-native'

import { colors } from '../../../styles/global'
import ModalHeader from '../ModalHeader'
import { applyPopoverWidth, MODAL_MAX_HEIGHT_GAP } from '../../../../utils/HelperFunctions'
import useWindowSize from '../../../../utils/useWindowSize'
import CustomScrollView from '../../../UIControls/CustomScrollView'
import Button from '../../../UIControls/Button'
import { translate } from '../../../../i18n/TranslationService'

export default function GoalsDoneProgressModal({ closeModal }) {
    const [width, height] = useWindowSize()
    return (
        <View style={[localStyles.container, applyPopoverWidth(), { maxHeight: height - MODAL_MAX_HEIGHT_GAP }]}>
            <CustomScrollView style={localStyles.scroll} showsVerticalScrollIndicator={false}>
                <ModalHeader
                    closeModal={closeModal}
                    title={translate('Goals progress locked')}
                    description={translate('Goals progress locked description')}
                />
                <View style={localStyles.buttonContainer}>
                    <Button title={'Ok'} type={'primary'} onPress={closeModal} />
                </View>
            </CustomScrollView>
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
    buttonContainer: {
        flexDirection: 'row',
        justifyContent: 'center',
    },
})
