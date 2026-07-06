import React, { useState } from 'react'
import { ActivityIndicator, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native'
import { useSelector } from 'react-redux'
import Popover from 'react-tiny-popover'

import styles, { colors } from '../../../styles/global'
import Icon from '../../../Icon'
import CheckBox from '../../../CheckBox'
import { translate } from '../../../../i18n/TranslationService'
import { performEmailLineAction, submitEmailLabelFeedback } from '../../../../utils/backends/EmailLine/emailLineBackend'
import { openUrlInNewTab } from '../emailLineHelper'
import DraftReplyPopup from './DraftReplyPopup'

const POPOVER_CONTAINER_STYLE = { zIndex: 10000 }

function parseSenderName(from = '') {
    if (!from) return ''
    const match = from.match(/^\s*"?([^"<]*?)"?\s*<[^>]+>\s*$/)
    if (match && match[1].trim()) return match[1].trim()
    return from.replace(/[<>]/g, '').trim()
}

// A single email row in the label modal: multi-select checkbox, sender/subject/
// snippet, an unread dot, and an open-in-new-tab action.
// Resolves the unsubscribe destination: prefer a whitelisted https link;
// fall back to opening the message so the user can unsubscribe in the provider UI.
function resolveUnsubscribeUrl(row) {
    const unsubscribe = row?.unsubscribe
    if (!unsubscribe) return null
    if (typeof unsubscribe.httpsUrl === 'string' && unsubscribe.httpsUrl.startsWith('https://')) {
        return unsubscribe.httpsUrl
    }
    if (unsubscribe.mailto) return row.webUrl || null
    return null
}

export default function EmailRow({ row, projectId, labelOptions, selected, onToggleSelect, onOpen }) {
    const [draftOpen, setDraftOpen] = useState(false)
    const [reasoningOpen, setReasoningOpen] = useState(false)
    const [feedbackOpen, setFeedbackOpen] = useState(false)
    const [feedbackLabel, setFeedbackLabel] = useState(null)
    const [feedbackNote, setFeedbackNote] = useState('')
    const [feedbackState, setFeedbackState] = useState('idle') // idle | sending | done | error
    const [taskState, setTaskState] = useState('idle') // idle | creating | done | error
    const smallScreen = useSelector(state => state.smallScreen)
    if (!row) return null

    const unsubscribeUrl = resolveUnsubscribeUrl(row)
    const hasReasoning = !!row.reasoning
    const confidencePercent = Number.isFinite(row.confidence) ? Math.round(row.confidence * 100) : null
    const feedbackLabelOptions = (labelOptions || []).filter(option => option !== row.labelName)

    const sendFeedback = async () => {
        setFeedbackState('sending')
        try {
            await submitEmailLabelFeedback(projectId, {
                messageId: row.messageId,
                correctLabel: feedbackLabel,
                note: feedbackNote,
            })
            setFeedbackState('done')
        } catch (error) {
            setFeedbackState('error')
        }
    }

    const createTask = async () => {
        setTaskState('creating')
        try {
            await performEmailLineAction(projectId, { action: 'createTask', messageIds: [row.messageId] })
            setTaskState('done')
        } catch (error) {
            setTaskState('error')
        }
    }

    return (
        <View style={localStyles.row}>
            <TouchableOpacity
                style={localStyles.checkboxArea}
                onPress={() => onToggleSelect && onToggleSelect(row)}
                accessibilityLabel={translate(selected ? 'Deselect' : 'Select')}
            >
                <CheckBox checked={selected} />
            </TouchableOpacity>

            <TouchableOpacity
                style={localStyles.content}
                onPress={() => onToggleSelect && onToggleSelect(row)}
                activeOpacity={0.7}
            >
                <View style={localStyles.topLine}>
                    {row.isUnread && <View style={localStyles.unreadDot} />}
                    <Text
                        style={[styles.subtitle2, localStyles.sender, !row.isUnread && localStyles.readText]}
                        numberOfLines={1}
                    >
                        {parseSenderName(row.from) || translate('Unknown sender')}
                    </Text>
                    {row.needsReply && (
                        <View style={localStyles.needsReplyTag}>
                            <Text style={[styles.caption2, localStyles.needsReplyTagText]}>
                                {translate('Needs reply')}
                            </Text>
                        </View>
                    )}
                    {hasReasoning && (
                        <TouchableOpacity
                            style={localStyles.reasoningToggle}
                            onPress={() => setReasoningOpen(open => !open)}
                            accessibilityLabel={translate('Why this label')}
                        >
                            <Icon
                                name={reasoningOpen ? 'chevron-up' : 'info'}
                                size={12}
                                color={reasoningOpen ? colors.Text02 : colors.Text03}
                            />
                        </TouchableOpacity>
                    )}
                </View>
                <Text style={[styles.body2, localStyles.subject]} numberOfLines={1}>
                    {row.subject || translate('No subject')}
                </Text>
                {!!row.snippet && (
                    <Text style={[styles.caption1, localStyles.snippet]} numberOfLines={1}>
                        {row.snippet}
                    </Text>
                )}
                {hasReasoning && reasoningOpen && (
                    <View style={localStyles.reasoningBox}>
                        {!!row.labelName && (
                            <Text style={[styles.caption2, localStyles.reasoningLabel]}>
                                {confidencePercent === null
                                    ? row.labelName
                                    : `${row.labelName} · ${confidencePercent}%`}
                            </Text>
                        )}
                        <Text style={[styles.caption1, localStyles.reasoningText]}>{row.reasoning}</Text>

                        {feedbackState === 'done' ? (
                            <View style={localStyles.feedbackDoneRow}>
                                <Icon name="check" size={12} color={colors.UtilityGreen300} />
                                <Text style={[styles.caption2, localStyles.feedbackDoneText]}>
                                    {translate('Labeling instructions updated')}
                                </Text>
                            </View>
                        ) : !feedbackOpen ? (
                            <TouchableOpacity
                                style={localStyles.feedbackLink}
                                onPress={() => setFeedbackOpen(true)}
                                accessibilityLabel={translate('Wrong label?')}
                            >
                                <Text style={[styles.caption2, localStyles.feedbackLinkText]}>
                                    {translate('Wrong label?')}
                                </Text>
                            </TouchableOpacity>
                        ) : (
                            <View style={localStyles.feedbackForm}>
                                {feedbackLabelOptions.length > 0 && (
                                    <View style={localStyles.feedbackPills}>
                                        {feedbackLabelOptions.map(option => (
                                            <TouchableOpacity
                                                key={option}
                                                style={[
                                                    localStyles.feedbackPill,
                                                    feedbackLabel === option && localStyles.feedbackPillSelected,
                                                ]}
                                                onPress={() =>
                                                    setFeedbackLabel(previous => (previous === option ? null : option))
                                                }
                                            >
                                                <Text
                                                    style={[
                                                        styles.caption2,
                                                        localStyles.feedbackPillText,
                                                        feedbackLabel === option &&
                                                            localStyles.feedbackPillTextSelected,
                                                    ]}
                                                    numberOfLines={1}
                                                >
                                                    {option}
                                                </Text>
                                            </TouchableOpacity>
                                        ))}
                                    </View>
                                )}
                                <TextInput
                                    style={[styles.caption1, localStyles.feedbackInput]}
                                    value={feedbackNote}
                                    onChangeText={setFeedbackNote}
                                    placeholder={translate('Add a note (optional)')}
                                    placeholderTextColor={colors.Text03}
                                />
                                <View style={localStyles.feedbackActions}>
                                    {feedbackState === 'error' && (
                                        <Text style={[styles.caption2, localStyles.feedbackErrorText]}>
                                            {translate('Something went wrong')}
                                        </Text>
                                    )}
                                    <TouchableOpacity
                                        style={localStyles.feedbackSendButton}
                                        onPress={sendFeedback}
                                        disabled={feedbackState === 'sending'}
                                    >
                                        {feedbackState === 'sending' ? (
                                            <ActivityIndicator size="small" color="#ffffff" />
                                        ) : (
                                            <Text style={[styles.caption2, localStyles.feedbackSendText]}>
                                                {translate('Send feedback')}
                                            </Text>
                                        )}
                                    </TouchableOpacity>
                                </View>
                            </View>
                        )}
                    </View>
                )}
                {!!unsubscribeUrl && (
                    <TouchableOpacity
                        style={localStyles.unsubscribe}
                        onPress={() => openUrlInNewTab(unsubscribeUrl)}
                        accessibilityLabel={translate('Unsubscribe')}
                    >
                        <Icon name="slash" size={11} color={colors.Text03} />
                        <Text style={[styles.caption2, localStyles.unsubscribeText]}>{translate('Unsubscribe')}</Text>
                    </TouchableOpacity>
                )}
            </TouchableOpacity>

            <View style={localStyles.actions}>
                <TouchableOpacity
                    style={localStyles.actionButton}
                    onPress={createTask}
                    disabled={taskState === 'creating' || taskState === 'done'}
                    accessibilityLabel={translate(taskState === 'done' ? 'Task created' : 'Create task')}
                >
                    {taskState === 'creating' ? (
                        <ActivityIndicator size="small" color={colors.Text03} />
                    ) : taskState === 'done' ? (
                        <Icon name="check-square" size={16} color={colors.UtilityGreen300} />
                    ) : (
                        <Icon
                            name="plus-square"
                            size={16}
                            color={taskState === 'error' ? colors.UtilityRed200 : colors.Text03}
                        />
                    )}
                </TouchableOpacity>
                <Popover
                    isOpen={draftOpen}
                    position={['left', 'bottom', 'top', 'right']}
                    align="start"
                    padding={4}
                    containerStyle={POPOVER_CONTAINER_STYLE}
                    onClickOutside={() => setDraftOpen(false)}
                    contentLocation={smallScreen ? null : undefined}
                    content={
                        <DraftReplyPopup
                            projectId={projectId}
                            messageId={row.messageId}
                            closePopover={() => setDraftOpen(false)}
                        />
                    }
                >
                    <TouchableOpacity
                        style={localStyles.actionButton}
                        onPress={() => setDraftOpen(true)}
                        accessibilityLabel={translate('Draft reply')}
                    >
                        <Icon name="corner-up-left" size={16} color={colors.Text03} />
                    </TouchableOpacity>
                </Popover>
                <TouchableOpacity
                    style={localStyles.actionButton}
                    onPress={() => onOpen && onOpen(row)}
                    accessibilityLabel={translate('Open')}
                >
                    <Icon name="external-link" size={16} color={colors.Text03} />
                </TouchableOpacity>
            </View>
        </View>
    )
}

const localStyles = StyleSheet.create({
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 10,
        borderBottomWidth: 1,
        borderBottomColor: colors.Secondary300,
    },
    checkboxArea: {
        paddingRight: 12,
        justifyContent: 'center',
    },
    content: {
        flex: 1,
        paddingRight: 8,
    },
    topLine: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    unreadDot: {
        width: 8,
        height: 8,
        borderRadius: 4,
        backgroundColor: colors.Primary100,
        marginRight: 6,
    },
    sender: {
        color: '#ffffff',
        flexShrink: 1,
    },
    needsReplyTag: {
        marginLeft: 8,
        paddingHorizontal: 6,
        height: 16,
        borderRadius: 8,
        backgroundColor: colors.UtilityYellow100,
        alignItems: 'center',
        justifyContent: 'center',
    },
    needsReplyTagText: {
        color: colors.UtilityYellow300,
    },
    readText: {
        color: colors.Text03,
    },
    reasoningToggle: {
        width: 20,
        height: 20,
        alignItems: 'center',
        justifyContent: 'center',
        marginLeft: 6,
    },
    reasoningBox: {
        marginTop: 6,
        padding: 8,
        borderRadius: 4,
        backgroundColor: colors.Secondary300,
    },
    reasoningLabel: {
        color: '#ffffff',
        marginBottom: 2,
    },
    reasoningText: {
        color: colors.Text03,
    },
    feedbackLink: {
        marginTop: 6,
        alignSelf: 'flex-start',
    },
    feedbackLinkText: {
        color: colors.Text03,
        textDecorationLine: 'underline',
    },
    feedbackDoneRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginTop: 6,
    },
    feedbackDoneText: {
        color: colors.UtilityGreen300,
        marginLeft: 4,
    },
    feedbackForm: {
        marginTop: 8,
    },
    feedbackPills: {
        flexDirection: 'row',
        flexWrap: 'wrap',
    },
    feedbackPill: {
        maxWidth: 160,
        paddingHorizontal: 8,
        height: 20,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: colors.Secondary200,
        alignItems: 'center',
        justifyContent: 'center',
        marginRight: 6,
        marginBottom: 6,
    },
    feedbackPillSelected: {
        backgroundColor: colors.Primary100,
        borderColor: colors.Primary100,
    },
    feedbackPillText: {
        color: colors.Text03,
    },
    feedbackPillTextSelected: {
        color: '#ffffff',
    },
    feedbackInput: {
        height: 28,
        borderRadius: 4,
        borderWidth: 1,
        borderColor: colors.Secondary200,
        color: '#ffffff',
        paddingHorizontal: 8,
        marginTop: 2,
    },
    feedbackActions: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'flex-end',
        marginTop: 6,
    },
    feedbackErrorText: {
        color: colors.UtilityRed200,
        marginRight: 8,
    },
    feedbackSendButton: {
        height: 24,
        paddingHorizontal: 10,
        borderRadius: 12,
        backgroundColor: colors.Primary100,
        alignItems: 'center',
        justifyContent: 'center',
    },
    feedbackSendText: {
        color: '#ffffff',
    },
    subject: {
        color: colors.Text03,
        marginTop: 1,
    },
    snippet: {
        color: colors.Text03,
        marginTop: 1,
    },
    unsubscribe: {
        flexDirection: 'row',
        alignItems: 'center',
        marginTop: 4,
        alignSelf: 'flex-start',
    },
    unsubscribeText: {
        color: colors.Text03,
        marginLeft: 4,
        textDecorationLine: 'underline',
    },
    actions: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    actionButton: {
        width: 32,
        height: 32,
        alignItems: 'center',
        justifyContent: 'center',
    },
})
