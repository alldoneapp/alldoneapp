import React, { useEffect, useState } from 'react'
import { ActivityIndicator, StyleSheet, Text, TextInput, View } from 'react-native'

import Button from '../../UIControls/Button'
import styles, { colors } from '../../styles/global'
import { translate } from '../../../i18n/TranslationService'
import {
    connectVmSubscription,
    disconnectVmSubscription,
    getVmSubscriptionStatus,
} from '../../../utils/backends/firestore'

const PROVIDERS = {
    claude: {
        label: 'Claude',
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
        placeholder: 'Paste the complete contents of ~/.codex/auth.json',
        steps: [
            'Install or update the Codex CLI on your computer.',
            'Add cli_auth_credentials_store = "file" to ~/.codex/config.toml.',
            'Run codex login and sign in with the ChatGPT account that has your Codex subscription.',
            'Open ~/.codex/auth.json, copy the complete JSON, and paste it below.',
        ],
    },
}

function SubscriptionCard({ provider, connection, onChanged }) {
    const config = PROVIDERS[provider]
    const [credential, setCredential] = useState('')
    const [processing, setProcessing] = useState(false)
    const [error, setError] = useState('')
    const [success, setSuccess] = useState('')
    const connected = !!connection?.connected

    const connect = async () => {
        setError('')
        setSuccess('')
        if (!credential.trim()) {
            setError(translate('Paste the requested credential before connecting.'))
            return
        }
        setProcessing(true)
        try {
            await connectVmSubscription({ provider, credential: credential.trim() })
            setCredential('')
            setSuccess(translate('Subscription connected. Future VM token usage will not cost Gold.'))
            await onChanged()
        } catch (e) {
            setError(e?.message || translate('Could not connect the subscription.'))
        } finally {
            setProcessing(false)
        }
    }

    const disconnect = async () => {
        setError('')
        setSuccess('')
        setProcessing(true)
        try {
            await disconnectVmSubscription({ provider })
            setCredential('')
            setSuccess(translate('Subscription disconnected. VM jobs will use Alldone API billing.'))
            await onChanged()
        } catch (e) {
            setError(e?.message || translate('Could not disconnect the subscription.'))
        } finally {
            setProcessing(false)
        }
    }

    return (
        <View style={localStyles.card}>
            <View style={localStyles.cardHeader}>
                <View>
                    <Text style={[styles.subtitle1, localStyles.cardTitle]}>{config.label}</Text>
                    <Text style={[styles.caption1, connected ? localStyles.connected : localStyles.notConnected]}>
                        {translate(connected ? 'Subscription connected' : 'Using Alldone API billing')}
                    </Text>
                </View>
            </View>

            <Text style={[styles.body2, localStyles.explanation]}>
                {translate(
                    'When connected, VM runs for this agent use your personal subscription. Model tokens cost no Gold; the 20 Gold base charge plus 10 Gold per started execution minute remains.'
                )}
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
            <Text style={[styles.caption1, localStyles.securityNote]}>
                {translate(
                    'Treat this credential like a password. Alldone stores it in your private account data and only supplies it to your own VM run.'
                )}
            </Text>

            {!!error && <Text style={localStyles.error}>{error}</Text>}
            {!!success && <Text style={localStyles.success}>{success}</Text>}

            <View style={localStyles.actions}>
                <Button
                    title={translate(connected ? 'Replace credential' : 'Connect subscription')}
                    onPress={connect}
                    processing={processing}
                    processingTitle={translate('Saving')}
                    buttonStyle={localStyles.primaryAction}
                />
                {connected && (
                    <Button title={translate('Disconnect')} type="ghost" onPress={disconnect} disabled={processing} />
                )}
            </View>
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
            <Text style={[styles.title6, localStyles.sectionTitle]}>{translate('AI agent subscriptions')}</Text>
            <Text style={[styles.body2, localStyles.sectionDescription]}>
                {translate(
                    'Optional: connect your own Claude or ChatGPT subscription for execute_task_in_vm. Without a connection, Alldone uses API billing and charges Gold for model tokens.'
                )}
            </Text>
            {!status && !error ? (
                <ActivityIndicator size="small" color={colors.Primary100} />
            ) : (
                <>
                    {!!error && <Text style={localStyles.error}>{error}</Text>}
                    <SubscriptionCard provider="claude" connection={status?.claude} onChanged={loadStatus} />
                    <SubscriptionCard provider="codex" connection={status?.codex} onChanged={loadStatus} />
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
