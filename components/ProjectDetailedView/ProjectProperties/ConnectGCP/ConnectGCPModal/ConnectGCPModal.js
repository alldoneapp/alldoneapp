import React, { useEffect, useState } from 'react'
import { Dimensions, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { useSelector } from 'react-redux'

import Button from '../../../../UIControls/Button'
import styles, { colors } from '../../../../styles/global'
import { CONNECT_GCP_MODAL_ID, removeModal, storeModal } from '../../../../ModalsManager/modalsManager'
import { translate } from '../../../../../i18n/TranslationService'
import ModalHeader from '../../../../UIComponents/FloatModals/ModalHeader'
import { connectGcpProject, disconnectGcpProject, getGcpConnection } from '../../../../../utils/backends/firestore'

const MODAL_HORIZONTAL_MARGIN = 32
const MOBILE_MODAL_HORIZONTAL_MARGIN = 12
const MODAL_VERTICAL_MARGIN = 16
const MODAL_PADDING = 16
const MAX_MODAL_WIDTH = 520

// Human labels for the machine capability keys stored on the connection.
const CAP_LABELS = {
    'firestore.read': 'Firestore',
    'logging.read': 'Cloud Logging',
}
function formatCapabilities(capabilities) {
    return (capabilities || []).map(c => CAP_LABELS[c] || c).join(', ')
}

export default function ConnectGCPModal({ project, closePopover, onConnectionChange }) {
    const projectId = project.id
    const userId = useSelector(state => state.loggedUser.uid)
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)
    const [windowDimensions, setWindowDimensions] = useState(Dimensions.get('window'))

    const [gcpProjectId, setGcpProjectId] = useState('')
    const [keyJson, setKeyJson] = useState('')
    const [connection, setConnection] = useState(null)
    const [processing, setProcessing] = useState(false)
    const [error, setError] = useState('')
    const [success, setSuccess] = useState('')

    const { width: windowWidth, height: windowHeight } = windowDimensions
    const horizontalMargin = smallScreenNavigation ? MOBILE_MODAL_HORIZONTAL_MARGIN : MODAL_HORIZONTAL_MARGIN
    const containerWidth = Math.min(Math.max(windowWidth - horizontalMargin * 2, 0), MAX_MODAL_WIDTH)
    const containerMaxHeight = Math.max(windowHeight - MODAL_VERTICAL_MARGIN * 2, 0)
    const scrollMaxHeight = Math.max(containerMaxHeight - MODAL_PADDING * 2, 0)

    useEffect(() => {
        storeModal(CONNECT_GCP_MODAL_ID)
        return () => removeModal(CONNECT_GCP_MODAL_ID)
    }, [])

    useEffect(() => {
        let mounted = true
        getGcpConnection(projectId, userId).then(c => {
            if (mounted) setConnection(c)
        })
        return () => {
            mounted = false
        }
    }, [projectId, userId])

    useEffect(() => {
        const updateDimensions = ({ window }) => setWindowDimensions(window)
        Dimensions.addEventListener('change', updateDimensions)
        return () => Dimensions.removeEventListener('change', updateDimensions)
    }, [])

    const onConnect = async () => {
        setError('')
        setSuccess('')
        if (!keyJson.trim()) return setError(translate('Please paste a service account key JSON.'))
        setProcessing(true)
        try {
            const result = await connectGcpProject({
                projectId,
                serviceAccountKey: keyJson.trim(),
                gcpProjectId: gcpProjectId.trim(),
            })
            setKeyJson('')
            setConnection({
                connected: true,
                gcpProjectId: result.gcpProjectId,
                clientEmail: result.clientEmail,
                capabilities: result.capabilities || [],
            })
            setSuccess(translate('Google Cloud project connected.'))
            if (onConnectionChange) onConnectionChange({ connected: true })
        } catch (e) {
            setError((e && e.message) || translate('Could not connect the Google Cloud project.'))
        } finally {
            setProcessing(false)
        }
    }

    const onDisconnect = async () => {
        setError('')
        setSuccess('')
        setProcessing(true)
        try {
            await disconnectGcpProject({ projectId })
            setConnection(null)
            setKeyJson('')
            setSuccess(translate('Your Google Cloud key was removed from this project.'))
            if (onConnectionChange) onConnectionChange({ connected: false })
        } catch (e) {
            setError((e && e.message) || translate('Could not disconnect Google Cloud.'))
        } finally {
            setProcessing(false)
        }
    }

    const isConnected = connection && connection.connected

    return (
        <View style={[localStyles.container, { width: containerWidth, maxHeight: containerMaxHeight }]}>
            <ScrollView
                style={[localStyles.scroll, { maxHeight: scrollMaxHeight }]}
                contentContainerStyle={localStyles.scrollContent}
                showsVerticalScrollIndicator={false}
            >
                <ModalHeader
                    closeModal={closePopover}
                    title={translate('Google Cloud project')}
                    description={translate('Google Cloud project description')}
                />

                {isConnected ? (
                    <View style={localStyles.statusCard}>
                        <Text style={localStyles.statusText}>
                            {translate('Connected to GCP project', { project: connection.gcpProjectId || '—' })}
                        </Text>
                        {!!connection.clientEmail && (
                            <Text style={localStyles.statusSubText}>{connection.clientEmail}</Text>
                        )}
                        {!!(connection.capabilities && connection.capabilities.length) && (
                            <Text style={localStyles.statusSubText}>
                                {translate('Read access', { caps: formatCapabilities(connection.capabilities) })}
                            </Text>
                        )}
                    </View>
                ) : null}

                <Text style={localStyles.label}>{translate('Google Cloud project ID (optional)')}</Text>
                <TextInput
                    style={localStyles.input}
                    value={gcpProjectId}
                    onChangeText={setGcpProjectId}
                    placeholder={translate('Defaults to the project in the key')}
                    placeholderTextColor={colors.Text03}
                    autoCapitalize={'none'}
                    autoCorrect={false}
                    editable={!processing}
                />

                <Text style={localStyles.label}>{translate('Service account key (JSON)')}</Text>
                <TextInput
                    style={[localStyles.input, localStyles.jsonInput]}
                    value={keyJson}
                    onChangeText={setKeyJson}
                    placeholder={
                        isConnected ? translate('Paste a new key to replace') : '{ "type": "service_account", … }'
                    }
                    placeholderTextColor={colors.Text03}
                    autoCapitalize={'none'}
                    autoCorrect={false}
                    multiline={true}
                    editable={!processing}
                />
                <Text style={localStyles.help}>
                    {translate(
                        'Paste a read-only service account key. Give it Viewer, or datastore.viewer + logging.viewer. The VM only ever receives a short-lived, read-only token minted from this key — never the key itself.'
                    )}
                </Text>

                {!!error && <Text style={localStyles.errorText}>{error}</Text>}
                {!!success && <Text style={localStyles.successText}>{success}</Text>}

                <View style={localStyles.buttonRow}>
                    <Button
                        title={translate(isConnected ? 'Update connection' : 'Connect')}
                        onPress={onConnect}
                        processing={processing}
                        processingTitle={translate('Connecting')}
                        buttonStyle={{ marginRight: 12 }}
                    />
                    {isConnected && (
                        <Button
                            title={translate('Disconnect')}
                            type={'ghost'}
                            iconColor={colors.UtilityRed200}
                            titleStyle={{ color: colors.UtilityRed200 }}
                            buttonStyle={{ borderColor: colors.UtilityRed200, borderWidth: 2 }}
                            onPress={onDisconnect}
                            disabled={processing}
                        />
                    )}
                </View>
            </ScrollView>
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
    statusCard: {
        backgroundColor: colors.Secondary300,
        borderRadius: 4,
        padding: 12,
        marginBottom: 12,
    },
    statusText: {
        ...styles.body2,
        color: '#ffffff',
    },
    statusSubText: {
        ...styles.caption1,
        color: colors.Text03,
        marginTop: 4,
    },
    label: {
        ...styles.subtitle2,
        color: colors.Text03,
        marginTop: 12,
        marginBottom: 6,
    },
    input: {
        ...styles.body1,
        color: '#ffffff',
        backgroundColor: colors.Secondary300,
        borderRadius: 4,
        borderWidth: 1,
        borderColor: colors.Secondary300,
        paddingHorizontal: 12,
        paddingVertical: 10,
    },
    jsonInput: {
        minHeight: 120,
        textAlignVertical: 'top',
        ...styles.caption1,
        color: '#ffffff',
    },
    help: {
        ...styles.caption1,
        color: colors.Text03,
        marginTop: 6,
    },
    buttonRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        alignItems: 'center',
        marginTop: 20,
    },
    errorText: {
        ...styles.body2,
        color: colors.UtilityRed200,
        marginTop: 12,
    },
    successText: {
        ...styles.body2,
        color: colors.UtilityBlue200,
        marginTop: 12,
    },
})
