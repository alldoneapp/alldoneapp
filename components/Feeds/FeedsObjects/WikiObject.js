import React from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { useSelector } from 'react-redux'

import styles, { colors } from '../../styles/global'
import Icon from '../../Icon'
import { translate } from '../../../i18n/TranslationService'
import { openProjectWiki } from '../../WikiView/wikiLinks'
import WikiPageChangedFeed from '../FeedsTypes/WikiPageChangedFeed'

// The project wiki in the Updates feed: one card per day, one line per page revision (see
// functions/KnowledgeBase/knowledgeWikiFeedModel.js). The header opens the wiki, a line opens the
// change it stands for.
export default function WikiObject({ feedObjectData, projectId, feedActiveTab, style }) {
    const activeModalInFeed = useSelector(state => state.activeModalInFeed)
    const { feeds } = feedObjectData

    return (
        <View testID="wiki-feed-object" style={style}>
            <TouchableOpacity
                testID="wiki-feed-header"
                style={localStyles.header}
                onPress={() => openProjectWiki(projectId)}
                disabled={activeModalInFeed}
                accessible={false}
            >
                <Icon name="book-open" color={colors.Text03} size={24} />
                <Text style={localStyles.title} numberOfLines={1}>
                    {translate('Project wiki')}
                </Text>
            </TouchableOpacity>
            {feeds.map((feed, index) => (
                <View key={feed.id} style={[localStyles.margin, index !== 0 ? localStyles.feed : null]}>
                    <WikiPageChangedFeed
                        feed={feed}
                        projectId={projectId}
                        showNewFeedDot={feed.showLikeNew}
                        feedActiveTab={feedActiveTab}
                    />
                </View>
            ))}
        </View>
    )
}

const localStyles = StyleSheet.create({
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 8,
    },
    title: {
        ...styles.body1,
        color: colors.Text01,
        paddingLeft: 12,
        flex: 1,
    },
    feed: {
        marginTop: 8,
    },
    margin: {
        marginLeft: -16,
    },
})
