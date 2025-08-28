import React, { useState } from 'react'
import { View, StyleSheet } from 'react-native'
import { TouchableOpacity } from 'react-native-gesture-handler'
import { useSelector } from 'react-redux'

import styles, { colors } from '../../styles/global'
import FeedsTypesLeftHeader from '../Commons/FeedsTypesLeftHeader'
import MultilineParser from '../TextParser/MultilineParser'
import { generatorParserImageElement, generatorParserTextElement } from '../Utils/HelperFunctions'
import HelperFunctions from '../../../utils/HelperFunctions'
import {
    FEED_USER_WORKFLOW_ADDED,
    FEED_USER_WORKFLOW_CHANGED,
    FEED_USER_WORKFLOW_REMOVE,
} from '../Utils/FeedsConstants'
import ContactsHelper, { getUserPresentationDataInProject } from '../../ContactsView/Utils/ContactsHelper'

export default function UserWorkflowStepFeed({ feed, projectId, showNewFeedDot, feedActiveTab, lastChangeDateObject }) {
    const activeModalInFeed = useSelector(state => state.activeModalInFeed)
    const isMiddleScreen = useSelector(state => state.isMiddleScreen)
    const [width, setWidth] = useState(0)
    const { reviewerUserId, objectId, type: feedType, description, oldReviewerUid, creatorId } = feed

    const { photoURL, shortName } = getUserPresentationDataInProject(projectId, creatorId)

    const { photoURL: reviewerPhotoURL, shortName: reviewerName } = getUserPresentationDataInProject(
        projectId,
        reviewerUserId
    )
    const { photoURL: targetUserPhotoURL, shortName: targetUserName } = getUserPresentationDataInProject(
        projectId,
        feedType === FEED_USER_WORKFLOW_CHANGED ? oldReviewerUid : objectId
    )

    const action =
        feedType === FEED_USER_WORKFLOW_ADDED
            ? 'added'
            : feedType === FEED_USER_WORKFLOW_REMOVE
            ? 'removed'
            : `edited ${description} • Changed reviewer from`
    const firstEntryText = `${shortName} ${action}`
    const secondEntryText = `${HelperFunctions.getFirstName(reviewerName)} ${
        feedType === FEED_USER_WORKFLOW_CHANGED ? 'to' : 'in'
    }`
    const thirdEntryText = `${HelperFunctions.getFirstName(targetUserName)}${
        feedType !== FEED_USER_WORKFLOW_CHANGED ? `’s workflow • Step name: ${description}` : ''
    }`
    const assigneeStyles = [localStyles.avatar, localStyles.ownerAvatar]
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

        const reviewerAvatar = generatorParserImageElement(assigneeStyles, reviewerPhotoURL)
        elementsData.push(reviewerAvatar)

        const entry2 = generatorParserTextElement([localStyles.entry, { overflow: 'hidden' }], secondEntryText)
        elementsData.push(entry2)

        const newAssigneAvatar = generatorParserImageElement(assigneeStyles, targetUserPhotoURL)
        elementsData.push(newAssigneAvatar)

        const entry3 = generatorParserTextElement([localStyles.entry, { overflow: 'hidden' }], thirdEntryText)
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
    ownerAvatar: {
        marginLeft: 4,
    },
    entry: {
        ...styles.body2,
        color: colors.Text02,
        marginLeft: 4,
    },
})
