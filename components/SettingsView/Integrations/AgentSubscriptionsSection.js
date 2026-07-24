import React, { useEffect, useState } from 'react'
import { ActivityIndicator, StyleSheet, Text, TextInput, View } from 'react-native'

import Button from '../../UIControls/Button'
import styles, { colors } from '../../styles/global'
import { translate } from '../../../i18n/TranslationService'
import {
    connectVmSubscription,
    disconnectVmSubscription,
    getVmSubscriptionStatus,
    removeVmApiKey,
    saveVmApiKey,
    setVmCredentialMode,
    testVmApiKey,
} from '../../../utils/backends/firestore'

const PROVIDERS = {
    claude: {
        label: 'Claude',
        apiLabel: 'Anthropic',
        apiKeyPlaceholder: 'Paste your Anthropic API key',
        placeholder: 'Paste the token printed by claude setup-token',
        steps: [
            'Install or update Claude Code on your computer.',
            'Open a terminal and run: claude setup-token',
            'Sign in with the Claude account that has your Pro, Max, Team, or Enterprise subscription.',
            'Copy the complete token printed in the terminal and paste it below.',
        ],
    },
    codex: {
        label: 'Codex',
        apiLabel: 'OpenAI',
        apiKeyPlaceholder: 'Paste your OpenAI API key',
        placeholder: 'Paste the complete contents of ~/.codex/auth.json',
        steps: [
            'Install or update the Codex CLI on your computer.',
            'Add cli_auth_credentials_store = "file" to ~/.codex/config.toml.',
            'Run codex login and sign in with the ChatGPT account that has your Codex subscription.',
            'Open ~/.codex/auth.json, copy the complete JSON, and paste it below.',
        ],
    },
}

export function ProviderAuthCard({ provider, connection, onChanged }) {
    const config = PROVIDERS[provider]
    const [credential, setCredential] = useState('')
    const [apiKey, setApiKey] = useState('')
    const [processing, setProcessing] = useState(false)
    const [error, setError] = useState('')
    const [success, setSuccess] = useState('')
    const subscriptionConnected = !!connection?.connected
    const apiKeyConnected = !!connection?.apiKey?.connected
    const activeMode = connection?.activeMode || (subscriptionConnected ? 'subscription' : 'api')

    const runAction = async action => {
        setError('')
        setSuccess('')
        setProcessing(true)
        try {
            await action()
            await onChanged()
        } catch (e) {
            setError(e?.message || translate('Could not update the provider connection.'))
        } finally {
            setProcessing(false)
        }
    }

    const connect = async () => {
        if (!credential.trim()) {
            setError(translate('Paste the requested credential before connecting.'))
            return
        }
        await runAction(async () => {
            await connectVmSubscription({ provider, credential: credential.trim() })
            setCredential('')
            setSuccess(translate('Subscription connected. Future VM token usage will not cost Gold.'))
        })
    }

    const disconnect = async () => {
        await runAction(async () => {
            await disconnectVmSubscription({ provider })
            setCredential('')
            setSuccess(translate('Subscription disconnected. VM jobs will use Alldone API billing.'))
        })
    }

    const saveApiKey = async () => {
        if (!apiKey.trim()) {
            setError(translate('Paste an API key before saving.'))
            return
        }
        await runAction(async () => {
            await saveVmApiKey({ provider, apiKey: apiKey.trim() })
            setApiKey('')
            setSuccess(translate('API key validated and saved. BYOK is now active for this provider.'))
        })
    }

    const testApiKey = async () => {
        await runAction(async () => {
            await testVmApiKey({ provider })
            setSuccess(translate('API key is valid.'))
        })
    }

    const removeApiKey = async () => {
        await runAction(async () => {
            await removeVmApiKey({ provider })
            setApiKey('')
            setSuccess(
                translate(
                    subscriptionConnected
                        ? 'API key removed. Your subscription is now active.'
                        : 'API key removed. Alldone API billing is now active.'
                )
            )
        })
    }

    const selectMode = async mode => {
        if (mode === activeMode) return
        await runAction(async () => {
            await setVmCredentialMode({ provider, mode })
            setSuccess(translate('Provider routing updated.'))
        })
    }

    return (
        <View style={localStyles.card}>
            <View style={localStyles.cardHeader}>
                <View>
                    <Text style={[styles.subtitle1, localStyles.cardTitle]}>{config.label}</Text>
                    <Text style={[styles.caption1, localStyles.connected]}>
                        {translate(
                            activeMode === 'byok'
                                ? 'Using your personal API key'
                                : activeMode === 'subscription'
                                ? 'Using your subscription'
                                : 'Using Alldone API billing'
                        )}
                    </Text>
                </View>
            </View>

            <Text style={[styles.body2, localStyles.explanation]}>
                {translate(
                    'Choose one route for this provider. BYOK bills model usage directly to your provider account; subscription auth uses your Claude or ChatGPT plan; Alldone API billing charges Gold for model tokens. The 20 Gold base charge and 10 Gold per started VM minute apply to every route.'
                )}
            </Text>

            <View style={localStyles.modeActions}>
                <Button
                    title={translate('Personal API key')}
                    type={activeMode === 'byok' ? 'primary' : 'ghost'}
                    onPress={() => selectMode('byok')}
                    disabled={processing || !apiKeyConnected}
                    buttonStyle={localStyles.modeAction}
                />
                <Button
                    title={translate('Subscription')}
                    type={activeMode === 'subscription' ? 'primary' : 'ghost'}
                    onPress={() => selectMode('subscription')}
                    disabled={processing || !subscriptionConnected}
                    buttonStyle={localStyles.modeAction}
                />
                <Button
                    title={translate('Alldone Gold')}
                    type={activeMode === 'api' ? 'primary' : 'ghost'}
                    onPress={() => selectMode('api')}
                    disabled={processing}
                    buttonStyle={localStyles.modeAction}
                />
            </View>

            <View style={localStyles.authSection}>
                <Text style={[styles.subtitle2, localStyles.authTitle]}>{translate('Personal API key')}</Text>
                <Text style={[styles.caption1, apiKeyConnected ? localStyles.connected : localStyles.notConnected]}>
                    {translate(
                        apiKeyConnected
                            ? connection?.apiKey?.validationStatus === 'invalid'
                                ? 'Saved key was rejected — replace or remove it'
                                : 'API key saved and validated'
                            : 'No API key saved'
                    )}
                </Text>
                <TextInput
                    style={localStyles.input}
                    value={apiKey}
                    onChangeText={setApiKey}
                    placeholder={translate(config.apiKeyPlaceholder)}
                    placeholderTextColor={colors.Text03}
                    autoCapitalize="none"
                    autoCorrect={false}
                    editable={!processing}
                    secureTextEntry
                />
                <Text style={[styles.caption1, localStyles.securityNote]}>
                    {translate(
                        'Your key is validated before saving, cannot be read back by the app, and stays behind Alldone’s server-side VM proxy. It is never added to chats, tasks, analytics, or the VM environment.'
                    )}
                </Text>
                <View style={localStyles.actions}>
                    <Button
                        title={translate(apiKeyConnected ? 'Validate and replace key' : 'Validate and save key')}
                        onPress={saveApiKey}
                        processing={processing}
                        processingTitle={translate('Validating')}
                        buttonStyle={localStyles.primaryAction}
                    />
                    {apiKeyConnected && (
                        <>
                            <Button
                                title={translate('Test saved key')}
                                type="ghost"
                                onPress={testApiKey}
                                disabled={processing}
                                buttonStyle={localStyles.secondaryAction}
                            />
                            <Button
                                title={translate('Remove key')}
                                type="ghost"
                                onPress={removeApiKey}
                                disabled={processing}
                            />
                        </>
                    )}
                </View>
            </View>

            <View style={localStyles.authSection}>
                <Text style={[styles.subtitle2, localStyles.authTitle]}>
                    {translate('Subscription authentication')}
                </Text>
                <Text
                    style={[styles.caption1, subscriptionConnected ? localStyles.connected : localStyles.notConnected]}
                >
                    {translate(subscriptionConnected ? 'Subscription connected' : 'Subscription not connected')}
                </Text>
                <View style={localStyles.steps}>
                    {config.steps.map((step, index) => (
                        <Text key={step} style={[styles.body2, localStyles.step]}>
                            {index + 1}. {translate(step)}
                        </Text>
                    ))}
                </View>

                <TextInput
                    style={[localStyles.input, provider === 'codex' && localStyles.jsonInput]}
                    value={credential}
                    onChangeText={setCredential}
                    placeholder={translate(config.placeholder)}
                    placeholderTextColor={colors.Text03}
                    autoCapitalize="none"
                    autoCorrect={false}
                    multiline={provider === 'codex'}
                    editable={!processing}
                    secureTextEntry={provider === 'claude'}
                />
                <View style={localStyles.actions}>
                    <Button
                        title={translate(subscriptionConnected ? 'Replace credential' : 'Connect subscription')}
                        onPress={connect}
                        processing={processing}
                        processingTitle={translate('Saving')}
                        buttonStyle={localStyles.primaryAction}
                    />
                    {subscriptionConnected && (
                        <Button
                            title={translate('Disconnect')}
                            type="ghost"
                            onPress={disconnect}
                            disabled={processing}
                        />
                    )}
                </View>
            </View>

            {!!error && <Text style={localStyles.error}>{error}</Text>}
            {!!success && <Text style={localStyles.success}>{success}</Text>}
        </View>
    )
}

export default function AgentSubscriptionsSection() {
    const [status, setStatus] = useState(null)
    const [error, setError] = useState('')

    const loadStatus = async () => {
        try {
            setStatus(await getVmSubscriptionStatus())
            setError('')
        } catch (e) {
            setError(e?.message || translate('Could not load subscription connections.'))
        }
    }

    useEffect(() => {
        loadStatus()
    }, [])

    return (
        <View style={localStyles.section}>
            <Text style={[styles.title6, localStyles.sectionTitle]}>{translate('AI agent authentication')}</Text>
            <Text style={[styles.body2, localStyles.sectionDescription]}>
                {translate(
                    'Choose how Claude and Codex VM jobs authenticate: your own API key, your subscription, or Alldone API billing via Gold.'
                )}
            </Text>
            {!status && !error ? (
                <ActivityIndicator size="small" color={colors.Primary100} />
            ) : (
                <>
                    {!!error && <Text style={localStyles.error}>{error}</Text>}
                    <ProviderAuthCard provider="claude" connection={status?.claude} onChanged={loadStatus} />
                    <ProviderAuthCard provider="codex" connection={status?.codex} onChanged={loadStatus} />
                </>
            )}
        </View>
    )
}

const localStyles = StyleSheet.create({
    section: {
        marginTop: 8,
        marginBottom: 32,
    },
    sectionTitle: {
        color: colors.Text01,
        marginBottom: 4,
    },
    sectionDescription: {
        color: colors.Text02,
        marginBottom: 12,
    },
    card: {
        borderWidth: 1,
        borderColor: colors.Grey300,
        borderRadius: 8,
        padding: 16,
        marginBottom: 12,
    },
    cardHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    cardTitle: {
        color: colors.Text01,
    },
    connected: {
        color: colors.UtilityGreen300,
        marginTop: 2,
    },
    notConnected: {
        color: colors.Text03,
        marginTop: 2,
    },
    explanation: {
        color: colors.Text02,
        marginTop: 12,
    },
    modeActions: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        marginTop: 12,
    },
    modeAction: {
        marginRight: 8,
        marginBottom: 8,
    },
    authSection: {
        borderTopWidth: 1,
        borderTopColor: colors.Grey300,
        marginTop: 16,
        paddingTop: 16,
    },
    authTitle: {
        color: colors.Text01,
        marginBottom: 2,
    },
    steps: {
        marginTop: 12,
        marginBottom: 12,
    },
    step: {
        color: colors.Text02,
        marginBottom: 6,
    },
    input: {
        minHeight: 44,
        borderWidth: 1,
        borderColor: colors.Grey400,
        borderRadius: 4,
        paddingHorizontal: 12,
        paddingVertical: 10,
        color: colors.Text01,
        fontFamily: 'Roboto-Regular',
    },
    jsonInput: {
        minHeight: 112,
        textAlignVertical: 'top',
    },
    securityNote: {
        color: colors.Text03,
        marginTop: 6,
    },
    actions: {
        flexDirection: 'row',
        alignItems: 'center',
        marginTop: 14,
    },
    primaryAction: {
        marginRight: 12,
    },
    secondaryAction: {
        marginRight: 8,
    },
    error: {
        ...styles.caption1,
        color: colors.UtilityRed200,
        marginTop: 8,
    },
    success: {
        ...styles.caption1,
        color: colors.UtilityGreen300,
        marginTop: 8,
    },
})
