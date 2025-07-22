import React, { useEffect } from 'react'
import { StyleSheet, View } from 'react-native'
import { useSelector } from 'react-redux'

import { colors } from '../../../../styles/global'
import { CONNECT_CALENDAR_MODAL_ID, removeModal, storeModal } from '../../../../ModalsManager/modalsManager'
import { translate } from '../../../../../i18n/TranslationService'
import ModalHeader from '../../../../UIComponents/FloatModals/ModalHeader'
import ActionButton from './ActionButton'
import ConnectedUserData from './ConnectedUserData'

export default function ConnectCalendarModal({ projectId, isSignedIn, closePopover, setIsSignedIn }) {
    const isConnected = useSelector(state => state.loggedUser.apisConnected?.[projectId]?.calendar)

    const isConnectedAndSignedIn = isConnected && isSignedIn

    useEffect(() => {
        storeModal(CONNECT_CALENDAR_MODAL_ID)
        return () => removeModal(CONNECT_CALENDAR_MODAL_ID)
    }, [])

    return (
        <View style={localStyles.container}>
            <ModalHeader
                closeModal={closePopover}
                title={translate('Google calendar account')}
                description={translate('Google calendar account description')}
            />
            {isConnectedAndSignedIn && <ConnectedUserData isConnected={isConnected} />}
            <ActionButton
                projectId={projectId}
                isConnected={isConnected}
                isSignedIn={isSignedIn}
                closePopover={closePopover}
                setIsSignedIn={setIsSignedIn}
            />
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        backgroundColor: colors.Secondary400,
        padding: 16,
        borderRadius: 4,
        width: 432,
        shadowColor: 'rgba(78, 93, 120, 0.56)',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 1,
        shadowRadius: 16,
        elevation: 3,
    },
})
