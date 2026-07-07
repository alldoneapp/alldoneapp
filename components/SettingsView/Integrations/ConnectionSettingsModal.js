import React, { useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Dimensions, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useSelector } from 'react-redux'

import Button from '../../UIControls/Button'
import styles, { colors } from '../../styles/global'
import { translate } from '../../../i18n/TranslationService'
import ModalHeader from '../../UIComponents/FloatModals/ModalHeader'
import { CONNECTION_SERVICE_CALENDAR, getProviderLabel } from '../../../utils/IntegrationProviders'
import GmailLabelingSettings from '../../ProjectDetailedView/ProjectProperties/ConnectGmail/ConnectGmailModal/GmailLabelingSettings'
import CalendarProjectRoutingSettings from '../../ProjectDetailedView/ProjectProperties/ConnectCalendar/ConnectCalendarModal/CalendarProjectRoutingSettings'

const MODAL_HORIZONTAL_MARGIN = 32
const MOBILE_MODAL_HORIZONTAL_MARGIN = 12
const MODAL_VERTICAL_MARGIN = 16
const MODAL_PADDING = 16
const MAX_MODAL_WIDTH = 760

// The dark settings popup for one connected account in Settings > Integrations.
// Mirrors ConnectGmailModal's container: dark Secondary400 background, viewport-capped
// size, internal scrolling, and an unsaved-changes confirmation for Gmail labeling.
export default function ConnectionSettingsModal({ service, connection, authStatus, closePopover }) {
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)
    const [windowDimensions, setWindowDimensions] = useState(Dimensions.get('window'))
    const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)
    const [showCloseConfirmation, setShowCloseConfirmation] = useState(false)
    const [closingAfterSave, setClosingAfterSave] = useState(false)
    const closeHandlersRef = useRef({})

    const isCalendar = service === CONNECTION_SERVICE_CALENDAR
    const { width: windowWidth, height: windowHeight } = windowDimensions
    const horizontalMargin = smallScreenNavigation ? MOBILE_MODAL_HORIZONTAL_MARGIN : MODAL_HORIZONTAL_MARGIN
    const availableWidth = Math.max(windowWidth - horizontalMargin * 2, 0)
    const containerWidth = Math.min(availableWidth, MAX_MODAL_WIDTH)
    const containerMaxHeight = Math.max(windowHeight - MODAL_VERTICAL_MARGIN * 2, 0)
    const scrollMaxHeight = Math.max(containerMaxHeight - MODAL_PADDING * 2, 0)

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

    return (
        <View style={[localStyles.container, { width: containerWidth, maxHeight: containerMaxHeight }]}>
            <ScrollView
                style={[localStyles.scroll, { maxHeight: scrollMaxHeight }]}
                contentContainerStyle={localStyles.scrollContent}
                showsVerticalScrollIndicator={false}
            >
                <ModalHeader
                    closeModal={onRequestClose}
                    title={connection.email}
                    description={getProviderLabel(connection.provider)}
                    hideCloseButton={showCloseConfirmation}
                />
                {showCloseConfirmation ? (
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
                                onPress={closePopover}
                                disabled={closingAfterSave}
                            />
                        </View>
                    </View>
                ) : authStatus === null ? (
                    <View style={localStyles.loadingArea}>
                        <ActivityIndicator size="small" color={colors.Primary100} />
                    </View>
                ) : isCalendar ? (
                    <CalendarProjectRoutingSettings
                        projectId={connection.connectionId}
                        isConnected={true}
                        isSignedIn={!!authStatus?.hasCredentials}
                        connectionEmail={connection.email}
                    />
                ) : (
                    <GmailLabelingSettings
                        projectId={connection.connectionId}
                        isConnected={true}
                        authStatus={authStatus}
                        onUnsavedChangesChange={setHasUnsavedChanges}
                        onRegisterCloseHandlers={handlers => {
                            closeHandlersRef.current = handlers || {}
                        }}
                    />
                )}
            </ScrollView>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        backgroundColor: colors.Secondary400,
        padding: MODAL_PADDING,
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
    loadingArea: {
        paddingVertical: 24,
        alignItems: 'center',
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
})
