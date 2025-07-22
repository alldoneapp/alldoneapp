import React, { useState } from 'react'
import { View, StyleSheet } from 'react-native'
import { TouchableOpacity } from 'react-native-gesture-handler'
import { useSelector } from 'react-redux'

import styles, { colors } from '../../styles/global'
import FeedsTypesLeftHeader from '../Commons/FeedsTypesLeftHeader'
import MultilineParser from '../TextParser/MultilineParser'
import { generatorParserImageElement, generatorParserTextElement } from '../Utils/HelperFunctions'
import ContactsHelper, { getUserPresentationDataInProject } from '../../ContactsView/Utils/ContactsHelper'

export default function TaskMovedInWorkflowFeed({
    feed,
    projectId,
    showNewFeedDot,
    feedActiveTab,
    lastChangeDateObject,
}) {
    const activeModalInFeed = useSelector(state => state.activeModalInFeed)
    const isMiddleScreen = useSelector(state => state.isMiddleScreen)
    const [width, setWidth] = useState(0)
    const {
        fromStepDescription,
        toStepDescription,
        isForward,
        isSubtask,
        creatorId,
        fromStepUserId,
        toStepUserId,
    } = feed

    const { photoURL, shortName } = getUserPresentationDataInProject(projectId, creatorId)
    const { photoURL: fromStepAvatarURL } = getUserPresentationDataInProject(projectId, fromStepUserId)
    const { photoURL: toStepAvatarURL } = getUserPresentationDataInProject(projectId, toStepUserId)

    const entryVerb = isSubtask ? 'turned into task • By sending' : 'send'
    const firstEntryText = `${shortName} ${entryVerb} ${isForward ? 'forward' : 'backward'} in Workflow • From`
    const secondEntryText = `${fromStepDescription} to`
    const stepUserAvatarStyles = [localStyles.avatar, localStyles.stepUserAvatar]
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

        const fromAvatar = generatorParserImageElement(stepUserAvatarStyles, fromStepAvatarURL)
        elementsData.push(fromAvatar)

        const entry2 = generatorParserTextElement([localStyles.entry, { overflow: 'hidden' }], secondEntryText)
        elementsData.push(entry2)

        if (toStepAvatarURL !== '') {
            const toAvatar = generatorParserImageElement(stepUserAvatarStyles, toStepAvatarURL)
            elementsData.push(toAvatar)
        }

        const entry3 = generatorParserTextElement([localStyles.entry, { overflow: 'hidden' }], toStepDescription)
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
    stepUserAvatar: {
        marginLeft: 4,
    },
    entry: {
        ...styles.body2,
        color: colors.Text02,
        marginLeft: 4,
    },
})
