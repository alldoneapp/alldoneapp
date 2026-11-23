import React, { useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'

import styles, { colors } from '../styles/global'
import Icon from '../Icon'
import Button from '../UIControls/Button'
import { translate } from '../../i18n/TranslationService'
import { dismissKnowledgeNewsItem } from '../../utils/backends/KnowledgeBase/knowledgeBaseFirestore'
import { formatWikiDate, useKnowledgeNewsItems } from './useKnowledgeBase'
import { NEWS_ACTIVE_WINDOW_DAYS, DAY_MS, toNewsScreeningView } from '../../functions/KnowledgeBase/knowledgeNewsModel'

// What the news page (AT-3126) shows above its text: that it is external content, when the screening
// last looked (also on quiet days, when the page itself does not change) and whether it is paused.
export function WikiNewsNotice({ knowledgeBase }) {
    const news = toNewsScreeningView(knowledgeBase || {})
    const lines = [translate('External news notice')]
    if (news.lastRunAt) lines.push(translate('News screening last checked', { date: formatWikiDate(news.lastRunAt) }))
    if (news.pausedSince !== null && news.lastRunAt) {
        lines.push(
            news.hiddenFromAssistants
                ? translate('News screening paused and hidden', { date: formatWikiDate(news.pausedSince) })
                : translate('News screening paused', {
                      date: formatWikiDate(news.pausedSince),
                      cutoff: formatWikiDate(news.assistantCutoffAt),
                  })
        )
    }
    return (
        <View testID="wiki-news-notice" style={localStyles.notice}>
            <Icon name="globe" size={16} color={colors.Text03} />
            <View style={localStyles.noticeText}>
                {lines.map(line => (
                    <Text key={line} style={localStyles.noticeLine}>
                        {line}
                    </Text>
                ))}
            </View>
        </View>
    )
}

// "Not relevant" per entry of the last 30 days: the entry leaves the page and becomes a
// counter-example for the next nights. Any member may use it.
export default function WikiNewsPanel({ projectId }) {
    const items = useKnowledgeNewsItems(projectId)
    const [pending, setPending] = useState(null)
    const [error, setError] = useState(false)
    const since = Date.now() - NEWS_ACTIVE_WINDOW_DAYS * DAY_MS
    const recent = items.filter(item => Number(item.lastEventAt || item.publishedAt) >= since)
    if (!recent.length) return null

    const dismiss = async itemId => {
        setPending(itemId)
        setError(false)
        try {
            await dismissKnowledgeNewsItem(projectId, itemId)
        } catch (failure) {
            setError(true)
        } finally {
            setPending(null)
        }
    }

    return (
        <View testID="wiki-news-panel" style={localStyles.panel}>
            <Text style={localStyles.sectionLabel}>{translate('News entries')}</Text>
            {recent.map(item => (
                <View key={item.id} style={localStyles.itemRow}>
                    <Text style={localStyles.itemTitle} numberOfLines={2}>
                        {item.title}
                    </Text>
                    <Button
                        type={'ghost'}
                        icon={'thumbs-down'}
                        iconSize={16}
                        title={translate('Not relevant')}
                        disabled={pending !== null}
                        onPress={() => dismiss(item.id)}
                        accessibilityLabel={translate('Mark news entry not relevant')}
                    />
                </View>
            ))}
            {error && (
                <Text style={[localStyles.noticeLine, localStyles.error]}>{translate('News entry not removed')}</Text>
            )}
        </View>
    )
}

const localStyles = StyleSheet.create({
    notice: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        borderWidth: 1,
        borderColor: colors.Grey300,
        borderRadius: 4,
        padding: 8,
        marginBottom: 12,
    },
    noticeText: {
        marginLeft: 8,
        flex: 1,
    },
    noticeLine: {
        ...styles.caption2,
        color: colors.Text03,
    },
    panel: {
        marginTop: 16,
    },
    sectionLabel: {
        ...styles.overline,
        color: colors.Text03,
        marginBottom: 8,
    },
    itemRow: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 4,
        borderBottomWidth: 1,
        borderBottomColor: colors.Grey200,
    },
    itemTitle: {
        ...styles.body2,
        color: colors.Text02,
        flex: 1,
        marginRight: 8,
    },
    error: {
        color: colors.UtilityRed200,
    },
})
