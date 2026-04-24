import React, { useEffect, useRef, useState } from 'react'
import { Dimensions, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useSelector } from 'react-redux'

import Button from '../../../../UIControls/Button'
import { colors } from '../../../../styles/global'
import styles from '../../../../styles/global'
import { CONNECT_CALENDAR_MODAL_ID, removeModal, storeModal } from '../../../../ModalsManager/modalsManager'
import { translate } from '../../../../../i18n/TranslationService'
import ModalHeader from '../../../../UIComponents/FloatModals/ModalHeader'
import ActionButton from './ActionButton'
import ConnectedUserData from './ConnectedUserData'
import CalendarProjectRoutingSettings from './CalendarProjectRoutingSettings'

export default function ConnectCalendarModal({ projectId, isSignedIn, closePopover, setIsSignedIn }) {
    const isConnected = useSelector(state => state.loggedUser.apisConnected?.[projectId]?.calendar)
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)
    const { width: windowWidth, height: windowHeight } = Dimensions.get('window')
    const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)
    const [showCloseConfirmation, setShowCloseConfirmation] = useState(false)
    const [closingAfterSave, setClosingAfterSave] = useState(false)
    const closeHandlersRef = useRef({})

    const isConnectedAndSignedIn = isConnected && isSignedIn
    const containerWidth = Math.min(Math.max(windowWidth - (smallScreenNavigation ? 24 : 64), 320), 760)
    const scrollMaxHeight = Math.max(Math.min(windowHeight - 160, 760), 320)

    useEffect(() => {
        storeModal(CONNECT_CALENDAR_MODAL_ID)
        return () => removeModal(CONNECT_CALENDAR_MODAL_ID)
    }, [])

    const onRequestClose = () => {
        if (hasUnsavedChanges) {
            setShowCloseConfirmation(true)
            return
        }

        closePopover()
    }

    const onSaveAndClose = async () => {
        if (closingAfterSave) return

        setClosingAfterSave(true)
        try {
            const didSave = await closeHandlersRef.current?.saveAndClose?.()
            if (didSave) closePopover()
        } finally {
            setClosingAfterSave(false)
        }
    }

    const onDiscardAndClose = () => {
        closePopover()
    }

    return (
        <View style={[localStyles.container, { width: containerWidth, maxHeight: scrollMaxHeight }]}>
            {showCloseConfirmation ? (
                <>
                    <ModalHeader
                        closeModal={onRequestClose}
                        title={translate('Google calendar account')}
                        description={translate('Google calendar account description')}
                        hideCloseButton={showCloseConfirmation}
                    />
                    <View style={localStyles.confirmationCard}>
                        <Text style={localStyles.confirmationTitle}>{translate('Unsaved changes')}</Text>
                        <Text style={localStyles.confirmationText}>
                            {translate(
                                'You have unsaved Calendar project routing changes. Save before closing or discard them.'
                            )}
                        </Text>
                        <View style={localStyles.confirmationButtonRow}>
                            <Button
                                title={translate('Save and close')}
                                onPress={onSaveAndClose}
                                processing={closingAfterSave}
                                processingTitle={translate('Saving')}
                                buttonStyle={{ marginRight: 12 }}
                            />
                            <Button
                                title={translate('Discard + close')}
                                type="ghost"
                                onPress={onDiscardAndClose}
                                disabled={closingAfterSave}
                            />
                        </View>
                    </View>
                </>
            ) : (
                <ScrollView
                    style={localStyles.scroll}
                    contentContainerStyle={localStyles.scrollContent}
                    showsVerticalScrollIndicator={false}
                >
                    <ModalHeader
                        closeModal={onRequestClose}
                        title={translate('Google calendar account')}
                        description={translate('Google calendar account description')}
                        hideCloseButton={showCloseConfirmation}
                    />
                    {isConnectedAndSignedIn && <ConnectedUserData projectId={projectId} isConnected={isConnected} />}
                    <ActionButton
                        projectId={projectId}
                        isConnected={isConnected}
                        isSignedIn={isSignedIn}
                        closePopover={closePopover}
                        setIsSignedIn={setIsSignedIn}
                    />
                    <CalendarProjectRoutingSettings
                        projectId={projectId}
                        isConnected={isConnected}
                        isSignedIn={isSignedIn}
                        onUnsavedChangesChange={setHasUnsavedChanges}
                        onRegisterCloseHandlers={handlers => {
                            closeHandlersRef.current = handlers || {}
                        }}
                    />
                </ScrollView>
            )}
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        backgroundColor: colors.Secondary400,
        padding: 16,
        borderRadius: 4,
        shadowColor: 'rgba(78, 93, 120, 0.56)',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 1,
        shadowRadius: 16,
        elevation: 3,
    },
    scroll: {
        flexGrow: 0,
    },
    scrollContent: {
        paddingBottom: 8,
    },
    confirmationCard: {
        paddingTop: 4,
    },
    confirmationTitle: {
        ...styles.subtitle1,
        color: '#ffffff',
        marginBottom: 8,
    },
    confirmationText: {
        ...styles.body2,
        color: colors.Text03,
        marginBottom: 20,
    },
    confirmationButtonRow: {
        flexDirection: 'row',
        alignItems: 'center',
    },
})
