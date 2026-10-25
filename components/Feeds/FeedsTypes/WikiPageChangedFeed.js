import React from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { useSelector } from 'react-redux'

import styles, { colors } from '../../styles/global'
import { translate } from '../../../i18n/TranslationService'
import FeedsTypesLeftHeader from '../Commons/FeedsTypesLeftHeader'
import { getFeedCreatorPresentationData } from '../Utils/feedCreatorPresentation'
import { WIKI_FEED_AUTHOR_ID, getWikiFeedTarget } from '../../../functions/KnowledgeBase/knowledgeWikiFeedModel'
import { openProjectWikiChange } from '../../WikiView/wikiLinks'
import { describeWikiChange } from '../../WikiView/wikiChangeText'
import useWikiFeedPageTitle from './useWikiFeedPageTitle'

// One wiki page revision in the Updates feed. The whole line opens what that revision changed.
export default function WikiPageChangedFeed({ feed, projectId, showNewFeedDot, feedActiveTab }) {
    const activeModalInFeed = useSelector(state => state.activeModalInFeed)
    const isMiddleScreen = useSelector(state => state.isMiddleScreen)
    const target = getWikiFeedTarget(feed)
    const pageTitle = useWikiFeedPageTitle(projectId, target?.slug, target?.revision)
    if (!target) return null

    const byWiki = !feed.creatorId || feed.creatorId === WIKI_FEED_AUTHOR_ID
    const name = byWiki
        ? translate('The wiki')
        : getFeedCreatorPresentationData(projectId, feed).shortName || translate('A project member')

    return (
        <TouchableOpacity
            testID={`wiki-feed-${feed.id || `${target.slug}-${target.revision}`}`}
            style={localStyles.button}
            onPress={() => openProjectWikiChange(projectId, target.slug, target.revision)}
            disabled={activeModalInFeed}
            accessible={false}
        >
            <View
                style={[
                    localStyles.feedContainer,
                    showNewFeedDot ? (isMiddleScreen ? { marginLeft: 6 } : { marginLeft: 0 }) : null,
                ]}
            >
                <FeedsTypesLeftHeader
                    projectId={projectId}
                    showNewFeedDot={showNewFeedDot}
                    feedActiveTab={feedActiveTab}
                    feed={feed}
                    icon={byWiki ? 'book-open' : null}
                />
                <Text style={localStyles.entry}>
                    {`${describeWikiChange(target.change, name, pageTitle)} · `}
                    <Text style={localStyles.link}>{translate('Show changes')}</Text>
                </Text>
            </View>
        </TouchableOpacity>
    )
}

const localStyles = StyleSheet.create({
    button: {
        paddingVertical: 1,
    },
    feedContainer: {
        flexDirection: 'row',
        marginLeft: 16,
        flex: 1,
    },
    entry: {
        ...styles.body2,
        color: colors.Text02,
        marginLeft: 4,
        flex: 1,
    },
    link: {
        color: colors.Primary100,
    },
})
