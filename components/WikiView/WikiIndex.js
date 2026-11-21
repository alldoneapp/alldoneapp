import React from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'

import styles, { colors } from '../styles/global'
import { translate } from '../../i18n/TranslationService'
import { formatWikiDate } from './useKnowledgeBase'

/**
 * A wiki's pages as rows: title, summary and when each page was last updated. The project wiki lists
 * them all; the All projects wiki (AT-3121) the newest few of each project.
 */
export default function WikiIndex({ pages, selectedSlug = null, onSelect, testIdPrefix = 'wiki-index' }) {
    if (pages.length === 0) {
        return (
            <Text testID="wiki-search-empty" style={localStyles.searchEmpty}>
                {translate('No wiki pages match your search')}
            </Text>
        )
    }
    return (
        <View testID={testIdPrefix}>
            {pages.map(page => {
                const selected = page.slug === selectedSlug
                return (
                    <TouchableOpacity
                        key={page.slug}
                        testID={`${testIdPrefix}-${page.slug}`}
                        style={[localStyles.indexItem, selected && localStyles.indexItemSelected]}
                        onPress={() => onSelect(page.slug)}
                        accessible={false}
                    >
                        <Text style={[localStyles.indexTitle, selected && localStyles.indexTitleSelected]}>
                            {page.title}
                        </Text>
                        {!!page.summary && (
                            <Text style={localStyles.indexSummary} numberOfLines={2}>
                                {page.summary}
                            </Text>
                        )}
                        {!!page.updatedAt && (
                            <Text testID={`${testIdPrefix}-updated-${page.slug}`} style={localStyles.indexUpdated}>
                                {translate('Wiki page last updated', { date: formatWikiDate(page.updatedAt) })}
                            </Text>
                        )}
                    </TouchableOpacity>
                )
            })}
        </View>
    )
}

const localStyles = StyleSheet.create({
    searchEmpty: {
        ...styles.body2,
        color: colors.Text02,
        paddingVertical: 16,
        paddingHorizontal: 12,
    },
    indexItem: {
        paddingVertical: 8,
        paddingHorizontal: 12,
        borderRadius: 4,
        marginBottom: 2,
    },
    indexItemSelected: {
        backgroundColor: colors.Grey200,
    },
    indexTitle: {
        ...styles.subtitle2,
        color: colors.Text01,
    },
    indexTitleSelected: {
        color: colors.Primary100,
    },
    indexSummary: {
        ...styles.caption2,
        color: colors.Text03,
        marginTop: 2,
    },
    indexUpdated: {
        ...styles.caption2,
        color: colors.Text03,
        marginTop: 2,
    },
})
