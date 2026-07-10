import React, { useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Dimensions, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { useSelector } from 'react-redux'

import styles, { colors } from '../../../styles/global'
import Icon from '../../../Icon'
import CustomScrollView from '../../../UIControls/CustomScrollView'
import { withWindowSizeHook } from '../../../../utils/useWindowSize'
import { MODAL_MAX_HEIGHT_GAP } from '../../../../utils/HelperFunctions'
import { translate } from '../../../../i18n/TranslationService'
import { getProviderLabel } from '../../../../utils/IntegrationProviders'
import {
    cacheEmailLineSections,
    fetchEmailLineSummary,
    getCachedEmailLineSections,
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
    // Seed from the last-loaded cache so reopening a label shows its emails instantly.
    // Only show the spinner when there's nothing cached to render meanwhile.
    const [sections, setSections] = useState(() => getCachedEmailLineSections(group?.key) || [])
    const [loading, setLoading] = useState(() => !getCachedEmailLineSections(group?.key))
    // Whether a fresh fetch is currently in flight. Cached rows remain usable while this runs;
    // a compact header indicator communicates that they may be momentarily stale.
    const [refreshing, setRefreshing] = useState(true)
    const [loadingMoreKey, setLoadingMoreKey] = useState(null)
    const [selectedIds, setSelectedIds] = useState(() => new Set())
    // Selection keys whose archive/mark-read is in flight: their rows show a spinner and stay
    // put until the action resolves, so the modal can stay open instead of closing.
    const [pendingActionIds, setPendingActionIds] = useState(() => new Set())
    // Connections whose chip counts went stale from a relabel while the modal was open. We flush
    // the summary refresh on close (see handleRelabeled) rather than immediately, so relabeling the
    // last email of a label doesn't unmount its chip — and this popover with it — mid-feedback.
    const pendingSummaryRefreshRef = useRef(new Set())

    const smallScreen = useSelector(state => state.smallScreen)
    const screenWidth = windowSize?.[0] || Dimensions.get('window').width
    const screenHeight = windowSize?.[1] || Dimensions.get('window').height
    const width = Math.min(screenWidth - 32, MODAL_MAX_WIDTH)
    const maxHeight = screenHeight - MODAL_MAX_HEIGHT_GAP

    const entries = group?.entries || []
    // Background refresh: if we already rendered cached rows we keep them on screen
    // (no spinner) and just swap in the fresh results when they arrive.
    const load = async () => {
        if (!getCachedEmailLineSections(group?.key)) setLoading(true)
        setRefreshing(true)
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
                        // A failing account must not blank the modal: keep its cached rows
                        // (if any) rather than wiping them out on a transient error.
                        const cachedSection = getCachedEmailLineSections(group?.key)?.find(
                            item =>
                                item.connectionId === entry.connectionId &&
                                (item.labelId || '') === (entry.labelId || '')
                        )
                        return {
                            ...entry,
                            messages: cachedSection?.messages || [],
                            nextPageToken: cachedSection?.nextPageToken || null,
                        }
                    }
                })
            )
            setSections(results)
            cacheEmailLineSections(group?.key, results)
        } finally {
            setLoading(false)
            setRefreshing(false)
        }
    }

    useEffect(() => {
        // Re-seed from this group's cache before refreshing, so switching labels never
        // flashes the previous label's emails and shows a spinner only when nothing is cached.
        const cached = getCachedEmailLineSections(group?.key)
        setSections(cached || [])
        setLoading(!cached)
        setRefreshing(true)
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
    // section immediately so it leaves the old label — the modal stays open showing the shorter list
    // (or the empty state). The chip-count refresh is deferred until this modal closes: forcing it
    // now can drop this label's count to zero, which unmounts its chip and closes this popover in the
    // middle of giving feedback. See the flush-on-unmount effect below.
    const handleRelabeled = (section, row) => {
        const next = sections.map(item =>
            sectionKey(item) === sectionKey(section)
                ? { ...item, messages: item.messages.filter(message => message.messageId !== row.messageId) }
                : item
        )
        setSections(next)
        cacheEmailLineSections(group?.key, next)
        pendingSummaryRefreshRef.current.add(section.connectionId)
    }

    // Flush the deferred summary refreshes when the modal closes (popover unmounts its content), so
    // chip counts and destination labels catch up without disrupting the open modal.
    useEffect(() => {
        const pending = pendingSummaryRefreshRef.current
        return () => {
            pending.forEach(connectionId => {
                invalidateEmailLineSummaryCooldown(connectionId)
                fetchEmailLineSummary(connectionId, { force: true }).catch(() => {})
            })
            pending.clear()
        }
    }, [])

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
            setSections(previous => {
                const next = previous.map(item =>
                    sectionKey(item) === key
                        ? {
                              ...item,
                              messages: [...item.messages, ...(result?.messages || [])],
                              nextPageToken: result?.nextPageToken || null,
                          }
                        : item
                )
                cacheEmailLineSections(group?.key, next)
                return next
            })
        } finally {
            setLoadingMoreKey(null)
        }
    }

    // Selection-bar actions keep the modal open: the acted-on rows show a per-row spinner,
    // the selection bar collapses, and each connection resolves independently. On success an
    // archived row drops out of the list and a mark-read row loses its unread state. The chip
    // count refresh is deferred to modal close (see handleRelabeled) so archiving a label's
    // last email can't unmount its chip — and this popover — mid-action.
    const runSelectionAction = action => {
        if (selectedIds.size === 0) return
        const keysByConnection = {}
        const messageIdsByConnection = {}
        sections.forEach(section => {
            section.messages.forEach(row => {
                const key = selectionKey(section.connectionId, section.labelId, row.messageId)
                if (!selectedIds.has(key)) return
                if (!messageIdsByConnection[section.connectionId]) {
                    messageIdsByConnection[section.connectionId] = new Set()
                    keysByConnection[section.connectionId] = new Set()
                }
                keysByConnection[section.connectionId].add(key)
                ;(row.messageIds || [row.messageId]).forEach(messageId =>
                    messageIdsByConnection[section.connectionId].add(messageId)
                )
            })
        })

        // Move the selected rows into a loading state and collapse the selection bar.
        setPendingActionIds(previous => {
            const next = new Set(previous)
            Object.values(keysByConnection).forEach(keys => keys.forEach(key => next.add(key)))
            return next
        })
        setSelectedIds(new Set())

        Object.keys(messageIdsByConnection).forEach(connectionId => {
            const keys = keysByConnection[connectionId]
            performEmailLineAction(connectionId, {
                action,
                messageIds: [...messageIdsByConnection[connectionId]],
            })
                .then(() => {
                    setSections(previous => {
                        const next = previous.map(section => {
                            if (section.connectionId !== connectionId) return section
                            if (action === 'archive') {
                                // Archived rows leave the inbox: drop them from the list.
                                return {
                                    ...section,
                                    messages: section.messages.filter(
                                        row =>
                                            !keys.has(
                                                selectionKey(section.connectionId, section.labelId, row.messageId)
                                            )
                                    ),
                                }
                            }
                            // Mark-read keeps the row but clears its unread dot/bold state.
                            return {
                                ...section,
                                messages: section.messages.map(row =>
                                    keys.has(selectionKey(section.connectionId, section.labelId, row.messageId))
                                        ? { ...row, isUnread: false }
                                        : row
                                ),
                            }
                        })
                        cacheEmailLineSections(group?.key, next)
                        return next
                    })
                    pendingSummaryRefreshRef.current.add(connectionId)
                })
                .catch(error => {
                    // Leave the rows in place on failure so nothing silently vanishes.
                    if (__DEV__)
                        console.warn('[EmailLine] Background selection action failed:', error?.message || error)
                })
                .finally(() => {
                    setPendingActionIds(previous => {
                        const next = new Set(previous)
                        keys.forEach(key => next.delete(key))
                        return next
                    })
                })
        })
    }

    // Sweeps close the modal immediately and continue in the background: counts are
    // optimistically zeroed and the chip shows a spinner until the summary refreshes.
    const runSweep = action => {
        closePopover()
        // Archive-all empties the label, so clear its cached rows now — reopening shows the
        // empty state instantly instead of flashing the about-to-be-archived list.
        if (action === 'archiveAll') {
            cacheEmailLineSections(
                group?.key,
                sections.map(section => ({ ...section, messages: [] }))
            )
        }
        entries.forEach(entry => {
            performEmailLineSweepInBackground(entry.connectionId, entry.labelId, action)
        })
    }

    const selectedCount = selectedIds.size
    const totalMessages = sections.reduce((total, section) => total + section.messages.length, 0)
    const labelingDisabled = entries.some(entry => labelingDisabledByConnectionId?.[entry.connectionId])

    // The empty state offers one link per connected account. A group can hold more than one entry
    // for the same account (two labels whose display names collapse to the same leaf, e.g.
    // "Clients/Acme" and "Acme"), so dedupe by connection instead of listing an entry each.
    const accountEntries = []
    const seenConnectionIds = new Set()
    entries.forEach(entry => {
        if (seenConnectionIds.has(entry.connectionId)) return
        seenConnectionIds.add(entry.connectionId)
        accountEntries.push(entry)
    })

    // A blocking spinner is only needed on the first load. On subsequent opens, stale rows are
    // more useful than an empty modal while the background refresh catches up with the chip.
    const showLoading = loading

    const allSelectionKeys = sections
        .flatMap(section =>
            section.messages.map(row => selectionKey(section.connectionId, section.labelId, row.messageId))
        )
        .filter(key => !pendingActionIds.has(key))
    const allSelected = allSelectionKeys.length > 0 && allSelectionKeys.every(key => selectedIds.has(key))
    const toggleSelectAll = () => {
        setSelectedIds(() => (allSelected ? new Set() : new Set(allSelectionKeys)))
    }

    return (
        <View style={[localStyles.container, smallScreen && localStyles.containerMobile, { width, maxHeight }]}>
            <View style={localStyles.header}>
                <Text style={[styles.title6, localStyles.title]} numberOfLines={1}>
                    {group.displayName}
                </Text>
                {refreshing && !loading && (
                    <View style={localStyles.refreshing} accessibilityLabel={translate('Refreshing emails')}>
                        <ActivityIndicator size="small" color={colors.Text03} />
                        <Text style={[styles.caption2, localStyles.refreshingText]}>{translate('Refreshing')}</Text>
                    </View>
                )}
                <TouchableOpacity onPress={closePopover} accessibilityLabel={translate('Close')}>
                    <Icon name="x" size={20} color={colors.Text03} />
                </TouchableOpacity>
            </View>

            <View style={[localStyles.sweepBar, smallScreen && localStyles.sweepBarMobile]}>
                <TouchableOpacity
                    style={[localStyles.sweepButton, smallScreen && localStyles.sweepButtonMobile]}
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
                    style={[localStyles.sweepButton, smallScreen && localStyles.sweepButtonMobile]}
                    onPress={() => runSweep('archiveAll')}
                    disabled={totalMessages === 0}
                >
                    <Icon name="archive" size={14} color={colors.Text03} />
                    <Text style={[styles.caption1, localStyles.sweepText]}>{translate('Archive all')}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                    style={[localStyles.sweepButton, smallScreen && localStyles.sweepButtonMobile]}
                    onPress={() => runSweep('markAllRead')}
                >
                    <Icon name="check" size={14} color={colors.Text03} />
                    <Text style={[styles.caption1, localStyles.sweepText]}>{translate('Mark all read')}</Text>
                </TouchableOpacity>
            </View>

            <CustomScrollView style={localStyles.list} showsVerticalScrollIndicator={false}>
                {showLoading ? (
                    <View style={localStyles.centered}>
                        <ActivityIndicator color={colors.Primary100} />
                    </View>
                ) : totalMessages === 0 ? (
                    <View style={localStyles.centered}>
                        <Text style={[styles.body2, localStyles.emptyText]}>
                            {translate('No emails in inbox with this label')}
                        </Text>
                        {accountEntries.map(entry => (
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
                                    currentLabelName={section.label?.name || section.label?.displayName || ''}
                                    selected={selectedIds.has(
                                        selectionKey(section.connectionId, section.labelId, row.messageId)
                                    )}
                                    pending={pendingActionIds.has(
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
    containerMobile: {
        paddingHorizontal: 12,
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
    refreshing: {
        flexDirection: 'row',
        alignItems: 'center',
        marginRight: 12,
    },
    refreshingText: {
        color: colors.Text03,
        marginLeft: 4,
    },
    sweepBar: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 4,
    },
    sweepBarMobile: {
        flexWrap: 'wrap',
    },
    sweepButton: {
        height: 28,
        paddingHorizontal: 4,
        flexDirection: 'row',
        alignItems: 'center',
        marginRight: 16,
    },
    sweepButtonMobile: {
        marginRight: 12,
        marginBottom: 4,
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
