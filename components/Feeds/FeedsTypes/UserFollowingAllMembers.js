import React, { useState } from 'react'
import { View, StyleSheet } from 'react-native'
import { TouchableOpacity } from 'react-native-gesture-handler'
import { useSelector } from 'react-redux'

import styles, { colors } from '../../styles/global'
import FeedsTypesLeftHeader from '../Commons/FeedsTypesLeftHeader'
import MultilineParser from '../TextParser/MultilineParser'
import {
    generatorParserImageElement,
    generatorParserTextElement,
    generatorParserViewElement,
} from '../Utils/HelperFunctions'
import ProjectHelper from '../../SettingsView/ProjectsSettings/ProjectHelper'
import ContactsHelper, { getUserPresentationDataInProject } from '../../ContactsView/Utils/ContactsHelper'

export default function UserFollowingAllMembers({
    feed,
    projectId,
    showNewFeedDot,
    feedActiveTab,
    lastChangeDateObject,
}) {
    const activeModalInFeed = useSelector(state => state.activeModalInFeed)
    const isMiddleScreen = useSelector(state => state.isMiddleScreen)
    const [width, setWidth] = useState(0)
    const { creatorId } = feed

    const { photoURL, shortName } = getUserPresentationDataInProject(projectId, creatorId)

    const project = ProjectHelper.getProjectById(projectId)
    const projectName = project.name
    const projectColor = project.color

    const firstEntryText = `${shortName} started following all`
    const secondEntryText = `${projectName} project members`

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

        const entry1 = generatorParserTextElement([localStyles.entry, { overflow: 'hidden' }], firstEntryText)
        elementsData.push(entry1)

        const view = generatorParserViewElement([localStyles.projectColorBall, { backgroundColor: projectColor }])
        elementsData.push(view)

        const entry2 = generatorParserTextElement(
            [localStyles.entry, localStyles.secondEntry, { overflow: 'hidden' }],
            secondEntryText
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
    entry: {
        ...styles.body2,
        color: colors.Text02,
        marginLeft: 4,
    },
    secondEntry: {
        marginLeft: 7.33,
    },
    projectColorBall: {
        borderRadius: 100,
        width: 13.33,
        height: 13.33,
        marginLeft: 7.33,
        alignSelf: 'center',
    },
    avatar: {
        borderRadius: 100,
        height: 20,
        width: 20,
    },
})
