import React, { useEffect } from 'react'
import { StyleSheet, View } from 'react-native'
import { useDispatch } from 'react-redux'

import { colors, hexColorToRGBa } from '../../../../styles/global'
import ModalHeader from '../../../../UIComponents/FloatModals/ModalHeader'
import { applyPopoverWidth, MODAL_MAX_HEIGHT_GAP } from '../../../../../utils/HelperFunctions'
import useWindowSize from '../../../../../utils/useWindowSize'
import CustomScrollView from '../../../../UIControls/CustomScrollView'
import Button from '../../../../UIControls/Button'
import { translate } from '../../../../../i18n/TranslationService'
import { setShowNotificationAboutTheBotBehavior } from '../../../../../redux/actions'
import { BOT_WARNING_MODAL_ID, removeModal, storeModal } from '../../../../ModalsManager/modalsManager'
import { setThatTheUserWasNotifiedAboutTheBotBehavior } from '../../../../../utils/backends/Users/usersFirestore'

export default function BotWarningModal() {
    const dispatch = useDispatch()
    const [width, height] = useWindowSize()

    const closeModal = () => {
        dispatch(setShowNotificationAboutTheBotBehavior(false))
    }

    useEffect(() => {
        setThatTheUserWasNotifiedAboutTheBotBehavior()
    }, [])

    useEffect(() => {
        storeModal(BOT_WARNING_MODAL_ID)
        return () => {
            removeModal(BOT_WARNING_MODAL_ID)
        }
    }, [])

    return (
        <View style={localStyles.parent}>
            <View style={[localStyles.container, applyPopoverWidth(), { maxHeight: height - MODAL_MAX_HEIGHT_GAP }]}>
                <CustomScrollView style={localStyles.scroll} showsVerticalScrollIndicator={false}>
                    <ModalHeader
                        title={translate('Caution')}
                        description={translate('Caution AI description')}
                        hideCloseButton={true}
                    />
                    <View style={localStyles.buttonContainer}>
                        <Button title={translate('Ok')} type={'primary'} onPress={closeModal} />
                    </View>
                </CustomScrollView>
            </View>
        </View>
    )
}

const localStyles = StyleSheet.create({
    parent: {
        position: 'absolute',
        zIndex: 10000,
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: hexColorToRGBa(colors.Text03, 0.24),
    },
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
})
