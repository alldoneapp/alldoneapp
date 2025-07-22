import React, { useState } from 'react'
import { View, StyleSheet } from 'react-native'
import { TouchableOpacity } from 'react-native-gesture-handler'
import { useSelector } from 'react-redux'

import styles, { colors } from '../../styles/global'
import FeedsTypesLeftHeader from '../Commons/FeedsTypesLeftHeader'
import MultilineParser from '../TextParser/MultilineParser'
import { generatorParserTextElement, generatorParserCustomElement } from '../Utils/HelperFunctions'
import ProjectHelper from '../../SettingsView/ProjectsSettings/ProjectHelper'
import ContactsHelper from '../../ContactsView/Utils/ContactsHelper'

export default function UserAllMembersFollowing({
    feed,
    projectId,
    showNewFeedDot,
    feedActiveTab,
    lastChangeDateObject,
}) {
    const activeModalInFeed = useSelector(state => state.activeModalInFeed)
    const isMiddleScreen = useSelector(state => state.isMiddleScreen)
    const [width, setWidth] = useState(0)
    const project = ProjectHelper.getProjectById(projectId)
    const projectName = project.name
    const projectColor = project.color

    const { creatorId } = feed

    const firstEntryText = `All ${projectName} project members started following the user`

    const elementsData = []

    const navigateToUserDv = () => {
        ContactsHelper.navigateToUserProfile(projectId, creatorId)
    }

    const onLayout = ({ nativeEvent }) => {
        const { width } = nativeEvent.layout
        setWidth(width)
    }

    const parseFeed = () => {
        const colorContainer = generatorParserCustomElement(
            <View style={localStyles.projectColorContainer}>
                <View style={[localStyles.projectColorBall, { backgroundColor: projectColor }]} />
            </View>
        )
        elementsData.push(colorContainer)

        const entry1 = generatorParserTextElement([localStyles.entry, { overflow: 'hidden' }], firstEntryText)
        elementsData.push(entry1)
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
                projectColor={projectColor}
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
    projectColorContainer: {
        height: 20,
        width: 20,
        alignItems: 'center',
        justifyContent: 'center',
    },
    projectColorBall: {
        borderRadius: 100,
        width: 13.33,
        height: 13.33,
    },
    avatar: {
        borderRadius: 100,
        height: 20,
        width: 20,
    },
})
