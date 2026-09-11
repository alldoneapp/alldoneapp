import React from 'react'
import { Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { translate } from '../../i18n/TranslationService'
import Button from '../UIControls/Button'
import styles, { colors } from '../styles/global'
import Icon from '../Icon'
import { useVoiceCall } from './AssistantVoiceCallProvider'
import { LIVE_GOLD_PER_MINUTE, LIVE_INITIALIZATION_SECONDS } from '../../functions/WhatsApp/assistantLivePricing'

export default function AssistantVoiceCallButton({
    compact = false,
    buttonStyle,
    titleStyle,
    textStyle,
    iconStyle,
    assistant = null,
    projectId = null,
    chatId = null,
    variant = 'button',
    title = null,
    skipNavigationOnThreadCreate = true,
}) {
    const { status, error, callSummary, startCall: start } = useVoiceCall()
    const startCall = () => start({ assistant, projectId, chatId, skipNavigationOnThreadCreate })

    if (Platform.OS !== 'web' || status !== 'idle') return null

    const idleTitle = title || translate('Start voice call') || translate('Call Anna')
    const priceText = translate('Voice costs %{gold} Gold/min plus normal assistant usage', {
        gold: LIVE_GOLD_PER_MINUTE,
    })
    const summaryText =
        callSummary &&
        translate(
            callSummary.settled && callSummary.finalVoiceUsage
                ? 'Call cost: %{voice} Gold voice + %{assistant} Gold assistant'
                : 'Call usage so far: %{voice} Gold voice + %{assistant} Gold assistant',
            { voice: callSummary.voiceGold, assistant: callSummary.assistantGold }
        )
    const statusHint = error
    const hint = statusHint ? (
        <Text accessibilityLiveRegion="polite" style={[localStyles.error, compact && localStyles.compactHint]}>
            {statusHint}
        </Text>
    ) : null
    if (variant === 'link') {
        return (
            <View style={localStyles.container}>
                <TouchableOpacity
                    style={[localStyles.linkRow, buttonStyle]}
                    onPress={startCall}
                    accessible
                    accessibilityLabel={`${idleTitle}. ${priceText}`}
                >
                    <Icon name="phone-call" size={24} color={colors.Text03} style={iconStyle} />
                    <Text style={[localStyles.linkText, textStyle]} numberOfLines={2}>
                        {idleTitle}
                    </Text>
                </TouchableOpacity>
                {!compact && <Text style={localStyles.foregroundHint}>{priceText}</Text>}
                {!compact && summaryText && <Text style={localStyles.foregroundHint}>{summaryText}</Text>}
                {!compact && (
                    <Text style={localStyles.foregroundHint}>
                        {translate('Voice has a %{seconds}-second minimum; connected time includes silence', {
                            seconds: LIVE_INITIALIZATION_SECONDS,
                        })}
                    </Text>
                )}
                {hint}
            </View>
        )
    }

    return (
        <View style={localStyles.container}>
            <Button
                type="ghost"
                icon="phone-call"
                title={compact ? null : idleTitle}
                onPress={startCall}
                buttonStyle={[compact ? localStyles.iconButton : localStyles.callButton, buttonStyle]}
                titleStyle={[localStyles.callTitle, titleStyle]}
                accessibilityLabel={`${idleTitle}. ${priceText}`}
                accessible
            />
            {!compact && <Text style={localStyles.foregroundHint}>{priceText}</Text>}
            {!compact && summaryText && <Text style={localStyles.foregroundHint}>{summaryText}</Text>}
            {!compact && (
                <Text style={localStyles.foregroundHint}>
                    {translate('Voice has a %{seconds}-second minimum; connected time includes silence', {
                        seconds: LIVE_INITIALIZATION_SECONDS,
                    })}
                </Text>
            )}
            {hint}
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        alignItems: 'flex-start',
    },
    callButton: {
        height: 40,
        minHeight: 40,
    },
    iconButton: {
        width: 40,
        height: 40,
        minHeight: 40,
        paddingHorizontal: 8,
        marginLeft: 8,
    },
    callTitle: {
        fontSize: 14,
    },
    linkRow: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    linkText: {
        ...styles.body2,
        color: colors.Text03,
    },
    foregroundHint: {
        ...styles.caption2,
        color: colors.Text03,
        marginLeft: 8,
        flexShrink: 1,
    },
    compactHint: {
        position: 'absolute',
        top: 44,
        right: 0,
        width: 240,
        padding: 8,
        backgroundColor: colors.White,
        borderRadius: 4,
        zIndex: 100,
    },
    error: {
        ...styles.caption2,
        color: colors.UtilityRed200,
        marginTop: 4,
    },
})
