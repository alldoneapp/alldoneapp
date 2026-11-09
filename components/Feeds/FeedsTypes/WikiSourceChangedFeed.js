import React from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { useSelector } from 'react-redux'

import styles, { colors } from '../../styles/global'
import { translate } from '../../../i18n/TranslationService'
import FeedsTypesLeftHeader from '../Commons/FeedsTypesLeftHeader'
import { getFeedCreatorPresentationData } from '../Utils/feedCreatorPresentation'
import { getWikiSourceChange } from '../../../functions/KnowledgeBase/knowledgeWikiFeedModel'
import { openProjectWiki } from '../../WikiView/wikiLinks'

// A source a member handed the wiki or took back (a document, saved knowledge). The line carries
// nothing of the source itself (see knowledgeWikiFeedModel.js), so it names the kind of change only
// and opens the wiki, where the pages it changed will show it.
export default function WikiSourceChangedFeed({ feed, projectId, showNewFeedDot, feedActiveTab }) {
    const activeModalInFeed = useSelector(state => state.activeModalInFeed)
    const isMiddleScreen = useSelector(state => state.isMiddleScreen)
    const kind = getWikiSourceChange(feed)
    if (!kind) return null

    const name = getFeedCreatorPresentationData(projectId, feed).shortName || translate('A project member')

    return (
        <TouchableOpacity
            testID={`wiki-source-feed-${feed.id || kind}`}
            style={localStyles.button}
            onPress={() => openProjectWiki(projectId)}
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
                />
                <Text style={localStyles.entry}>{translate(`Wiki source ${kind}`, { name })}</Text>
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
})
