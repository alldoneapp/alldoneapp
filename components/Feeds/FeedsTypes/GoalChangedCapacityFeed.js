import React, { useState } from 'react'
import { View, StyleSheet, Text } from 'react-native'
import { TouchableOpacity } from 'react-native-gesture-handler'
import { useSelector } from 'react-redux'

import styles, { colors } from '../../styles/global'
import FeedsTypesLeftHeader from '../Commons/FeedsTypesLeftHeader'
import MultilineParser from '../TextParser/MultilineParser'
import {
    generatorParserImageElement,
    generatorParserTextElement,
    generatorParserCustomElement,
} from '../Utils/HelperFunctions'
import { capacityDataMap } from '../../GoalsView/GoalsHelper'
import ContactsHelper, { getUserPresentationDataInProject } from '../../ContactsView/Utils/ContactsHelper'

export default function GoalChangedCapacityFeed({
    feed,
    projectId,
    showNewFeedDot,
    feedActiveTab,
    lastChangeDateObject,
}) {
    const activeModalInFeed = useSelector(state => state.activeModalInFeed)
    const isMiddleScreen = useSelector(state => state.isMiddleScreen)
    const [width, setWidth] = useState(0)
    const { capacityUserId, oldCapacity, newCapacity, creatorId } = feed

    const { photoURL, shortName } = getUserPresentationDataInProject(projectId, creatorId)
    const { photoURL: capacityUserPhotoUrl, shortName: capacityUserName } = getUserPresentationDataInProject(
        projectId,
        capacityUserId
    )

    const oldCapacityValue = capacityDataMap[oldCapacity] ? capacityDataMap[oldCapacity].capacityValue : ''
    const newCapacityValue = capacityDataMap[newCapacity] ? capacityDataMap[newCapacity].capacityValue : ''

    const elementsData = []

    const firstEntryText = `${shortName} changed`
    const secondEntryText = `${capacityUserName}’s capacity • From`
    const thirdEntryText = 'to'

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

        const capacityOwnerAvatar = generatorParserImageElement(
            [localStyles.avatar, localStyles.capacityUserAvatar],
            capacityUserPhotoUrl
        )
        elementsData.push(capacityOwnerAvatar)

        const entry2 = generatorParserTextElement([localStyles.entry, { overflow: 'hidden' }], secondEntryText)
        elementsData.push(entry2)

        const custom1 = generatorParserCustomElement(
            <View style={[localStyles.capacityTag, localStyles.firstCapacityTag]}>
                <Text style={localStyles.capacityTagText}>{oldCapacityValue}</Text>
            </View>
        )
        elementsData.push(custom1)

        const entry3 = generatorParserTextElement([localStyles.entry, { overflow: 'hidden' }], thirdEntryText)
        elementsData.push(entry3)

        const custom2 = generatorParserCustomElement(
            <View style={localStyles.capacityTag}>
                <Text style={localStyles.capacityTagText}>{newCapacityValue}</Text>
            </View>
        )
        elementsData.push(custom2)
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
    avatar: {
        borderRadius: 100,
        height: 20,
        width: 20,
    },
    capacityUserAvatar: {
        marginLeft: 4,
    },
    capacityTag: {
        height: 24,
        borderRadius: 12,
        backgroundColor: colors.Grey300,
        paddingHorizontal: 8,
        flexDirection: 'row',
        alignItems: 'center',
        marginLeft: 8,
    },
    firstCapacityTag: {
        marginRight: 4,
    },
    capacityTagText: {
        ...styles.subtitle2,
        color: colors.Text03,
    },
})
