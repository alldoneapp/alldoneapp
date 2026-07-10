import React, { useState } from 'react'
import { ActivityIndicator, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native'
import { useSelector } from 'react-redux'
import Popover from 'react-tiny-popover'

import styles, { colors } from '../../../styles/global'
import Icon from '../../../Icon'
import CheckBox from '../../../CheckBox'
import CustomScrollView from '../../../UIControls/CustomScrollView'
import { translate } from '../../../../i18n/TranslationService'
import { performEmailLineAction, submitEmailLabelFeedback } from '../../../../utils/backends/EmailLine/emailLineBackend'
import { markEmailLabelPickerInteraction, openUrlInNewTab } from '../emailLineHelper'
import URLTrigger from '../../../../URLSystem/URLTrigger'
import NavigationService from '../../../../utils/NavigationService'
import { getDvMainTabLink } from '../../../../utils/LinkingHelper'
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

// Options are { gmailLabelName, displayName } pairs; dedupe by name and drop the
// actual bucket label. The audit label shown on the row may be only a prediction,
// especially inside the synthetic "No label" bucket.
function normalizeLabelOptions(labelOptions = [], excludedLabelName = '') {
    const seen = new Set()
    const excluded = typeof excludedLabelName === 'string' ? excludedLabelName.trim() : ''
    return labelOptions
        .map(option => ({
            gmailLabelName: typeof option?.gmailLabelName === 'string' ? option.gmailLabelName.trim() : '',
            displayName: typeof option?.displayName === 'string' ? option.displayName.trim() : '',
        }))
        .filter(option => {
            if (!option.gmailLabelName || !option.displayName) return false
            if (excluded && (option.displayName === excluded || option.gmailLabelName === excluded)) return false
            if (seen.has(option.gmailLabelName)) return false
            seen.add(option.gmailLabelName)
            return true
        })
}

export default function EmailRow({
    row,
    connectionId,
    labelOptions,
    currentLabelId,
    currentLabelName,
    selected,
    pending,
    onToggleSelect,
    onOpen,
    onRelabeled,
}) {
    const [draftOpen, setDraftOpen] = useState(false)
    const [reasoningOpen, setReasoningOpen] = useState(false)
    const [feedbackOpen, setFeedbackOpen] = useState(false)
    const [feedbackDropdownOpen, setFeedbackDropdownOpen] = useState(false)
    const [feedbackLabel, setFeedbackLabel] = useState(null)
    const [feedbackLabelName, setFeedbackLabelName] = useState(null)
    const [feedbackLabelChanged, setFeedbackLabelChanged] = useState(false)
    const [feedbackNote, setFeedbackNote] = useState('')
    const [feedbackFollowUpType, setFeedbackFollowUpType] = useState(row?.followUpType || null)
    const [feedbackState, setFeedbackState] = useState('idle') // idle | sending | done | error
    // A task may already exist for this email from a previous session — the server
    // persists it on the labeling audit record and returns it as row.taskCreated.
    const [taskState, setTaskState] = useState(row?.taskCreated ? 'done' : 'idle') // idle | creating | done | error
    const [createdTask, setCreatedTask] = useState(row?.taskCreated || null)
    const smallScreen = useSelector(state => state.smallScreen)
    if (!row) return null

    const unsubscribeUrl = resolveUnsubscribeUrl(row)
    const hasReasoning = !!row.reasoning
    const confidencePercent = Number.isFinite(row.confidence) ? Math.round(row.confidence * 100) : null
    const correctLabelText = translate('Correct label')
    const inboxOnlyText = translate('Inbox only')
    // Prefer the per-email classifier result. The section label is only a fallback for
    // providers/older rows without an audit record; this distinction matters most in
    // the synthetic Inbox modal, where messages from several classified labels appear.
    const displayedLabelName = row.labelName || currentLabelName || inboxOnlyText
    const explanationText = row.reasoning || translate('No project or label explanation was recorded for this email.')
    const feedbackLabelOptions = normalizeLabelOptions(labelOptions, currentLabelName)
    const feedbackDropdownOptions = [
        { value: null, gmailLabelName: null, label: inboxOnlyText },
        ...feedbackLabelOptions.map(option => ({
            value: option.displayName,
            gmailLabelName: option.gmailLabelName,
            label: option.displayName,
        })),
    ]
    const feedbackLabelText = feedbackLabel || inboxOnlyText

    const sendFeedback = async () => {
        setFeedbackDropdownOpen(false)
        setFeedbackState('sending')
        try {
            await submitEmailLabelFeedback(connectionId, {
                messageId: row.messageId,
                ...(feedbackLabelChanged
                    ? {
                          correctLabel: feedbackLabel,
                          correctLabelName: feedbackLabelName,
                          currentLabelId: currentLabelId || null,
                      }
                    : {}),
                note: feedbackNote,
                correctFollowUpType: feedbackFollowUpType,
            })
            setFeedbackState('done')
            // The email now lives under the corrected label, so drop it out of this section.
            if (onRelabeled) onRelabeled(row)
        } catch (error) {
            setFeedbackState('error')
        }
    }

    const createTask = async () => {
        setTaskState('creating')
        try {
            const result = await performEmailLineAction(connectionId, {
                action: 'createTask',
                messageIds: row.messageIds || [row.messageId],
                labelId: currentLabelId || null,
                labelName: currentLabelName || null,
            })
            if (result?.taskId) setCreatedTask({ taskId: result.taskId, projectId: result.projectId })
            setTaskState('done')
        } catch (error) {
            setTaskState('error')
        }
    }

    const openCreatedTask = () => {
        if (!createdTask?.taskId || !createdTask?.projectId) return
        URLTrigger.processUrl(NavigationService, getDvMainTabLink(createdTask.projectId, createdTask.taskId, 'tasks'))
    }

    const checkbox = pending ? (
        <View style={localStyles.checkboxArea}>
            <ActivityIndicator size="small" color={colors.Primary100} />
        </View>
    ) : (
        <TouchableOpacity
            style={localStyles.checkboxArea}
            onPress={() => onToggleSelect && onToggleSelect(row)}
            accessibilityLabel={translate(selected ? 'Deselect' : 'Select')}
        >
            <CheckBox checked={selected} />
        </TouchableOpacity>
    )

    const content = (
        <View style={[localStyles.content, pending && localStyles.dimmed]}>
            <TouchableOpacity
                style={localStyles.infoBlock}
                onPress={pending ? undefined : () => onOpen && onOpen(row)}
                activeOpacity={pending ? 1 : 0.7}
                disabled={pending}
                accessibilityLabel={translate('Open')}
            >
                <View style={localStyles.topLine}>
                    {row.isUnread && <View style={localStyles.unreadDot} />}
                    <Text
                        style={[styles.subtitle2, localStyles.sender, !row.isUnread && localStyles.readText]}
                        numberOfLines={1}
                    >
                        {parseSenderName(row.from) || translate('Unknown sender')}
                    </Text>
                    {!!row.followUpType && (
                        <View style={localStyles.followUpTypeTag}>
                            <Text style={[styles.caption2, localStyles.followUpTypeTagText]}>
                                {translate(row.followUpType === 'actionable' ? 'Actionable' : 'Informational')}
                            </Text>
                        </View>
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
            </TouchableOpacity>
            <TouchableOpacity
                style={localStyles.emailLabelTag}
                onPress={() => setReasoningOpen(open => !open)}
                disabled={pending}
                accessibilityLabel={`${translate('Why this label')}: ${displayedLabelName}`}
            >
                <Icon name="tag" size={11} color={colors.Primary100} />
                <Text style={[styles.caption2, localStyles.emailLabelTagText]} numberOfLines={1}>
                    {displayedLabelName}
                </Text>
                <Icon name={reasoningOpen ? 'chevron-up' : 'chevron-down'} size={11} color={colors.Text03} />
            </TouchableOpacity>
            {reasoningOpen && (
                <View style={localStyles.reasoningBox}>
                    {!!row.labelName && (
                        <Text style={[styles.caption2, localStyles.reasoningLabel]}>
                            {confidencePercent === null ? row.labelName : `${row.labelName} · ${confidencePercent}%`}
                        </Text>
                    )}
                    <Text style={[styles.caption1, localStyles.reasoningText]}>{explanationText}</Text>

                    {hasReasoning && (
                        <>
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
                                    onPress={() => {
                                        setFeedbackOpen(true)
                                        setFeedbackLabel(null)
                                        setFeedbackLabelChanged(false)
                                    }}
                                    accessibilityLabel={translate('Wrong label?')}
                                >
                                    <Text style={[styles.caption2, localStyles.feedbackLinkText]}>
                                        {translate('Wrong label?')}
                                    </Text>
                                </TouchableOpacity>
                            ) : (
                                <View style={localStyles.feedbackForm}>
                                    <Popover
                                        isOpen={feedbackDropdownOpen}
                                        position={['bottom', 'top']}
                                        align="start"
                                        padding={4}
                                        containerStyle={POPOVER_CONTAINER_STYLE}
                                        onClickOutside={() => setFeedbackDropdownOpen(false)}
                                        contentLocation={smallScreen ? null : undefined}
                                        content={
                                            <CustomScrollView
                                                style={localStyles.feedbackDropdown}
                                                showsVerticalScrollIndicator={false}
                                            >
                                                {feedbackDropdownOptions.map(option => {
                                                    const selectedOption = feedbackLabel === option.value
                                                    return (
                                                        <TouchableOpacity
                                                            key={option.value || 'inbox'}
                                                            style={[
                                                                localStyles.feedbackDropdownItem,
                                                                selectedOption &&
                                                                    localStyles.feedbackDropdownItemSelected,
                                                            ]}
                                                            onPress={() => {
                                                                // Tapping an option lands in the
                                                                // dropdown's own portal, which the
                                                                // parent modal reads as an outside
                                                                // click; stamp it so the modal
                                                                // ignores that dismissal.
                                                                markEmailLabelPickerInteraction()
                                                                setFeedbackLabel(option.value)
                                                                setFeedbackLabelName(option.gmailLabelName)
                                                                setFeedbackLabelChanged(true)
                                                                setFeedbackDropdownOpen(false)
                                                            }}
                                                            accessibilityLabel={`${correctLabelText}: ${option.label}`}
                                                        >
                                                            <Text
                                                                style={[
                                                                    styles.caption1,
                                                                    localStyles.feedbackDropdownItemText,
                                                                    selectedOption &&
                                                                        localStyles.feedbackDropdownItemTextSelected,
                                                                ]}
                                                                numberOfLines={1}
                                                            >
                                                                {option.label}
                                                            </Text>
                                                            {selectedOption && (
                                                                <Icon name="check" size={12} color="#ffffff" />
                                                            )}
                                                        </TouchableOpacity>
                                                    )
                                                })}
                                            </CustomScrollView>
                                        }
                                    >
                                        <TouchableOpacity
                                            style={localStyles.feedbackDropdownTrigger}
                                            onPress={() => setFeedbackDropdownOpen(open => !open)}
                                            accessibilityLabel={translate('Select correct label')}
                                        >
                                            <View style={localStyles.feedbackDropdownTextBlock}>
                                                <Text style={[styles.caption2, localStyles.feedbackDropdownCaption]}>
                                                    {correctLabelText}
                                                </Text>
                                                <Text
                                                    style={[styles.caption1, localStyles.feedbackDropdownValue]}
                                                    numberOfLines={1}
                                                >
                                                    {feedbackLabelText}
                                                </Text>
                                            </View>
                                            <Icon
                                                name={feedbackDropdownOpen ? 'chevron-up' : 'chevron-down'}
                                                size={14}
                                                color={colors.Text03}
                                            />
                                        </TouchableOpacity>
                                    </Popover>
                                    {feedbackLabelOptions.length === 0 && (
                                        <View style={localStyles.feedbackOnlyInboxHint}>
                                            <Icon name="info" size={12} color={colors.Text03} />
                                            <Text style={[styles.caption2, localStyles.feedbackOnlyInboxHintText]}>
                                                {translate('No other labels are configured')}
                                            </Text>
                                        </View>
                                    )}
                                    <View style={localStyles.feedbackClassificationRow}>
                                        {['actionable', 'informational'].map(type => (
                                            <TouchableOpacity
                                                key={type}
                                                style={[
                                                    localStyles.feedbackClassificationButton,
                                                    feedbackFollowUpType === type &&
                                                        localStyles.feedbackClassificationButtonSelected,
                                                ]}
                                                onPress={() => setFeedbackFollowUpType(type)}
                                                accessibilityLabel={translate(
                                                    type === 'actionable' ? 'Actionable' : 'Informational'
                                                )}
                                            >
                                                <Text style={[styles.caption2, localStyles.feedbackClassificationText]}>
                                                    {translate(type === 'actionable' ? 'Actionable' : 'Informational')}
                                                </Text>
                                            </TouchableOpacity>
                                        ))}
                                    </View>
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
                                            disabled={
                                                feedbackState === 'sending' ||
                                                (!feedbackLabelChanged && !feedbackFollowUpType)
                                            }
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
                        </>
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
        </View>
    )

    const actions = (
        <View
            style={[localStyles.actions, smallScreen && localStyles.actionsMobile, pending && localStyles.dimmed]}
            pointerEvents={pending ? 'none' : 'auto'}
        >
            <TouchableOpacity
                style={localStyles.actionButton}
                onPress={() => setReasoningOpen(open => !open)}
                accessibilityLabel={translate('Why this label')}
            >
                <Icon name="help-circle" size={16} color={hasReasoning ? colors.Primary100 : colors.Text03} />
            </TouchableOpacity>
            {taskState === 'done' ? (
                <TouchableOpacity
                    style={localStyles.actionButton}
                    onPress={openCreatedTask}
                    disabled={!createdTask?.taskId || !createdTask?.projectId}
                    accessibilityLabel={translate('Task created')}
                >
                    <Icon name="check-square" size={16} color={colors.UtilityGreen300} />
                </TouchableOpacity>
            ) : (
                <TouchableOpacity
                    style={localStyles.actionButton}
                    onPress={createTask}
                    disabled={taskState === 'creating'}
                    accessibilityLabel={translate('Create task')}
                >
                    {taskState === 'creating' ? (
                        <ActivityIndicator size="small" color={colors.Text03} />
                    ) : (
                        <Icon
                            name="plus-square"
                            size={16}
                            color={taskState === 'error' ? colors.UtilityRed200 : colors.Text03}
                        />
                    )}
                </TouchableOpacity>
            )}
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
                        projectId={connectionId}
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
    )

    // On phones the four action icons would squeeze the sender/subject and — worse —
    // the expanded "Why this label" / feedback form into a ~150px column. Drop the
    // actions onto their own full-width row below the content so it gets the room.
    if (smallScreen) {
        return (
            <View style={[localStyles.row, localStyles.rowMobile]}>
                <View style={localStyles.rowMain}>
                    {checkbox}
                    {content}
                </View>
                {actions}
            </View>
        )
    }

    return (
        <View style={localStyles.row}>
            {checkbox}
            {content}
            {actions}
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
    rowMobile: {
        flexDirection: 'column',
        alignItems: 'stretch',
    },
    rowMain: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    checkboxArea: {
        paddingRight: 12,
        justifyContent: 'center',
    },
    dimmed: {
        opacity: 0.4,
    },
    content: {
        flex: 1,
        paddingRight: 8,
    },
    // The sender/subject/snippet block is the tap target that opens the email; kept separate
    // from the reasoning/feedback area below so only this part opens a new tab.
    infoBlock: {
        alignSelf: 'stretch',
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
    followUpTypeTag: {
        marginLeft: 8,
        paddingHorizontal: 6,
        height: 16,
        borderRadius: 8,
        backgroundColor: colors.UtilityYellow100,
        alignItems: 'center',
        justifyContent: 'center',
    },
    followUpTypeTagText: {
        color: colors.UtilityYellow300,
    },
    feedbackClassificationRow: {
        flexDirection: 'row',
        marginTop: 8,
    },
    feedbackClassificationButton: {
        paddingHorizontal: 10,
        paddingVertical: 6,
        marginRight: 8,
        borderRadius: 12,
        backgroundColor: colors.Secondary300,
    },
    feedbackClassificationButtonSelected: {
        backgroundColor: colors.Primary100,
    },
    feedbackClassificationText: {
        color: '#ffffff',
    },
    readText: {
        color: colors.Text03,
    },
    emailLabelTag: {
        alignSelf: 'flex-start',
        maxWidth: '100%',
        minHeight: 20,
        marginTop: 5,
        paddingHorizontal: 7,
        borderRadius: 10,
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: colors.Secondary300,
    },
    emailLabelTagText: {
        color: colors.Text03,
        marginHorizontal: 4,
        flexShrink: 1,
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
    feedbackDropdownTrigger: {
        minHeight: 42,
        borderRadius: 4,
        borderWidth: 1,
        borderColor: colors.Secondary200,
        backgroundColor: colors.Secondary400,
        paddingHorizontal: 10,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    feedbackDropdownTextBlock: {
        flex: 1,
        paddingRight: 8,
    },
    feedbackDropdownCaption: {
        color: colors.Text03,
        marginBottom: 2,
    },
    feedbackDropdownValue: {
        color: '#ffffff',
    },
    feedbackDropdown: {
        width: 280,
        maxHeight: 260,
        borderRadius: 4,
        borderWidth: 1,
        borderColor: colors.Secondary200,
        backgroundColor: colors.Secondary400,
        paddingVertical: 4,
        shadowColor: 'rgba(78, 93, 120, 0.56)',
        shadowOpacity: 1,
        shadowRadius: 16,
        shadowOffset: { width: 0, height: 4 },
    },
    feedbackDropdownItem: {
        minHeight: 34,
        paddingHorizontal: 10,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    feedbackDropdownItemSelected: {
        backgroundColor: colors.Primary100,
    },
    feedbackDropdownItemText: {
        color: colors.Text03,
        flex: 1,
        paddingRight: 8,
    },
    feedbackDropdownItemTextSelected: {
        color: '#ffffff',
    },
    feedbackOnlyInboxHint: {
        flexDirection: 'row',
        alignItems: 'center',
        marginTop: 6,
    },
    feedbackOnlyInboxHintText: {
        color: colors.Text03,
        marginLeft: 4,
    },
    feedbackInput: {
        height: 28,
        borderRadius: 4,
        borderWidth: 1,
        borderColor: colors.Secondary200,
        color: '#ffffff',
        paddingHorizontal: 8,
        marginTop: 8,
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
    actionsMobile: {
        justifyContent: 'flex-end',
        marginTop: 2,
    },
    actionButton: {
        width: 32,
        height: 32,
        alignItems: 'center',
        justifyContent: 'center',
    },
})
