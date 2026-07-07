import React, { useEffect, useState } from 'react'
import { ActivityIndicator, Dimensions, StyleSheet, Text, TouchableOpacity, View } from 'react-native'

import styles, { colors } from '../../../styles/global'
import Icon from '../../../Icon'
import CustomScrollView from '../../../UIControls/CustomScrollView'
import { withWindowSizeHook } from '../../../../utils/useWindowSize'
import { MODAL_MAX_HEIGHT_GAP } from '../../../../utils/HelperFunctions'
import { translate } from '../../../../i18n/TranslationService'
import { getProviderLabel } from '../../../../utils/IntegrationProviders'
import {
    fetchEmailLineSummary,
    invalidateEmailLineSummaryCooldown,
    listEmailLineMessages,
    performEmailLineAction,
    performEmailLineSweepInBackground,
} from '../../../../utils/backends/EmailLine/emailLineBackend'
import { getEmailAccountWebUrl, getLabelWebUrl, openUrlInNewTab } from '../emailLineHelper'
import EmailRow from './EmailRow'

const MODAL_MAX_WIDTH = 560

const sectionKey = section => `${section.connectionId}:${section.labelId || ''}`
const selectionKey = (connectionId, labelId, messageId) => `${connectionId}:${labelId || ''}:${messageId}`

// Lists the inbox emails of ONE merged label group across all accounts carrying
// that label. With more than one account, each account renders as a section with
// a slim account header; every row action routes to the row's own connection.
function EmailLabelModal({
    group,
    labelOptionsByConnectionId,
    labelingDisabledByConnectionId,
    closePopover,
    windowSize,
}) {
    const [sections, setSections] = useState([])
    const [loading, setLoading] = useState(true)
    const [loadingMoreKey, setLoadingMoreKey] = useState(null)
    const [selectedIds, setSelectedIds] = useState(() => new Set())

    const screenWidth = windowSize?.[0] || Dimensions.get('window').width
    const screenHeight = windowSize?.[1] || Dimensions.get('window').height
    const width = Math.min(screenWidth - 32, MODAL_MAX_WIDTH)
    const maxHeight = screenHeight - MODAL_MAX_HEIGHT_GAP

    const entries = group?.entries || []
    const load = async () => {
        setLoading(true)
        try {
            const results = await Promise.all(
                entries.map(async entry => {
                    try {
                        const result = await listEmailLineMessages(entry.connectionId, entry.labelId)
                        return {
                            ...entry,
                            messages: result?.messages || [],
                            nextPageToken: result?.nextPageToken || null,
                        }
                    } catch (error) {
                        // One failing account must not blank the whole modal.
                        return { ...entry, messages: [], nextPageToken: null }
                    }
                })
            )
            setSections(results)
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        load()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [group?.key])

    const toggleSelect = (connectionId, labelId, row) => {
        const key = selectionKey(connectionId, labelId, row.messageId)
        setSelectedIds(previous => {
            const next = new Set(previous)
            next.has(key) ? next.delete(key) : next.add(key)
            return next
        })
    }

    const openRow = (section, row) => {
        openUrlInNewTab(row.webUrl || getLabelWebUrl(section.provider, section.emailAddress, section.label))
    }

    // A row was re-labeled server-side (label feedback with a corrected label): drop it from this
    // section immediately so it leaves the old label, then refresh the summary so the chip counts
    // and the destination label update.
    const handleRelabeled = (section, row) => {
        setSections(previous =>
            previous.map(item =>
                sectionKey(item) === sectionKey(section)
                    ? { ...item, messages: item.messages.filter(message => message.messageId !== row.messageId) }
                    : item
            )
        )
        invalidateEmailLineSummaryCooldown(section.connectionId)
        fetchEmailLineSummary(section.connectionId, { force: true }).catch(() => {})
    }

    const openAccount = section => {
        openUrlInNewTab(getEmailAccountWebUrl(section.provider, section.emailAddress))
    }

    const loadMore = async section => {
        if (!section.nextPageToken || loadingMoreKey) return
        const key = sectionKey(section)
        setLoadingMoreKey(key)
        try {
            const result = await listEmailLineMessages(section.connectionId, section.labelId, {
                pageToken: section.nextPageToken,
            })
            setSections(previous =>
                previous.map(item =>
                    sectionKey(item) === key
                        ? {
                              ...item,
                              messages: [...item.messages, ...(result?.messages || [])],
                              nextPageToken: result?.nextPageToken || null,
                          }
                        : item
                )
            )
        } finally {
            setLoadingMoreKey(null)
        }
    }

    const runSelectionAction = action => {
        if (selectedIds.size === 0) return
        const messageIdsByConnection = {}
        sections.forEach(section => {
            section.messages.forEach(row => {
                if (selectedIds.has(selectionKey(section.connectionId, section.labelId, row.messageId))) {
                    if (!messageIdsByConnection[section.connectionId]) {
                        messageIdsByConnection[section.connectionId] = new Set()
                    }
                    ;(row.messageIds || [row.messageId]).forEach(messageId =>
                        messageIdsByConnection[section.connectionId].add(messageId)
                    )
                }
            })
        })
        closePopover()
        Object.keys(messageIdsByConnection).forEach(connectionId => {
            performEmailLineAction(connectionId, {
                action,
                messageIds: [...messageIdsByConnection[connectionId]],
            }).catch(error => {
                if (__DEV__) console.warn('[EmailLine] Background selection action failed:', error?.message || error)
            })
        })
    }

    // Sweeps close the modal immediately and continue in the background: counts are
    // optimistically zeroed and the chip shows a spinner until the summary refreshes.
    const runSweep = action => {
        closePopover()
        entries.forEach(entry => {
            performEmailLineSweepInBackground(entry.connectionId, entry.labelId, action)
        })
    }

    const selectedCount = selectedIds.size
    const totalMessages = sections.reduce((total, section) => total + section.messages.length, 0)
    const labelingDisabled = entries.some(entry => labelingDisabledByConnectionId?.[entry.connectionId])

    const allSelectionKeys = sections.flatMap(section =>
        section.messages.map(row => selectionKey(section.connectionId, section.labelId, row.messageId))
    )
    const allSelected = allSelectionKeys.length > 0 && allSelectionKeys.every(key => selectedIds.has(key))
    const toggleSelectAll = () => {
        setSelectedIds(() => (allSelected ? new Set() : new Set(allSelectionKeys)))
    }

    return (
        <View style={[localStyles.container, { width, maxHeight }]}>
            <View style={localStyles.header}>
                <Text style={[styles.title6, localStyles.title]} numberOfLines={1}>
                    {group.displayName}
                </Text>
                <TouchableOpacity onPress={closePopover} accessibilityLabel={translate('Close')}>
                    <Icon name="x" size={20} color={colors.Text03} />
                </TouchableOpacity>
            </View>

            <View style={localStyles.sweepBar}>
                <TouchableOpacity
                    style={localStyles.sweepButton}
                    onPress={toggleSelectAll}
                    disabled={totalMessages === 0}
                    accessibilityLabel={translate(allSelected ? 'Deselect all' : 'Select all')}
                >
                    <Icon name={allSelected ? 'check-square' : 'square'} size={14} color={colors.Text03} />
                    <Text style={[styles.caption1, localStyles.sweepText]}>
                        {translate(allSelected ? 'Deselect all' : 'Select all')}
                    </Text>
                </TouchableOpacity>
                <TouchableOpacity
                    style={localStyles.sweepButton}
                    onPress={() => runSweep('archiveAll')}
                    disabled={totalMessages === 0}
                >
                    <Icon name="archive" size={14} color={colors.Text03} />
                    <Text style={[styles.caption1, localStyles.sweepText]}>{translate('Archive all')}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={localStyles.sweepButton} onPress={() => runSweep('markAllRead')}>
                    <Icon name="check" size={14} color={colors.Text03} />
                    <Text style={[styles.caption1, localStyles.sweepText]}>{translate('Mark all read')}</Text>
                </TouchableOpacity>
            </View>

            <CustomScrollView style={localStyles.list} showsVerticalScrollIndicator={false}>
                {loading ? (
                    <View style={localStyles.centered}>
                        <ActivityIndicator color={colors.Primary100} />
                    </View>
                ) : totalMessages === 0 ? (
                    <View style={localStyles.centered}>
                        <Text style={[styles.body2, localStyles.emptyText]}>
                            {translate('No emails in inbox with this label')}
                        </Text>
                        {entries.map(entry => (
                            <TouchableOpacity
                                key={entry.connectionId}
                                style={localStyles.openInProviderButton}
                                onPress={() =>
                                    openUrlInNewTab(getEmailAccountWebUrl(entry.provider, entry.emailAddress))
                                }
                            >
                                <Icon name="external-link" size={14} color={colors.Primary100} />
                                <Text style={[styles.subtitle2, localStyles.openInProviderText]}>
                                    {translate('Open email account')}
                                    {entry.emailAddress ? ` · ${entry.emailAddress}` : ''}
                                </Text>
                            </TouchableOpacity>
                        ))}
                    </View>
                ) : (
                    sections.map(section => (
                        <View key={sectionKey(section)}>
                            <View style={localStyles.accountHeader}>
                                <Text style={[styles.caption2, localStyles.accountHeaderText]} numberOfLines={1}>
                                    {[getProviderLabel(section.provider), section.emailAddress]
                                        .filter(Boolean)
                                        .join(' · ')}
                                </Text>
                                <TouchableOpacity
                                    style={localStyles.accountOpenButton}
                                    onPress={() => openAccount(section)}
                                    accessibilityLabel={translate('Open email account')}
                                >
                                    <Icon name="external-link" size={12} color={colors.Primary100} />
                                    <Text style={[styles.caption2, localStyles.accountOpenButtonText]}>
                                        {translate('Open account')}
                                    </Text>
                                </TouchableOpacity>
                            </View>
                            {section.messages.map(row => (
                                <EmailRow
                                    key={selectionKey(section.connectionId, section.labelId, row.messageId)}
                                    row={row}
                                    connectionId={section.connectionId}
                                    labelOptions={labelOptionsByConnectionId?.[section.connectionId] || []}
                                    currentLabelId={section.labelId}
                                    selected={selectedIds.has(
                                        selectionKey(section.connectionId, section.labelId, row.messageId)
                                    )}
                                    onToggleSelect={selectedRow =>
                                        toggleSelect(section.connectionId, section.labelId, selectedRow)
                                    }
                                    onOpen={selectedRow => openRow(section, selectedRow)}
                                    onRelabeled={relabeledRow => handleRelabeled(section, relabeledRow)}
                                />
                            ))}
                            {section.nextPageToken && (
                                <TouchableOpacity
                                    style={localStyles.loadMore}
                                    onPress={() => loadMore(section)}
                                    disabled={!!loadingMoreKey}
                                >
                                    {loadingMoreKey === sectionKey(section) ? (
                                        <ActivityIndicator color={colors.Primary100} />
                                    ) : (
                                        <Text style={[styles.subtitle2, localStyles.loadMoreText]}>
                                            {translate('Load more')}
                                        </Text>
                                    )}
                                </TouchableOpacity>
                            )}
                        </View>
                    ))
                )}
            </CustomScrollView>

            {labelingDisabled && (
                <View style={localStyles.hintRow}>
                    <Icon name="info" size={12} color={colors.Text03} />
                    <Text style={[styles.caption2, localStyles.hintText]}>
                        {translate('Enable email labeling to get reply detection')}
                    </Text>
                </View>
            )}

            {selectedCount > 0 && (
                <View style={localStyles.selectionBar}>
                    <Text style={[styles.subtitle2, localStyles.selectionCount]}>
                        {translate('N selected', { count: selectedCount })}
                    </Text>
                    <View style={localStyles.selectionActions}>
                        <TouchableOpacity style={localStyles.textButton} onPress={() => runSelectionAction('markRead')}>
                            <Text style={[styles.subtitle2, localStyles.cancelText]}>{translate('Mark read')}</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                            style={[localStyles.textButton, localStyles.primaryButton]}
                            onPress={() => runSelectionAction('archive')}
                        >
                            <Text style={[styles.subtitle2, localStyles.primaryButtonText]}>
                                {translate('Archive')}
                            </Text>
                        </TouchableOpacity>
                    </View>
                </View>
            )}
        </View>
    )
}

export default withWindowSizeHook(EmailLabelModal)

const localStyles = StyleSheet.create({
    container: {
        backgroundColor: colors.Secondary400,
        borderRadius: 4,
        paddingHorizontal: 16,
        paddingTop: 12,
        paddingBottom: 8,
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
        flex: 1,
        marginRight: 8,
    },
    sweepBar: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 4,
    },
    sweepButton: {
        height: 28,
        paddingHorizontal: 4,
        flexDirection: 'row',
        alignItems: 'center',
        marginRight: 16,
    },
    sweepText: {
        color: colors.Text03,
        marginLeft: 4,
    },
    list: {
        flexGrow: 0,
    },
    centered: {
        paddingVertical: 32,
        alignItems: 'center',
        justifyContent: 'center',
    },
    emptyText: {
        color: colors.Text03,
        marginBottom: 12,
    },
    openInProviderButton: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 6,
    },
    openInProviderText: {
        color: colors.Primary100,
        marginLeft: 6,
    },
    accountHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingTop: 10,
        paddingBottom: 2,
    },
    accountHeaderText: {
        color: '#ffffff',
        flexShrink: 1,
        paddingRight: 8,
    },
    accountOpenButton: {
        height: 24,
        flexDirection: 'row',
        alignItems: 'center',
        flexShrink: 0,
    },
    accountOpenButtonText: {
        color: colors.Primary100,
        marginLeft: 4,
    },
    loadMore: {
        height: 40,
        alignItems: 'center',
        justifyContent: 'center',
    },
    loadMoreText: {
        color: colors.Primary100,
    },
    hintRow: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingTop: 6,
    },
    hintText: {
        color: colors.Text03,
        marginLeft: 4,
    },
    selectionBar: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        borderTopWidth: 1,
        borderTopColor: colors.Secondary300,
        paddingTop: 8,
        marginTop: 4,
    },
    selectionCount: {
        color: colors.Text03,
    },
    selectionActions: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    textButton: {
        height: 32,
        paddingHorizontal: 12,
        borderRadius: 16,
        alignItems: 'center',
        justifyContent: 'center',
        marginLeft: 8,
    },
    cancelText: {
        color: colors.Text03,
    },
    primaryButton: {
        backgroundColor: colors.Primary100,
        minWidth: 88,
    },
    primaryButtonText: {
        color: '#ffffff',
    },
})
