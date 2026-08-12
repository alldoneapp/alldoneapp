import React, { useEffect, useState } from 'react'
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { useSelector } from 'react-redux'

import Button from '../../../UIControls/Button'
import styles, { colors } from '../../../styles/global'
import { removeModal, storeModal } from '../../../ModalsManager/modalsManager'
import { translate } from '../../../../i18n/TranslationService'
import ModalHeader from '../../../UIComponents/FloatModals/ModalHeader'
import useModalSizing from '../../../../hooks/useModalSizing'

const MODAL_HORIZONTAL_MARGIN = 32
const MOBILE_MODAL_HORIZONTAL_MARGIN = 12
const MODAL_VERTICAL_MARGIN = 16
const MODAL_PADDING = 16
const MAX_MODAL_WIDTH = 520

/**
 * The shared connect-a-repository dialog (formerly two near-identical copies
 * for GitHub and GitLab). Everything provider-specific arrives through the
 * `provider` config: strings/translation keys, the project doc field names,
 * and the three backend callables. GCP stays separate on purpose — its flow
 * (service-account JSON + capability probing) is structurally different.
 */
export default function ConnectRepoModal({ project, closePopover, onConnectionChange, provider }) {
    const projectId = project.id
    const userId = useSelector(state => state.loggedUser.uid)
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)
    const { windowWidth, windowHeight } = useModalSizing()

    const [repoUrl, setRepoUrl] = useState(project[provider.repoUrlField] || '')
    const [baseBranch, setBaseBranch] = useState(project[provider.baseBranchField] || '')
    const [token, setToken] = useState('')
    const [connection, setConnection] = useState(null)
    const [processing, setProcessing] = useState(false)
    const [error, setError] = useState('')
    const [success, setSuccess] = useState('')

    const horizontalMargin = smallScreenNavigation ? MOBILE_MODAL_HORIZONTAL_MARGIN : MODAL_HORIZONTAL_MARGIN
    const containerWidth = Math.min(Math.max(windowWidth - horizontalMargin * 2, 0), MAX_MODAL_WIDTH)
    const containerMaxHeight = Math.max(windowHeight - MODAL_VERTICAL_MARGIN * 2, 0)
    const scrollMaxHeight = Math.max(containerMaxHeight - MODAL_PADDING * 2, 0)

    useEffect(() => {
        storeModal(provider.modalId)
        return () => removeModal(provider.modalId)
    }, [])

    useEffect(() => {
        let mounted = true
        provider.getConnection(projectId, userId).then(c => {
            if (mounted) setConnection(c)
        })
        return () => {
            mounted = false
        }
    }, [projectId, userId])

    const onConnect = async () => {
        setError('')
        setSuccess('')
        if (!repoUrl.trim()) return setError(translate(provider.missingUrlKey))
        if (!token.trim()) return setError(translate(provider.missingTokenKey))
        setProcessing(true)
        try {
            const result = await provider.connect({
                projectId,
                token: token.trim(),
                repoUrl: repoUrl.trim(),
                baseBranch: baseBranch.trim(),
            })
            setToken('')
            setConnection({ connected: true, username: result.username, canPush: result.canPush })
            setBaseBranch(result.defaultBranch || baseBranch)
            setSuccess(result.warning || translate(provider.connectedKey))
            if (onConnectionChange) onConnectionChange({ connected: true, repoUrl: repoUrl.trim() })
        } catch (e) {
            setError((e && e.message) || translate(provider.connectFailedKey))
        } finally {
            setProcessing(false)
        }
    }

    const onDisconnect = async () => {
        setError('')
        setSuccess('')
        setProcessing(true)
        try {
            await provider.disconnect({ projectId })
            setConnection(null)
            setToken('')
            setSuccess(translate(provider.disconnectedKey))
            if (onConnectionChange) onConnectionChange({ connected: false })
        } catch (e) {
            setError((e && e.message) || translate(provider.disconnectFailedKey))
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
                    title={translate(provider.titleKey)}
                    description={translate(provider.descriptionKey)}
                />

                {isConnected ? (
                    <View style={localStyles.statusCard}>
                        <Text style={localStyles.statusText}>
                            {translate('Connected as @username', { username: connection.username || '—' })}
                        </Text>
                        {connection.canPush === false && (
                            <Text style={localStyles.warningText}>{translate(provider.readOnlyWarningKey)}</Text>
                        )}
                    </View>
                ) : null}

                <Text style={localStyles.label}>{translate('Repository URL')}</Text>
                <TextInput
                    style={localStyles.input}
                    value={repoUrl}
                    onChangeText={setRepoUrl}
                    placeholder={provider.repoUrlPlaceholder}
                    placeholderTextColor={colors.Text03}
                    autoCapitalize={'none'}
                    autoCorrect={false}
                    editable={!processing}
                />

                <Text style={localStyles.label}>{translate('Access token')}</Text>
                <TextInput
                    style={localStyles.input}
                    value={token}
                    onChangeText={setToken}
                    placeholder={isConnected ? translate('Paste a new token to replace') : provider.tokenPlaceholder}
                    placeholderTextColor={colors.Text03}
                    autoCapitalize={'none'}
                    autoCorrect={false}
                    secureTextEntry={true}
                    editable={!processing}
                />
                <Text style={localStyles.help}>{translate(provider.tokenHelpKey)}</Text>

                <Text style={localStyles.label}>{translate('Base branch (optional)')}</Text>
                <TextInput
                    style={localStyles.input}
                    value={baseBranch}
                    onChangeText={setBaseBranch}
                    placeholder={translate('Defaults to the repository default branch')}
                    placeholderTextColor={colors.Text03}
                    autoCapitalize={'none'}
                    autoCorrect={false}
                    editable={!processing}
                />

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
        boxShadow: '0px 4px 16px rgba(78,93,120,0.56)',
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
    warningText: {
        ...styles.caption1,
        color: colors.UtilityRed200,
        marginTop: 6,
    },
})
