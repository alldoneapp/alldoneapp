import React from 'react'
import { StyleSheet, View } from 'react-native'

import { MODAL_MAX_HEIGHT_GAP, applyPopoverWidth } from '../../../../utils/HelperFunctions'
import { colors } from '../../../styles/global'
import useWindowSize from '../../../../utils/useWindowSize'
import { translate } from '../../../../i18n/TranslationService'
import ModalHeader from '../../../UIComponents/FloatModals/ModalHeader'
import CustomScrollView from '../../../UIControls/CustomScrollView'
import Button from '../../../UIControls/Button'

export default function NotAllowRemoveUserModal({ closeModal, title, description }) {
    const [width, height] = useWindowSize()

    return (
        <View style={[localStyles.container, applyPopoverWidth(), { maxHeight: height - MODAL_MAX_HEIGHT_GAP }]}>
            <CustomScrollView style={localStyles.scroll} showsVerticalScrollIndicator={false}>
                <ModalHeader closeModal={closeModal} title={title} description={description} />
                <View style={localStyles.buttonContainer}>
                    <Button title={translate('Ok')} buttonStyle={localStyles.button} onPress={closeModal} />
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
        marginTop: 8,
        flexDirection: 'row',
        justifyContent: 'center',
    },
    button: {
        marginLeft: 8,
    },
})
