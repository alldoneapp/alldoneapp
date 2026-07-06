import React, { useEffect, useState } from 'react'
import { ActivityIndicator, Dimensions, StyleSheet, Text, TouchableOpacity, View } from 'react-native'

import styles, { colors } from '../../../styles/global'
import Icon from '../../../Icon'
import CustomScrollView from '../../../UIControls/CustomScrollView'
import { withWindowSizeHook } from '../../../../utils/useWindowSize'
import { MODAL_MAX_HEIGHT_GAP } from '../../../../utils/HelperFunctions'
import { translate } from '../../../../i18n/TranslationService'
import { listEmailLineMessages, performEmailLineAction } from '../../../../utils/backends/EmailLine/emailLineBackend'
import { getLabelWebUrl, openUrlInNewTab } from '../emailLineHelper'
import EmailRow from './EmailRow'

const MODAL_MAX_WIDTH = 560

function EmailLabelModal({
    projectId,
    label,
    provider,
    emailAddress,
    labelingDisabled,
    labelOptions,
    closePopover,
    windowSize,
}) {
    const [messages, setMessages] = useState([])
    const [nextPageToken, setNextPageToken] = useState(null)
    const [loading, setLoading] = useState(true)
    const [loadingMore, setLoadingMore] = useState(false)
    const [selectedIds, setSelectedIds] = useState(() => new Set())
    const [busyAction, setBusyAction] = useState(null)

    const screenWidth = windowSize?.[0] || Dimensions.get('window').width
    const screenHeight = windowSize?.[1] || Dimensions.get('window').height
    const width = Math.min(screenWidth - 32, MODAL_MAX_WIDTH)
    const maxHeight = screenHeight - MODAL_MAX_HEIGHT_GAP

    const load = async () => {
        setLoading(true)
        try {
            const result = await listEmailLineMessages(projectId, label.labelId)
            setMessages(result?.messages || [])
            setNextPageToken(result?.nextPageToken || null)
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        load()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [label.labelId])

    const toggleSelect = row => {
        setSelectedIds(previous => {
            const next = new Set(previous)
            next.has(row.messageId) ? next.delete(row.messageId) : next.add(row.messageId)
            return next
        })
    }

    const openRow = row => {
        openUrlInNewTab(row.webUrl || getLabelWebUrl(provider, emailAddress, label))
    }

    const loadMore = async () => {
        if (!nextPageToken || loadingMore) return
        setLoadingMore(true)
        try {
            const result = await listEmailLineMessages(projectId, label.labelId, { pageToken: nextPageToken })
            setMessages(previous => [...previous, ...(result?.messages || [])])
            setNextPageToken(result?.nextPageToken || null)
        } finally {
            setLoadingMore(false)
        }
    }

    const runSelectionAction = async action => {
        const messageIds = [...selectedIds]
        if (messageIds.length === 0) return
        setBusyAction(action)
        try {
            await performEmailLineAction(projectId, { action, messageIds })
            setMessages(previous => previous.filter(message => !selectedIds.has(message.messageId)))
            setSelectedIds(new Set())
        } finally {
            setBusyAction(null)
        }
    }

    const runSweep = async action => {
        setBusyAction(action)
        try {
            await performEmailLineAction(projectId, { action, labelId: label.labelId })
            setSelectedIds(new Set())
            await load()
        } finally {
            setBusyAction(null)
        }
    }

    const selectedCount = selectedIds.size
    const isBusy = !!busyAction

    return (
        <View style={[localStyles.container, { width, maxHeight }]}>
            <View style={localStyles.header}>
                <Text style={[styles.title6, localStyles.title]} numberOfLines={1}>
                    {label.displayName}
                </Text>
                <TouchableOpacity onPress={closePopover} accessibilityLabel={translate('Close')}>
                    <Icon name="x" size={20} color={colors.Text03} />
                </TouchableOpacity>
            </View>

            <View style={localStyles.sweepBar}>
                <TouchableOpacity
                    style={localStyles.sweepButton}
                    onPress={() => runSweep('archiveAll')}
                    disabled={isBusy || messages.length === 0}
                >
                    {busyAction === 'archiveAll' ? (
                        <ActivityIndicator size="small" color={colors.Text03} />
                    ) : (
                        <Icon name="archive" size={14} color={colors.Text03} />
                    )}
                    <Text style={[styles.caption1, localStyles.sweepText]}>{translate('Archive all')}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                    style={localStyles.sweepButton}
                    onPress={() => runSweep('markAllRead')}
                    disabled={isBusy}
                >
                    {busyAction === 'markAllRead' ? (
                        <ActivityIndicator size="small" color={colors.Text03} />
                    ) : (
                        <Icon name="check" size={14} color={colors.Text03} />
                    )}
                    <Text style={[styles.caption1, localStyles.sweepText]}>{translate('Mark all read')}</Text>
                </TouchableOpacity>
            </View>

            <CustomScrollView style={localStyles.list} showsVerticalScrollIndicator={false}>
                {loading ? (
                    <View style={localStyles.centered}>
                        <ActivityIndicator color={colors.Primary100} />
                    </View>
                ) : messages.length === 0 ? (
                    <View style={localStyles.centered}>
                        <Text style={[styles.body2, localStyles.emptyText]}>
                            {translate('No emails in inbox with this label')}
                        </Text>
                        <TouchableOpacity
                            style={localStyles.openInProviderButton}
                            onPress={() => openUrlInNewTab(getLabelWebUrl(provider, emailAddress, label))}
                        >
                            <Icon name="external-link" size={14} color={colors.Primary100} />
                            <Text style={[styles.subtitle2, localStyles.openInProviderText]}>
                                {translate(provider === 'microsoft' ? 'Open in Outlook' : 'Open in Gmail')}
                            </Text>
                        </TouchableOpacity>
                    </View>
                ) : (
                    <>
                        {messages.map(row => (
                            <EmailRow
                                key={row.messageId}
                                row={row}
                                projectId={projectId}
                                labelOptions={labelOptions}
                                selected={selectedIds.has(row.messageId)}
                                onToggleSelect={toggleSelect}
                                onOpen={openRow}
                            />
                        ))}
                        {nextPageToken && (
                            <TouchableOpacity style={localStyles.loadMore} onPress={loadMore} disabled={loadingMore}>
                                {loadingMore ? (
                                    <ActivityIndicator color={colors.Primary100} />
                                ) : (
                                    <Text style={[styles.subtitle2, localStyles.loadMoreText]}>
                                        {translate('Load more')}
                                    </Text>
                                )}
                            </TouchableOpacity>
                        )}
                    </>
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
                        <TouchableOpacity
                            style={localStyles.textButton}
                            onPress={() => runSelectionAction('markRead')}
                            disabled={isBusy}
                        >
                            <Text style={[styles.subtitle2, localStyles.cancelText]}>{translate('Mark read')}</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                            style={[localStyles.textButton, localStyles.primaryButton]}
                            onPress={() => runSelectionAction('archive')}
                            disabled={isBusy}
                        >
                            {busyAction === 'archive' ? (
                                <ActivityIndicator size="small" color="#ffffff" />
                            ) : (
                                <Text style={[styles.subtitle2, localStyles.primaryButtonText]}>
                                    {translate('Archive')}
                                </Text>
                            )}
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
    },
    openInProviderText: {
        color: colors.Primary100,
        marginLeft: 6,
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
