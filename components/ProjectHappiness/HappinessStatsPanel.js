import React from 'react'
import { StyleSheet, Text, View } from 'react-native'

import styles, { colors } from '../styles/global'
import { translate } from '../../i18n/TranslationService'
import store from '../../redux/store'
import {
    getGlobalHappinessStats,
    getHappinessDateText,
    getHappinessRatingText,
    getHappinessStats,
    HAPPINESS_EMOJIS,
    HAPPINESS_SCALE,
} from '../../utils/ProjectHappinessHelper'

const formatAverage = average => (average ? average.toFixed(1) : '0.0')

function SummaryItem({ label, value }) {
    return (
        <View style={localStyles.summaryItem}>
            <Text style={localStyles.summaryLabel}>{translate(label)}</Text>
            <Text style={localStyles.summaryValue}>{value}</Text>
        </View>
    )
}

function Distribution({ distribution, total }) {
    return (
        <View style={localStyles.section}>
            <Text style={localStyles.sectionTitle}>{translate('Happiness distribution')}</Text>
            {HAPPINESS_SCALE.map(rating => {
                const amount = distribution[rating] || 0
                const width = total ? `${Math.max((amount / total) * 100, amount ? 8 : 0)}%` : '0%'
                return (
                    <View key={rating} style={localStyles.distributionRow}>
                        <Text style={localStyles.distributionLabel}>{HAPPINESS_EMOJIS[rating]}</Text>
                        <View style={localStyles.distributionTrack}>
                            <View style={[localStyles.distributionBar, { width }]} />
                        </View>
                        <Text style={localStyles.distributionAmount}>{amount}</Text>
                    </View>
                )
            })}
        </View>
    )
}

function Trend({ entries }) {
    const trendEntries = entries
        .filter(entry => entry.rating)
        .sort((a, b) => a.timestamp - b.timestamp)
        .slice(-14)

    return (
        <View style={localStyles.section}>
            <Text style={localStyles.sectionTitle}>{translate('Happiness trend')}</Text>
            {trendEntries.length > 0 ? (
                <View style={localStyles.trend}>
                    {trendEntries.map(entry => (
                        <View key={`${entry.projectId || ''}${entry.dateKey}`} style={localStyles.trendItem}>
                            <View style={localStyles.trendBarTrack}>
                                <View style={[localStyles.trendBar, { height: `${(entry.rating / 5) * 100}%` }]} />
                            </View>
                            <Text style={localStyles.trendEmoji}>{HAPPINESS_EMOJIS[entry.rating]}</Text>
                        </View>
                    ))}
                </View>
            ) : (
                <Text style={localStyles.emptyText}>{translate('No happiness data yet')}</Text>
            )}
        </View>
    )
}

function RecentComments({ entries, isGlobal }) {
    const projectsById = store.getState().loggedUserProjects.reduce((acc, project) => {
        acc[project.id] = project
        return acc
    }, {})
    const comments = entries
        .filter(entry => entry.rating && entry.comment)
        .sort((a, b) => b.timestamp - a.timestamp)
        .slice(0, 10)

    if (comments.length === 0) return null

    return (
        <View style={localStyles.section}>
            <Text style={localStyles.sectionTitle}>{translate('Recent happiness notes')}</Text>
            {comments.map(entry => (
                <View key={`comment-${entry.projectId || ''}${entry.dateKey}`} style={localStyles.commentRow}>
                    <Text style={localStyles.commentMeta}>
                        {isGlobal && projectsById[entry.projectId] ? `${projectsById[entry.projectId].name} • ` : ''}
                        {getHappinessDateText(entry.timestamp)} · {getHappinessRatingText(entry.rating)}
                    </Text>
                    <Text style={localStyles.commentText}>{entry.comment}</Text>
                </View>
            ))}
        </View>
    )
}

export default function HappinessStatsPanel({
    entries = [],
    happinessByProject = null,
    showRecentComments = true,
    showTitle = true,
}) {
    const isGlobal = !!happinessByProject
    const globalStats = isGlobal ? getGlobalHappinessStats(happinessByProject) : null
    const stats = isGlobal ? globalStats : getHappinessStats(entries)
    const trendEntries = isGlobal ? Object.values(happinessByProject).flat() : entries
    const latest = isGlobal
        ? trendEntries.filter(entry => entry.rating).sort((a, b) => b.timestamp - a.timestamp)[0]
        : stats.latest

    return (
        <View style={localStyles.container}>
            {showTitle && <Text style={localStyles.title}>{translate('Happiness')}</Text>}
            <View style={localStyles.summary}>
                <SummaryItem label="Average" value={`${formatAverage(stats.average)}/5`} />
                <SummaryItem label="Latest" value={latest ? getHappinessRatingText(latest.rating) : '-'} />
                <SummaryItem label="Tracked days" value={stats.trackedDays} />
                {isGlobal && <SummaryItem label="Projects" value={stats.projectsTracked} />}
            </View>
            {latest && (
                <Text style={localStyles.latestText}>
                    {translate('Latest rating')}: {getHappinessDateText(latest.timestamp)}
                </Text>
            )}
            <Distribution distribution={stats.distribution} total={stats.trackedDays} />
            <Trend entries={trendEntries} />
            {showRecentComments && <RecentComments entries={trendEntries} isGlobal={isGlobal} />}
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        marginTop: 24,
        marginBottom: 24,
    },
    title: {
        ...styles.title6,
        color: colors.Text01,
        marginBottom: 12,
    },
    summary: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        marginHorizontal: -4,
    },
    summaryItem: {
        minWidth: 140,
        flex: 1,
        borderWidth: 1,
        borderColor: colors.Grey200,
        borderRadius: 4,
        padding: 12,
        margin: 4,
    },
    summaryLabel: {
        ...styles.body2,
        color: colors.Text03,
    },
    summaryValue: {
        ...styles.title6,
        color: colors.Text01,
        marginTop: 4,
    },
    latestText: {
        ...styles.body2,
        color: colors.Text03,
        marginTop: 8,
    },
    section: {
        marginTop: 16,
    },
    sectionTitle: {
        ...styles.subtitle2,
        color: colors.Text02,
        marginBottom: 8,
    },
    distributionRow: {
        flexDirection: 'row',
        alignItems: 'center',
        height: 28,
    },
    distributionLabel: {
        width: 32,
        ...styles.body1,
    },
    distributionTrack: {
        flex: 1,
        height: 8,
        borderRadius: 4,
        backgroundColor: colors.Grey200,
        overflow: 'hidden',
    },
    distributionBar: {
        height: 8,
        borderRadius: 4,
        backgroundColor: colors.Primary300,
    },
    distributionAmount: {
        ...styles.body2,
        color: colors.Text03,
        width: 32,
        textAlign: 'right',
    },
    trend: {
        height: 120,
        flexDirection: 'row',
        alignItems: 'flex-end',
        borderBottomWidth: 1,
        borderColor: colors.Grey200,
    },
    trendItem: {
        width: 28,
        alignItems: 'center',
        marginRight: 6,
    },
    trendBarTrack: {
        width: 16,
        height: 88,
        justifyContent: 'flex-end',
        backgroundColor: colors.Grey200,
        borderRadius: 4,
        overflow: 'hidden',
    },
    trendBar: {
        width: 16,
        backgroundColor: colors.Primary300,
    },
    trendEmoji: {
        ...styles.caption2,
        marginTop: 4,
    },
    emptyText: {
        ...styles.body2,
        color: colors.Text03,
    },
    commentRow: {
        borderTopWidth: 1,
        borderColor: colors.Grey200,
        paddingVertical: 8,
    },
    commentMeta: {
        ...styles.body2,
        color: colors.Text03,
        marginBottom: 4,
    },
    commentText: {
        ...styles.body1,
        color: colors.Text01,
    },
})
