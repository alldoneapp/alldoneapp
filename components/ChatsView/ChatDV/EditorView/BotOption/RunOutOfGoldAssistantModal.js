import React, { useEffect } from 'react'
import { StyleSheet, View } from 'react-native'
import { useDispatch } from 'react-redux'

import { applyPopoverWidth } from '../../../../../utils/HelperFunctions'
import { colors } from '../../../../styles/global'
import useWindowSize from '../../../../../utils/useWindowSize'
import { translate } from '../../../../../i18n/TranslationService'
import ModalHeader from '../../../../UIComponents/FloatModals/ModalHeader'
import CustomScrollView from '../../../../UIControls/CustomScrollView'
import Button from '../../../../UIControls/Button'
import NavigationService from '../../../../../utils/NavigationService'
import { navigateToSettings } from '../../../../../redux/actions'
import { DV_TAB_SETTINGS_PREMIUM } from '../../../../../utils/TabNavigationConstants'
import { RUN_OUT_OF_GOLD_MODAL_ID, removeModal, storeModal } from '../../../../ModalsManager/modalsManager'
import { getSafeAreaModalMaxHeight } from '../../../../../utils/modalSafeArea'

export default function RunOutOfGoldAssistantModal({
    closeModal,
    closeModalWhenNavigateToPremium,
    showAssistantDisabledText,
}) {
    const dispatch = useDispatch()
    const [width, height] = useWindowSize()

    const navigateToPremium = () => {
        NavigationService.navigate('SettingsView')
        dispatch(navigateToSettings({ selectedNavItem: DV_TAB_SETTINGS_PREMIUM }))
        closeModalWhenNavigateToPremium?.()
    }

    useEffect(() => {
        storeModal(RUN_OUT_OF_GOLD_MODAL_ID)
        return () => {
            removeModal(RUN_OUT_OF_GOLD_MODAL_ID)
        }
    }, [])

    return (
        <View style={[localStyles.container, applyPopoverWidth(), { maxHeight: getSafeAreaModalMaxHeight(height) }]}>
            <CustomScrollView style={localStyles.scroll} showsVerticalScrollIndicator={false}>
                <ModalHeader
                    closeModal={closeModal}
                    title={'Alldone assistant'}
                    description={translate('You have run out of gold description')}
                    description2={showAssistantDisabledText ? translate('The assistant was disabled') : undefined}
                />
                <View style={localStyles.buttonContainer}>
                    <Button title={translate('Cancel')} type={'secondary'} onPress={closeModal} />
                    <Button
                        title={translate('Go to Premium')}
                        icon={'crown'}
                        iconSize={22}
                        buttonStyle={localStyles.button}
                        onPress={navigateToPremium}
                    />
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
        boxShadow: '0px 4px 16px rgba(78,93,120,0.56)',
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
