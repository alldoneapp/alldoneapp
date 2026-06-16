import React, { useEffect, useMemo, useState } from 'react'
import { Dimensions, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native'
import { useSelector } from 'react-redux'

import styles, { colors } from '../../../styles/global'
import { ASSISTANT_MCP_SERVERS_MODAL_ID, removeModal, storeModal } from '../../../ModalsManager/modalsManager'
import { translate } from '../../../../i18n/TranslationService'
import ModalHeader from '../ModalHeader'
import CustomScrollView from '../../../UIControls/CustomScrollView'
import Button from '../../../UIControls/Button'
import Switch from '../../../UIControls/Switch'
import Icon from '../../../Icon'
import { connectAssistantMcpServer, disconnectAssistantMcpServer } from '../../../../utils/backends/firestore'
import { updateAssistant } from '../../../../utils/backends/Assistants/assistantsFirestore'
import { startMcpOAuthFlow } from '../../../../utils/Mcp/mcpOAuth'

const MCP_SERVERS_TOOL_KEY = 'mcp_servers'
const MODAL_HORIZONTAL_MARGIN = 32
const MODAL_VERTICAL_MARGIN = 16
const MAX_MODAL_WIDTH = 560

const TRANSPORTS = [
    { key: 'http', label: 'Streamable HTTP' },
    { key: 'sse', label: 'SSE' },
]
const AUTH_TYPES = [
    { key: 'none', label: 'No auth' },
    { key: 'bearer', label: 'Bearer token' },
    { key: 'oauth', label: 'OAuth' },
]

// Segmented selector rendered as a row of chips (avoids native Picker, which is
// unreliable on RN-web in this codebase).
function ChipSelector({ options, value, onChange, disabled }) {
    return (
        <View style={localStyles.chipRow}>
            {options.map(opt => {
                const selected = opt.key === value
                return (
                    <TouchableOpacity
                        key={opt.key}
                        style={[localStyles.chip, selected && localStyles.chipSelected]}
                        onPress={() => !disabled && onChange(opt.key)}
                        disabled={disabled}
                    >
                        <Text style={[localStyles.chipText, selected && localStyles.chipTextSelected]}>
                            {translate(opt.label)}
                        </Text>
                    </TouchableOpacity>
                )
            })}
        </View>
    )
}

export default function AssistantMcpServersModal({ projectId, assistant, closeModal }) {
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)
    const [windowDimensions, setWindowDimensions] = useState(Dimensions.get('window'))

    const servers = useMemo(() => (Array.isArray(assistant.mcpServers) ? assistant.mcpServers : []), [
        assistant.mcpServers,
    ])

    // New-server form state.
    const [label, setLabel] = useState('')
    const [url, setUrl] = useState('')
    const [transport, setTransport] = useState('http')
    const [authType, setAuthType] = useState('none')
    const [token, setToken] = useState('')
    const [oauthClientId, setOauthClientId] = useState('')
    const [oauthClientSecret, setOauthClientSecret] = useState('')
    const [oauthScope, setOauthScope] = useState('')
    const [oauthTokens, setOauthTokens] = useState(null)
    const [processing, setProcessing] = useState(false)
    const [error, setError] = useState('')
    const [success, setSuccess] = useState('')

    const { width: windowWidth, height: windowHeight } = windowDimensions
    const containerWidth = Math.min(
        Math.max(windowWidth - MODAL_HORIZONTAL_MARGIN * 2, 0),
        smallScreenNavigation ? windowWidth : MAX_MODAL_WIDTH
    )
    const containerMaxHeight = Math.max(windowHeight - MODAL_VERTICAL_MARGIN * 2, 0)

    useEffect(() => {
        storeModal(ASSISTANT_MCP_SERVERS_MODAL_ID)
        return () => removeModal(ASSISTANT_MCP_SERVERS_MODAL_ID)
    }, [])

    useEffect(() => {
        const updateDimensions = ({ window }) => setWindowDimensions(window)
        Dimensions.addEventListener('change', updateDimensions)
        return () => Dimensions.removeEventListener('change', updateDimensions)
    }, [])

    const resetForm = () => {
        setLabel('')
        setUrl('')
        setTransport('http')
        setAuthType('none')
        setToken('')
        setOauthClientId('')
        setOauthClientSecret('')
        setOauthScope('')
        setOauthTokens(null)
    }

    // Ensure the `mcp_servers` tool is enabled in allowedTools once a server exists.
    const ensureToolEnabled = () => {
        const allowed = Array.isArray(assistant.allowedTools) ? assistant.allowedTools : []
        if (allowed.includes(MCP_SERVERS_TOOL_KEY)) return
        updateAssistant(projectId, { ...assistant, allowedTools: [...allowed, MCP_SERVERS_TOOL_KEY] }, assistant)
    }

    const buildSecret = () => {
        if (authType === 'bearer') return { token: token.trim() }
        if (authType === 'oauth') return oauthTokens || {}
        return null
    }

    const onAuthorizeOAuth = async () => {
        setError('')
        if (!url.trim()) return setError(translate('Please enter the MCP server URL.'))
        setProcessing(true)
        try {
            const tokens = await startMcpOAuthFlow({
                serverUrl: url.trim(),
                clientId: oauthClientId.trim(),
                clientSecret: oauthClientSecret.trim(),
                scope: oauthScope.trim(),
            })
            setOauthTokens(tokens)
            setSuccess(translate('Authorized. You can now connect the server.'))
        } catch (e) {
            setError((e && e.message) || translate('OAuth authorization failed.'))
        } finally {
            setProcessing(false)
        }
    }

    const onConnect = async () => {
        setError('')
        setSuccess('')
        if (!label.trim()) return setError(translate('Please enter a name for the server.'))
        if (!url.trim()) return setError(translate('Please enter the MCP server URL.'))
        if (authType === 'bearer' && !token.trim()) return setError(translate('Please paste a token.'))
        if (authType === 'oauth' && !oauthTokens)
            return setError(translate('Please authorize with OAuth before connecting.'))

        setProcessing(true)
        try {
            const result = await connectAssistantMcpServer({
                projectId,
                assistantId: assistant.uid,
                server: { label: label.trim(), url: url.trim(), transport, authType },
                secret: buildSecret(),
            })
            ensureToolEnabled()
            resetForm()
            setSuccess(translate('Connected with N tools', { count: result.toolCount }))
        } catch (e) {
            setError((e && e.message) || translate('Could not connect the MCP server.'))
        } finally {
            setProcessing(false)
        }
    }

    const onToggleEnabled = server => {
        const next = servers.map(s => (s.id === server.id ? { ...s, enabled: !(s.enabled !== false) } : s))
        updateAssistant(projectId, { ...assistant, mcpServers: next }, assistant)
    }

    const onRemove = async server => {
        setError('')
        setSuccess('')
        setProcessing(true)
        try {
            await disconnectAssistantMcpServer({ projectId, assistantId: assistant.uid, serverId: server.id })
            setSuccess(translate('Server removed.'))
        } catch (e) {
            setError((e && e.message) || translate('Could not remove the server.'))
        } finally {
            setProcessing(false)
        }
    }

    return (
        <View style={[localStyles.container, { width: containerWidth, maxHeight: containerMaxHeight }]}>
            <ModalHeader
                closeModal={closeModal}
                title={translate('MCP servers')}
                description={translate('MCP servers description')}
            />
            <CustomScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: containerMaxHeight - 120 }}>
                {/* Existing servers */}
                {servers.length === 0 ? (
                    <Text style={localStyles.emptyText}>{translate('No MCP servers connected yet.')}</Text>
                ) : (
                    servers.map(server => (
                        <View key={server.id} style={localStyles.serverCard}>
                            <View style={localStyles.serverHeaderRow}>
                                <View style={{ flexShrink: 1 }}>
                                    <Text style={localStyles.serverLabel} numberOfLines={1}>
                                        {server.label}
                                    </Text>
                                    <Text style={localStyles.serverUrl} numberOfLines={1}>
                                        {server.url}
                                    </Text>
                                </View>
                                <TouchableOpacity onPress={() => onRemove(server)} disabled={processing}>
                                    <Icon name="trash-2" size={20} color={colors.UtilityRed200} />
                                </TouchableOpacity>
                            </View>
                            <View style={localStyles.serverMetaRow}>
                                <Text style={localStyles.serverMeta}>
                                    {translate(server.transport === 'sse' ? 'SSE' : 'Streamable HTTP')}
                                    {' · '}
                                    {server.authType === 'none'
                                        ? translate('No auth')
                                        : `${server.authType === 'oauth' ? 'OAuth' : translate('Bearer token')}${
                                              server.tokenLast4 ? ` ••••${server.tokenLast4}` : ''
                                          }`}
                                    {typeof server.toolCount === 'number'
                                        ? ` · ${translate('N tools', { count: server.toolCount })}`
                                        : ''}
                                </Text>
                                <View style={{ marginLeft: 'auto' }}>
                                    <Switch
                                        active={server.enabled !== false}
                                        activeSwitch={() => onToggleEnabled(server)}
                                        deactiveSwitch={() => onToggleEnabled(server)}
                                        disabled={processing}
                                    />
                                </View>
                            </View>
                        </View>
                    ))
                )}

                {/* Add new server */}
                <Text style={localStyles.sectionTitle}>{translate('Add MCP server')}</Text>

                <Text style={localStyles.label}>{translate('Name')}</Text>
                <TextInput
                    style={localStyles.input}
                    value={label}
                    onChangeText={setLabel}
                    placeholder={translate('e.g. Notion, Linear')}
                    placeholderTextColor={colors.Text03}
                    editable={!processing}
                />

                <Text style={localStyles.label}>{translate('Server URL')}</Text>
                <TextInput
                    style={localStyles.input}
                    value={url}
                    onChangeText={setUrl}
                    placeholder={'https://mcp.example.com/mcp'}
                    placeholderTextColor={colors.Text03}
                    autoCapitalize={'none'}
                    autoCorrect={false}
                    editable={!processing}
                />

                <Text style={localStyles.label}>{translate('Transport')}</Text>
                <ChipSelector options={TRANSPORTS} value={transport} onChange={setTransport} disabled={processing} />

                <Text style={localStyles.label}>{translate('Authentication')}</Text>
                <ChipSelector
                    options={AUTH_TYPES}
                    value={authType}
                    onChange={key => {
                        setAuthType(key)
                        setToken('')
                        setOauthClientId('')
                        setOauthClientSecret('')
                        setOauthScope('')
                        setOauthTokens(null)
                    }}
                    disabled={processing}
                />

                {authType === 'bearer' && (
                    <>
                        <Text style={localStyles.label}>{translate('Token')}</Text>
                        <TextInput
                            style={localStyles.input}
                            value={token}
                            onChangeText={setToken}
                            placeholder={translate('Paste the API / bearer token')}
                            placeholderTextColor={colors.Text03}
                            autoCapitalize={'none'}
                            autoCorrect={false}
                            secureTextEntry={true}
                            editable={!processing}
                        />
                    </>
                )}

                {authType === 'oauth' && (
                    <>
                        <Text style={localStyles.label}>{translate('Client ID (optional)')}</Text>
                        <TextInput
                            style={localStyles.input}
                            value={oauthClientId}
                            onChangeText={text => {
                                setOauthClientId(text)
                                setOauthTokens(null)
                            }}
                            placeholder={translate('Leave blank to auto-register')}
                            placeholderTextColor={colors.Text03}
                            autoCapitalize={'none'}
                            autoCorrect={false}
                            editable={!processing}
                        />

                        <Text style={localStyles.label}>{translate('Client secret (optional)')}</Text>
                        <TextInput
                            style={localStyles.input}
                            value={oauthClientSecret}
                            onChangeText={text => {
                                setOauthClientSecret(text)
                                setOauthTokens(null)
                            }}
                            placeholder={translate('Only for confidential clients')}
                            placeholderTextColor={colors.Text03}
                            autoCapitalize={'none'}
                            autoCorrect={false}
                            secureTextEntry={true}
                            editable={!processing}
                        />

                        <Text style={localStyles.label}>{translate('Scope (optional)')}</Text>
                        <TextInput
                            style={localStyles.input}
                            value={oauthScope}
                            onChangeText={text => {
                                setOauthScope(text)
                                setOauthTokens(null)
                            }}
                            placeholder={translate('e.g. read write')}
                            placeholderTextColor={colors.Text03}
                            autoCapitalize={'none'}
                            autoCorrect={false}
                            editable={!processing}
                        />
                        <Text style={localStyles.help}>
                            {translate(
                                'Leave Client ID blank to register automatically. If the server requires a pre-registered app, paste its Client ID (and secret, if confidential).'
                            )}
                        </Text>

                        <View style={localStyles.oauthRow}>
                            <Button
                                title={translate(oauthTokens ? 'Re-authorize' : 'Authorize with OAuth')}
                                type={'ghost'}
                                onPress={onAuthorizeOAuth}
                                disabled={processing}
                            />
                            {oauthTokens ? <Text style={localStyles.oauthOk}>{translate('Authorized')}</Text> : null}
                        </View>
                    </>
                )}

                {!!error && <Text style={localStyles.errorText}>{error}</Text>}
                {!!success && <Text style={localStyles.successText}>{success}</Text>}

                <View style={localStyles.buttonRow}>
                    <Button
                        title={translate('Connect')}
                        onPress={onConnect}
                        processing={processing}
                        processingTitle={translate('Connecting')}
                    />
                </View>
            </CustomScrollView>
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
    emptyText: {
        ...styles.body2,
        color: colors.Text03,
        marginBottom: 8,
    },
    serverCard: {
        backgroundColor: colors.Secondary300,
        borderRadius: 4,
        padding: 12,
        marginBottom: 8,
    },
    serverHeaderRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    serverLabel: {
        ...styles.subtitle1,
        color: '#ffffff',
    },
    serverUrl: {
        ...styles.caption1,
        color: colors.Text03,
    },
    serverMetaRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginTop: 8,
    },
    serverMeta: {
        ...styles.caption1,
        color: colors.Text03,
        flexShrink: 1,
    },
    sectionTitle: {
        ...styles.subtitle1,
        color: '#ffffff',
        marginTop: 16,
        marginBottom: 4,
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
    chipRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
    },
    chip: {
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: colors.Grey400,
        marginRight: 8,
        marginBottom: 4,
    },
    chipSelected: {
        backgroundColor: colors.Primary200,
        borderColor: colors.Primary200,
    },
    chipText: {
        ...styles.body2,
        color: colors.Text03,
    },
    chipTextSelected: {
        color: '#ffffff',
    },
    help: {
        ...styles.caption1,
        color: colors.Text03,
        marginTop: 6,
    },
    oauthRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginTop: 12,
    },
    oauthOk: {
        ...styles.body2,
        color: colors.UtilityBlue200,
        marginLeft: 12,
    },
    buttonRow: {
        flexDirection: 'row',
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
