import React, { useState } from 'react'
import { View, StyleSheet } from 'react-native'
import { TouchableOpacity } from 'react-native-gesture-handler'
import { useSelector } from 'react-redux'

import styles, { colors } from '../../styles/global'
import FeedsTypesLeftHeader from '../Commons/FeedsTypesLeftHeader'
import MultilineParser from '../TextParser/MultilineParser'
import { generatorParserImageElement, generatorParserTextElement } from '../Utils/HelperFunctions'
import ContactsHelper, { getUserPresentationDataInProject } from '../../ContactsView/Utils/ContactsHelper'

export default function TaskAssigneeChangedFeed({
    feed,
    projectId,
    showNewFeedDot,
    feedActiveTab,
    lastChangeDateObject,
}) {
    const activeModalInFeed = useSelector(state => state.activeModalInFeed)
    const isMiddleScreen = useSelector(state => state.isMiddleScreen)
    const [width, setWidth] = useState(0)
    const { oldAssigneeId, newAssigneeId, isSubtask, creatorId } = feed

    const { photoURL, shortName } = getUserPresentationDataInProject(projectId, creatorId)
    const { photoURL: oldAssigneeAvatarURL, shortName: oldAssigneeName } = getUserPresentationDataInProject(
        projectId,
        oldAssigneeId
    )
    const { photoURL: newAssigneeAvatarURL, shortName: newAssigneeName } = getUserPresentationDataInProject(
        projectId,
        newAssigneeId
    )

    const firstEntryText = `${shortName} ${
        isSubtask ? 'turned subtask into task • By changing assignee from' : 'changed assignee • From'
    }`
    const secondEntryText = `${oldAssigneeName} to`
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

        const oldAssigneAvatar = generatorParserImageElement(assigneeStyles, oldAssigneeAvatarURL)
        elementsData.push(oldAssigneAvatar)

        const entry2 = generatorParserTextElement([localStyles.entry, { overflow: 'hidden' }], secondEntryText)
        elementsData.push(entry2)

        const newAssigneAvatar = generatorParserImageElement(assigneeStyles, newAssigneeAvatarURL)
        elementsData.push(newAssigneAvatar)

        const entry3 = generatorParserTextElement([localStyles.entry, { overflow: 'hidden' }], newAssigneeName)
        elementsData.push(entry3)
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
