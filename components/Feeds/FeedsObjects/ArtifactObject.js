import React from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { useSelector } from 'react-redux'

import styles, { colors } from '../../styles/global'
import Icon from '../../Icon'
import { translate } from '../../../i18n/TranslationService'
import RegularFeed from '../FeedsTypes/RegularFeed'
import { openProjectArtifacts } from '../../ArtifactsView/artifactLinks'

// One artifact's changes of a day in Updates (functions/Artifacts/artifactFeeds.js): the artifact as
// a header that opens it, then one line per change. Every line is a plain entry text written by the
// server, "Karsten Wysk (via Claude) saved version 3 • Adds Q3".
export default function ArtifactObject({ feedObjectData, projectId, feedActiveTab, style }) {
    const activeModalInFeed = useSelector(state => state.activeModalInFeed)
    const { object, feeds } = feedObjectData
    const { name, isDeleted, isPrivate, lastChangeDate } = object
    const artifactId = object.artifactId || object.id

    return (
        <View testID="artifact-feed-object" style={style}>
            <TouchableOpacity
                testID="artifact-feed-header"
                style={localStyles.header}
                onPress={() => openProjectArtifacts(projectId, artifactId)}
                disabled={activeModalInFeed || isDeleted === true}
                accessibilityRole="button"
                accessibilityHint={translate('Open artifact')}
            >
                <Icon name={isDeleted ? 'trash-2' : 'package'} color={colors.Text03} size={24} />
                <Text style={localStyles.title} numberOfLines={3}>
                    {name || translate('Artifact')}
                </Text>
                {isPrivate && <Icon name="lock" size={16} color={colors.Text03} style={localStyles.lock} />}
            </TouchableOpacity>
            <View>
                {feeds.map((feed, index) => (
                    <View key={feed.id} style={[localStyles.margin, index !== 0 ? localStyles.feed : null]}>
                        <RegularFeed
                            feed={feed}
                            projectId={projectId}
                            lastChangeDateObject={lastChangeDate}
                            showNewFeedDot={feed.showLikeNew}
                            feedActiveTab={feedActiveTab}
                        />
                    </View>
                ))}
            </View>
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
    lock: {
        marginLeft: 8,
    },
    feed: {
        marginTop: 8,
    },
    margin: {
        marginLeft: -16,
    },
})
