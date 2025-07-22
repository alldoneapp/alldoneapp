import React, { useState } from 'react'
import { View, StyleSheet, Text } from 'react-native'
import { TouchableOpacity } from 'react-native-gesture-handler'
import { useSelector } from 'react-redux'

import styles, { colors } from '../../styles/global'
import FeedsTypesLeftHeader from '../Commons/FeedsTypesLeftHeader'
import MultilineParser from '../TextParser/MultilineParser'
import LinealParser from '../TextParser/LinealParser'
import {
    generatorParserCustomElement,
    generatorParserImageElement,
    generatorParserTextElement,
} from '../Utils/HelperFunctions'
import LinkTag from '../../Tags/LinkTag'
import ContactsHelper, { getUserPresentationDataInProject } from '../../ContactsView/Utils/ContactsHelper'

export default function BacklinkFeed({ feed, projectId, showNewFeedDot, feedActiveTab, lastChangeDateObject }) {
    const activeModalInFeed = useSelector(state => state.activeModalInFeed)
    const isMiddleScreen = useSelector(state => state.isMiddleScreen)
    const [width, setWidth] = useState(0)
    const { entryText, linkTag, creatorId } = feed
    const elementsData = []

    const { photoURL, shortName } = getUserPresentationDataInProject(projectId, creatorId)

    const navigateToUserDv = () => {
        ContactsHelper.navigateToUserProfile(projectId, creatorId)
    }

    const onLayout = ({ nativeEvent }) => {
        const { width } = nativeEvent.layout
        setWidth(width)
    }

    const parseFeed = () => {
        const avatar = generatorParserImageElement(localStyles.avatar, photoURL)
        elementsData.push(avatar)

        const entry = generatorParserTextElement(
            [localStyles.entry, { overflow: 'hidden' }],
            `${shortName} ${entryText}`
        )
        elementsData.push(entry)

        const link = generatorParserCustomElement(<LinkTag link={linkTag} inFeedComment={true} />)
        elementsData.push(link)
    }

    parseFeed()

    const FeedModel = () => (
        <View
            onLayout={onLayout}
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
            {entryText ? (
                <LinealParser parentWidth={width} dotsStyle={styles.entry} innerFeed={true}>
                    <Text style={localStyles.entry}>{`${shortName} ${entryText}`}</Text>
                    <LinkTag link={linkTag} useCommentTagStyle={true} />
                </LinealParser>
            ) : null}
        </View>
    )

    return (
        <TouchableOpacity style={localStyles.button} onPress={navigateToUserDv} disabled={activeModalInFeed}>
            <FeedModel />
        </TouchableOpacity>
    )
}

const localStyles = StyleSheet.create({
    feedContainer: {
        flexDirection: 'row',
        marginLeft: 16,
        flex: 1,
    },
    button: {
        paddingVertical: 1,
    },
    entry: {
        ...styles.body2,
        color: colors.Text02,
        marginLeft: 4,
    },
    avatar: {
        borderRadius: 100,
        height: 20,
        width: 20,
    },
})
