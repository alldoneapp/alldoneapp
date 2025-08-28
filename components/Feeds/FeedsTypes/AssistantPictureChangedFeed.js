import React, { useState } from 'react'
import { View, StyleSheet } from 'react-native'
import { TouchableOpacity } from 'react-native-gesture-handler'
import { useSelector } from 'react-redux'

import styles, { colors } from '../../styles/global'
import SVGGenericUser from '../../../assets/svg/SVGGenericUser'
import FeedsTypesLeftHeader from '../Commons/FeedsTypesLeftHeader'
import MultilineParser from '../TextParser/MultilineParser'
import {
    generatorParserImageElement,
    generatorParserTextElement,
    generatorParserCustomElement,
} from '../Utils/HelperFunctions'
import ContactsHelper, { getUserPresentationDataInProject } from '../../ContactsView/Utils/ContactsHelper'

export default function AssistantPictureChangedFeed({
    feed,
    projectId,
    showNewFeedDot,
    feedActiveTab,
    lastChangeDateObject,
}) {
    const activeModalInFeed = useSelector(state => state.activeModalInFeed)
    const isMiddleScreen = useSelector(state => state.isMiddleScreen)
    const [width, setWidth] = useState(0)
    const { newPhotoURL, oldPhotoURL, id, creatorId } = feed

    const { photoURL, shortName } = getUserPresentationDataInProject(projectId, creatorId)

    const firstEntryText = `${shortName} changed picture • From`
    const secondEntryText = `to`
    const avatarsStyles = [localStyles.avatar, localStyles.assistantAvatar]
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

        if (oldPhotoURL) {
            const assistantAvatar = generatorParserImageElement(avatarsStyles, oldPhotoURL)
            elementsData.push(assistantAvatar)
        } else {
            const component = (
                <View style={avatarsStyles}>
                    <SVGGenericUser width={20} height={20} svgid={id} />
                </View>
            )
            const assistantAvatar = generatorParserCustomElement(component)
            elementsData.push(assistantAvatar)
        }

        const entry2 = generatorParserTextElement([localStyles.entry, { overflow: 'hidden' }], secondEntryText)
        elementsData.push(entry2)

        if (newPhotoURL) {
            const assistantAvatar = generatorParserImageElement(avatarsStyles, newPhotoURL)
            elementsData.push(assistantAvatar)
        } else {
            const component = (
                <View style={avatarsStyles}>
                    <SVGGenericUser width={20} height={20} svgid={id} />
                </View>
            )
            const assistantAvatar = generatorParserCustomElement(component)
            elementsData.push(assistantAvatar)
        }
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
    assistantAvatar: {
        marginLeft: 4,
        overflow: 'hidden',
    },
    entry: {
        ...styles.body2,
        color: colors.Text02,
        marginLeft: 4,
    },
})
