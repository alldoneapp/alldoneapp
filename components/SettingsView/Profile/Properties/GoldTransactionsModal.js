import React, { useEffect, useState } from 'react'
import { Linking, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import moment from 'moment'

import { translate } from '../../../../i18n/TranslationService'
import { loadMoreGoldTransactions, watchGoldTransactions } from '../../../../utils/backends/Users/usersFirestore'
import { MODAL_MAX_HEIGHT_GAP, applyPopoverWidth } from '../../../../utils/HelperFunctions'
import { colors } from '../../../styles/global'
import useWindowSize from '../../../../utils/useWindowSize'
import ModalHeader from '../../../UIComponents/FloatModals/ModalHeader'
import CustomScrollView from '../../../UIControls/CustomScrollView'
import Button from '../../../UIControls/Button'
import styles from '../../../styles/global'
import { getDateFormat, getTimeFormat } from '../../../UIComponents/FloatModals/DateFormatPickerModal'

function getTransactionTimestamp(entry) {
    const createdAt = entry?.createdAt

    if (typeof createdAt?.toMillis === 'function') return createdAt.toMillis()
    if (typeof createdAt?.toDate === 'function') return createdAt.toDate().getTime()
    if (typeof createdAt?.seconds === 'number') return createdAt.seconds * 1000
    if (typeof createdAt?._seconds === 'number') return createdAt._seconds * 1000

    return 0
}

function getTransactionDelta(entry) {
    const balanceBefore = Number(entry?.balanceBefore)
    const balanceAfter = Number(entry?.balanceAfter)

    if (Number.isFinite(balanceBefore) && Number.isFinite(balanceAfter)) {
        return balanceAfter - balanceBefore
    }

    const amount = Number(entry?.amount) || 0
    if (entry?.direction === 'spend') return -amount
    return amount
}

function getTransactionLabel(source) {
    const labels = {
        task_completion: 'Task completion',
        assistant_usage: 'Assistant usage',
        goal_unlock: 'Goal unlock',
        gmail_labeling: 'Gmail labeling',
        gmail_label_follow_up: 'Gmail label follow-up',
        linkedin_enrichment: 'LinkedIn enrichment',
        linkedin_search: 'LinkedIn search',
        monthly_gold: 'Monthly gold',
        gold_pack_purchase: 'Gold pack purchase',
        meeting_transcription: 'Meeting transcription',
        whatsapp_voice: 'WhatsApp voice message',
        iframe_deduction: 'Embedded app deduction',
        iframe_refund: 'Embedded app refund',
        global_search: 'Full search indexing',
        admin_adjustment: 'Admin adjustment',
        manual_refund: 'Gold refund',
        unknown_spend: 'Gold spend',
    }

    return translate(labels[source] || 'Gold transaction')
}

function getTransactionSubtitle(entry) {
    if (entry?.note) return entry.note

    if (entry?.channel === 'gmail') return translate('Triggered from Gmail')
    if (entry?.channel === 'assistant') return translate('Triggered from the assistant')
    if (entry?.channel === 'whatsapp') return translate('Triggered from WhatsApp')
    if (entry?.channel === 'linkedin') return translate('Triggered from LinkedIn')
    if (entry?.channel === 'admin_panel') return translate('Changed from the admin panel')
    if (entry?.channel === 'guides') return translate('Triggered from a guide unlock')

    return ''
}

function getTransactionLink(entry) {
    const projectId = entry?.projectId
    const objectId = entry?.objectId
    const goalId = entry?.goalId
    const channel = entry?.channel
    const source = entry?.source

    if (source === 'goal_unlock' && projectId && goalId) {
        return {
            label: translate('Open goal'),
            url: `${window.location.origin}/projects/${projectId}/goals/${goalId}`,
            external: false,
        }
    }

    if (source === 'linkedin_enrichment' && projectId && objectId) {
        return {
            label: translate('Open contact'),
            url: `${window.location.origin}/projects/${projectId}/contacts/${objectId}`,
            external: false,
        }
    }

    if (channel === 'gmail' && objectId) {
        return {
            label: translate('Open Gmail message'),
            url: `https://mail.google.com/mail/u/0/#all/${encodeURIComponent(objectId)}`,
            external: true,
        }
    }

    if (channel === 'assistant' && projectId && objectId) {
        const objectType = entry?.objectType || 'tasks'
        const urlSegment = objectType === 'topics' ? 'chats' : objectType
        return {
            label: translate('Open chat'),
            url: `${window.location.origin}/projects/${projectId}/${urlSegment}/${objectId}/chat`,
            external: false,
        }
    }

    return null
}

function GoldTransactionItem({ entry, showDivider, closeModal }) {
    const timestamp = getTransactionTimestamp(entry)
    const delta = getTransactionDelta(entry)
    const isPositive = delta >= 0
    const amount = Math.abs(delta || Number(entry?.amount) || 0)
    const balanceAfter = Number(entry?.balanceAfter) || 0
    const link = getTransactionLink(entry)

    const onOpenLink = () => {
        if (!link) return
        if (link.external) {
            Linking.openURL(link.url)
            return
        }
        if (closeModal) closeModal()
        window.location.href = link.url
    }

    return (
        <View style={[localStyles.item, showDivider && localStyles.itemDivider]}>
            <View style={localStyles.itemLeft}>
                <Text style={localStyles.itemTitle}>{getTransactionLabel(entry?.source)}</Text>
                {!!getTransactionSubtitle(entry) && (
                    <Text style={localStyles.itemSubtitle}>{getTransactionSubtitle(entry)}</Text>
                )}
                {!!link && (
                    <TouchableOpacity onPress={onOpenLink}>
                        <Text style={localStyles.itemLink}>{link.label}</Text>
                    </TouchableOpacity>
                )}
                <Text style={localStyles.itemMeta}>
                    {timestamp ? moment(timestamp).format(getTimeFormat(true)) : translate('Pending')}
                </Text>
            </View>
            <View style={localStyles.itemRight}>
                <Text
                    style={[
                        localStyles.itemAmount,
                        { color: isPositive ? colors.UtilityGreen200 : colors.UtilityRed200 },
                    ]}
                >
                    {`${isPositive ? '+' : '-'}${amount}`}
                </Text>
                <Text style={localStyles.itemMeta}>
                    {translate('Balance')}: {Math.floor(balanceAfter)}
                </Text>
            </View>
        </View>
    )
}

export default function GoldTransactionsModal({ userId, closeModal }) {
    const [, height] = useWindowSize()
    const [transactions, setTransactions] = useState([])
    const [lastDoc, setLastDoc] = useState(null)
    const [hasMore, setHasMore] = useState(false)
    const [loading, setLoading] = useState(true)
    const [loadingMore, setLoadingMore] = useState(false)

    useEffect(() => {
        setLoading(true)

        const unsubscribe = watchGoldTransactions(userId, ({ transactions, lastDoc, hasMore }) => {
            setTransactions(transactions)
            setLastDoc(lastDoc)
            setHasMore(hasMore)
            setLoading(false)
        })

        return () => {
            if (unsubscribe) unsubscribe()
        }
    }, [userId])

    const onLoadMore = async () => {
        if (!hasMore || !lastDoc || loadingMore) return

        setLoadingMore(true)

        try {
            const nextPage = await loadMoreGoldTransactions(userId, lastDoc)
            setTransactions(currentTransactions => {
                const transactionIds = new Set(currentTransactions.map(entry => entry.id))
                const mergedTransactions = [...currentTransactions]

                nextPage.transactions.forEach(entry => {
                    if (!transactionIds.has(entry.id)) mergedTransactions.push(entry)
                })

                return mergedTransactions
            })
            setLastDoc(nextPage.lastDoc)
            setHasMore(nextPage.hasMore)
        } finally {
            setLoadingMore(false)
        }
    }

    let currentDay = ''

    return (
        <View style={[localStyles.container, applyPopoverWidth(), { maxHeight: height - MODAL_MAX_HEIGHT_GAP }]}>
            <CustomScrollView style={localStyles.scroll} showsVerticalScrollIndicator={false}>
                <ModalHeader
                    closeModal={closeModal}
                    title={translate('Gold history')}
                    description={translate(
                        'This timeline shows gold transactions recorded after this feature was released'
                    )}
                />

                {loading ? (
                    <Text style={localStyles.infoText}>{translate('Loading gold history...')}</Text>
                ) : transactions.length === 0 ? (
                    <View style={localStyles.emptyState}>
                        <Text style={localStyles.emptyTitle}>{translate('No gold transactions yet')}</Text>
                        <Text style={localStyles.emptyText}>
                            {translate('Your future gold earnings and costs will appear here')}
                        </Text>
                    </View>
                ) : (
                    <>
                        {transactions.map((entry, index) => {
                            const timestamp = getTransactionTimestamp(entry)
                            const dayLabel = timestamp
                                ? moment(timestamp).format(`dddd, ${getDateFormat()}`)
                                : translate('Pending')
                            const showDayHeader = dayLabel !== currentDay

                            if (showDayHeader) currentDay = dayLabel

                            return (
                                <View key={entry.id}>
                                    {showDayHeader && <Text style={localStyles.dayHeader}>{dayLabel}</Text>}
                                    <GoldTransactionItem
                                        entry={entry}
                                        showDivider={index < transactions.length - 1}
                                        closeModal={closeModal}
                                    />
                                </View>
                            )
                        })}

                        {hasMore && (
                            <View style={localStyles.loadMoreContainer}>
                                <Button
                                    title={translate('Load more')}
                                    type={'secondary'}
                                    onPress={onLoadMore}
                                    processing={loadingMore}
                                    processingTitle={translate('Loading')}
                                />
                            </View>
                        )}
                    </>
                )}
            </CustomScrollView>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flexDirection: 'column',
        borderRadius: 4,
        backgroundColor: colors.Secondary400,
        shadowColor: 'rgba(78, 93, 120, 0.56)',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 1,
        shadowRadius: 16,
        elevation: 3,
    },
    scroll: {
        padding: 16,
        minWidth: 320,
    },
    infoText: {
        ...styles.body2,
        color: colors.Text03,
    },
    emptyState: {
        paddingVertical: 8,
    },
    emptyTitle: {
        ...styles.subtitle1,
        color: '#ffffff',
        marginBottom: 8,
    },
    emptyText: {
        ...styles.body2,
        color: colors.Text03,
    },
    dayHeader: {
        ...styles.subtitle2,
        color: colors.Text03,
        marginTop: 8,
        marginBottom: 8,
    },
    item: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        paddingVertical: 12,
    },
    itemDivider: {
        borderBottomWidth: 1,
        borderBottomColor: 'rgba(255,255,255,0.08)',
    },
    itemLeft: {
        flex: 1,
        paddingRight: 16,
    },
    itemRight: {
        alignItems: 'flex-end',
    },
    itemTitle: {
        ...styles.subtitle1,
        color: '#ffffff',
        marginBottom: 4,
    },
    itemSubtitle: {
        ...styles.body2,
        color: colors.Text03,
        marginBottom: 4,
    },
    itemLink: {
        ...styles.body2,
        color: colors.Primary200,
        marginBottom: 4,
        textDecorationLine: 'underline',
    },
    itemAmount: {
        ...styles.subtitle1,
        marginBottom: 4,
    },
    itemMeta: {
        ...styles.caption2,
        color: colors.Text03,
    },
    loadMoreContainer: {
        marginTop: 16,
        alignItems: 'center',
    },
})
