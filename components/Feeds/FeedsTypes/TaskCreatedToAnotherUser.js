import React, { useState } from 'react'
import { View, StyleSheet } from 'react-native'
import { TouchableOpacity } from 'react-native-gesture-handler'
import { useSelector } from 'react-redux'

import styles, { colors } from '../../styles/global'
import FeedsTypesLeftHeader from '../Commons/FeedsTypesLeftHeader'
import MultilineParser from '../TextParser/MultilineParser'
import { generatorParserImageElement, generatorParserTextElement } from '../Utils/HelperFunctions'
import ContactsHelper, { getUserPresentationDataInProject } from '../../ContactsView/Utils/ContactsHelper'

export default function TaskCreatedToAnotherUser({
    feed,
    projectId,
    showNewFeedDot,
    feedActiveTab,
    lastChangeDateObject,
}) {
    const activeModalInFeed = useSelector(state => state.activeModalInFeed)
    const isMiddleScreen = useSelector(state => state.isMiddleScreen)
    const [width, setWidth] = useState(0)
    const { assigneeId, creatorId } = feed

    const { photoURL, shortName } = getUserPresentationDataInProject(projectId, creatorId)
    const {
        photoURL: assigneeAvatarURL,
        shortName: assigneeName,
        displayName: assistantAssigneeName,
        isAssistant,
    } = getUserPresentationDataInProject(projectId, assigneeId)

    const firstEntryText = `${shortName} created a task assigned to`
    const assigneeStyles = [localStyles.avatar, localStyles.assigneeAvatar]
    const elementsData = []

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

        const entry = generatorParserTextElement([localStyles.entry, { overflow: 'hidden' }], firstEntryText)
        elementsData.push(entry)

        const assigneAvatar = generatorParserImageElement(assigneeStyles, assigneeAvatarURL)
        elementsData.push(assigneAvatar)

        const entry2 = generatorParserTextElement(
            [localStyles.entry, { overflow: 'hidden' }],
            isAssistant ? assistantAssigneeName : assigneeName
        )
        elementsData.push(entry2)
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
            <MultilineParser elementsData={elementsData.slice(1)} externalContainerStyle={{ marginLeft: 0 }} />
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
    avatar: {
        borderRadius: 100,
        height: 20,
        width: 20,
    },
    assigneeAvatar: {
        marginLeft: 4,
    },
    entry: {
        ...styles.body2,
        color: colors.Text02,
        marginLeft: 4,
    },
})
