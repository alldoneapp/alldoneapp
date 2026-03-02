import React, { useEffect } from 'react'
import { StyleSheet, View } from 'react-native'
import { useSelector } from 'react-redux'

import { colors } from '../../../../styles/global'
import { CONNECT_GMAIL_MODAL_ID, removeModal, storeModal } from '../../../../ModalsManager/modalsManager'
import { translate } from '../../../../../i18n/TranslationService'
import ModalHeader from '../../../../UIComponents/FloatModals/ModalHeader'
import ActionButton from './ActionButton'
import ConnectedUserData from './ConnectedUserData'
import GmailLabelingSettings from './GmailLabelingSettings'

export default function ConnectGmailModal({ projectId, authStatus, closePopover, setAuthStatus }) {
    const isConnected = useSelector(state => state.loggedUser.apisConnected?.[projectId]?.gmail)

    const isConnectedAndSignedIn = isConnected && authStatus?.hasCredentials

    useEffect(() => {
        storeModal(CONNECT_GMAIL_MODAL_ID)
        return () => removeModal(CONNECT_GMAIL_MODAL_ID)
    }, [])

    return (
        <View style={localStyles.container}>
            <ModalHeader
                closeModal={closePopover}
                title={'Google Gmail'}
                description={translate('Google gmail description')}
            />
            {isConnectedAndSignedIn && <ConnectedUserData isConnected={isConnected} email={authStatus?.email} />}
            <ActionButton
                projectId={projectId}
                isConnected={isConnected}
                authStatus={authStatus}
                closePopover={closePopover}
                setAuthStatus={setAuthStatus}
            />
            <GmailLabelingSettings projectId={projectId} isConnected={isConnected} authStatus={authStatus} />
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        backgroundColor: colors.Secondary400,
        padding: 16,
        borderRadius: 4,
        width: 640,
        shadowColor: 'rgba(78, 93, 120, 0.56)',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 1,
        shadowRadius: 16,
        elevation: 3,
    },
})
