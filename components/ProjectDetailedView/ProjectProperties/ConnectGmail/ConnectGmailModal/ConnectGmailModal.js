import React, { useEffect, useRef, useState } from 'react'
import { Dimensions, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useSelector } from 'react-redux'

import Button from '../../../../UIControls/Button'
import { colors } from '../../../../styles/global'
import styles from '../../../../styles/global'
import { CONNECT_GMAIL_MODAL_ID, removeModal, storeModal } from '../../../../ModalsManager/modalsManager'
import { translate } from '../../../../../i18n/TranslationService'
import ModalHeader from '../../../../UIComponents/FloatModals/ModalHeader'
import ActionButton from './ActionButton'
import ConnectedUserData from './ConnectedUserData'
import GmailLabelingSettings from './GmailLabelingSettings'
import {
    PROVIDER_GOOGLE,
    PROVIDER_MICROSOFT,
    getProviderLabel,
    resolveEmailConnection,
} from '../../../../../utils/IntegrationProviders'

const MODAL_HORIZONTAL_MARGIN = 32
const MOBILE_MODAL_HORIZONTAL_MARGIN = 12
const MODAL_VERTICAL_MARGIN = 16
const MODAL_PADDING = 16
const MAX_MODAL_WIDTH = 760

export default function ConnectGmailModal({ projectId, authStatus, closePopover, setAuthStatus }) {
    const connection = useSelector(state => state.loggedUser.apisConnected?.[projectId])
    const resolvedConnection = resolveEmailConnection(connection)
    const isConnected = resolvedConnection.connected
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)
    const [selectedProvider, setSelectedProvider] = useState(resolvedConnection.provider || PROVIDER_GOOGLE)
    const [windowDimensions, setWindowDimensions] = useState(Dimensions.get('window'))
    const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)
    const [showCloseConfirmation, setShowCloseConfirmation] = useState(false)
    const [closingAfterSave, setClosingAfterSave] = useState(false)
    const closeHandlersRef = useRef({})

    const isConnectedAndSignedIn = isConnected && authStatus?.hasCredentials
    const { width: windowWidth, height: windowHeight } = windowDimensions
    const horizontalMargin = smallScreenNavigation ? MOBILE_MODAL_HORIZONTAL_MARGIN : MODAL_HORIZONTAL_MARGIN
    const availableWidth = Math.max(windowWidth - horizontalMargin * 2, 0)
    const containerWidth = Math.min(availableWidth, MAX_MODAL_WIDTH)
    const containerMaxHeight = Math.max(windowHeight - MODAL_VERTICAL_MARGIN * 2, 0)
    const scrollMaxHeight = Math.max(containerMaxHeight - MODAL_PADDING * 2, 0)

    useEffect(() => {
        storeModal(CONNECT_GMAIL_MODAL_ID)
        return () => removeModal(CONNECT_GMAIL_MODAL_ID)
    }, [])

    useEffect(() => {
        const updateDimensions = ({ window }) => {
            setWindowDimensions(window)
        }

        Dimensions.addEventListener('change', updateDimensions)

        return () => {
            Dimensions.removeEventListener('change', updateDimensions)
        }
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
        <View style={[localStyles.container, { width: containerWidth, maxHeight: containerMaxHeight }]}>
            {showCloseConfirmation ? (
                <ScrollView
                    style={[localStyles.scroll, { maxHeight: scrollMaxHeight }]}
                    contentContainerStyle={localStyles.scrollContent}
                    showsVerticalScrollIndicator={false}
                >
                    <ModalHeader
                        closeModal={onRequestClose}
                        title={translate('Email account')}
                        description={translate('Email account description')}
                        hideCloseButton={showCloseConfirmation}
                    />
                    <View style={localStyles.confirmationCard}>
                        <Text style={localStyles.confirmationTitle}>{translate('Unsaved changes')}</Text>
                        <Text style={localStyles.confirmationText}>
                            {translate('You have unsaved Gmail labeling changes. Save before closing or discard them.')}
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
                </ScrollView>
            ) : (
                <ScrollView
                    style={[localStyles.scroll, { maxHeight: scrollMaxHeight }]}
                    contentContainerStyle={localStyles.scrollContent}
                    showsVerticalScrollIndicator={false}
                >
                    <ModalHeader
                        closeModal={onRequestClose}
                        title={translate('Email account')}
                        description={translate('Email account description')}
                        hideCloseButton={showCloseConfirmation}
                    />
                    {!isConnectedAndSignedIn && (
                        <View style={localStyles.providerRow}>
                            {[PROVIDER_GOOGLE, PROVIDER_MICROSOFT].map(provider => (
                                <Button
                                    key={provider}
                                    title={getProviderLabel(provider)}
                                    type={selectedProvider === provider ? undefined : 'ghost'}
                                    onPress={() => setSelectedProvider(provider)}
                                    buttonStyle={{ marginRight: 8, marginBottom: 8 }}
                                />
                            ))}
                        </View>
                    )}
                    {isConnectedAndSignedIn && (
                        <ConnectedUserData
                            projectId={projectId}
                            isConnected={isConnected}
                            email={authStatus?.email}
                            provider={resolvedConnection.provider || selectedProvider}
                        />
                    )}
                    <ActionButton
                        projectId={projectId}
                        isConnected={isConnected}
                        authStatus={authStatus}
                        provider={isConnected ? resolvedConnection.provider || selectedProvider : selectedProvider}
                        closePopover={closePopover}
                        setAuthStatus={setAuthStatus}
                    />
                    {(resolvedConnection.provider || selectedProvider) === PROVIDER_GOOGLE && (
                        <GmailLabelingSettings
                            projectId={projectId}
                            isConnected={isConnected}
                            authStatus={authStatus}
                            onUnsavedChangesChange={setHasUnsavedChanges}
                            onRegisterCloseHandlers={handlers => {
                                closeHandlersRef.current = handlers || {}
                            }}
                        />
                    )}
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
        flexWrap: 'wrap',
        alignItems: 'center',
    },
    providerRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        marginBottom: 16,
    },
})
