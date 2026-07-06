import React, { useState } from 'react'
import { ActivityIndicator, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native'

import styles, { colors } from '../../../styles/global'
import Icon from '../../../Icon'
import { translate } from '../../../../i18n/TranslationService'
import { performEmailLineAction } from '../../../../utils/backends/EmailLine/emailLineBackend'
import { openUrlInNewTab } from '../emailLineHelper'

// Inline popover to draft an AI reply for a single email with optional guidance.
export default function DraftReplyPopup({ projectId, messageId, closePopover }) {
    const [guidance, setGuidance] = useState('')
    const [status, setStatus] = useState('idle') // idle | drafting | done | error
    const [draftUrl, setDraftUrl] = useState('')
    const [errorText, setErrorText] = useState('')

    const draft = async () => {
        if (status === 'drafting') return
        setStatus('drafting')
        setErrorText('')
        try {
            const result = await performEmailLineAction(projectId, {
                action: 'draftReply',
                messageIds: [messageId],
                guidance,
            })
            setDraftUrl(result?.draftUrl || '')
            setStatus('done')
        } catch (error) {
            const message = String(error?.message || '')
            setErrorText(
                message.includes('INSUFFICIENT_GOLD') ? translate('Not enough Gold') : translate('Something went wrong')
            )
            setStatus('error')
        }
    }

    return (
        <View style={localStyles.container}>
            <View style={localStyles.header}>
                <Text style={[styles.subtitle1, localStyles.title]}>{translate('Draft reply')}</Text>
                <TouchableOpacity onPress={closePopover} accessibilityLabel={translate('Close')}>
                    <Icon name="x" size={18} color={colors.Text03} />
                </TouchableOpacity>
            </View>

            {status === 'done' ? (
                <View style={localStyles.doneRow}>
                    <Icon name="check-circle" size={16} color={colors.UtilityGreen200} />
                    <TouchableOpacity style={localStyles.openDraftButton} onPress={() => openUrlInNewTab(draftUrl)}>
                        <Icon name="external-link" size={14} color={colors.Primary100} />
                        <Text style={[styles.subtitle2, localStyles.openDraftText]}>{translate('Open draft')}</Text>
                    </TouchableOpacity>
                </View>
            ) : (
                <>
                    <TextInput
                        style={localStyles.input}
                        value={guidance}
                        onChangeText={setGuidance}
                        placeholder={translate('Reply guidance (optional)')}
                        placeholderTextColor={colors.Text03}
                        multiline
                        editable={status !== 'drafting'}
                    />
                    {!!errorText && <Text style={[styles.caption1, localStyles.errorText]}>{errorText}</Text>}
                    <TouchableOpacity
                        style={[localStyles.draftButton, status === 'drafting' && localStyles.draftButtonDisabled]}
                        onPress={draft}
                        disabled={status === 'drafting'}
                    >
                        {status === 'drafting' ? (
                            <ActivityIndicator size="small" color="#ffffff" />
                        ) : (
                            <Text style={[styles.subtitle2, localStyles.draftButtonText]}>
                                {translate('Draft reply')}
                            </Text>
                        )}
                    </TouchableOpacity>
                </>
            )}
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        width: 280,
        backgroundColor: colors.Secondary400,
        borderRadius: 4,
        padding: 12,
        shadowColor: 'rgba(78, 93, 120, 0.56)',
        shadowOpacity: 1,
        shadowRadius: 16,
        shadowOffset: { width: 0, height: 4 },
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 8,
    },
    title: {
        color: '#ffffff',
    },
    input: {
        minHeight: 64,
        borderWidth: 1,
        borderColor: colors.Secondary300,
        backgroundColor: colors.Secondary300,
        borderRadius: 6,
        padding: 8,
        color: '#ffffff',
        textAlignVertical: 'top',
        marginBottom: 8,
    },
    errorText: {
        color: colors.Red200,
        marginBottom: 8,
    },
    draftButton: {
        height: 36,
        borderRadius: 18,
        backgroundColor: colors.Primary100,
        alignItems: 'center',
        justifyContent: 'center',
    },
    draftButtonDisabled: {
        opacity: 0.72,
    },
    draftButtonText: {
        color: '#ffffff',
    },
    doneRow: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    openDraftButton: {
        flexDirection: 'row',
        alignItems: 'center',
        marginLeft: 10,
    },
    openDraftText: {
        color: colors.Primary100,
        marginLeft: 6,
    },
})
