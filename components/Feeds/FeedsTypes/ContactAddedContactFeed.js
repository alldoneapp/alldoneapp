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

export default function ContactAddedContactFeed({
    feed,
    projectId,
    showNewFeedDot,
    feedActiveTab,
    lastChangeDateObject,
}) {
    const activeModalInFeed = useSelector(state => state.activeModalInFeed)
    const isMiddleScreen = useSelector(state => state.isMiddleScreen)
    const [width, setWidth] = useState(0)
    const { contactName, contactAvatarURL, id, creatorId } = feed
    const elementsData = []

    const { photoURL, shortName } = getUserPresentationDataInProject(projectId, creatorId)

    const firstEntryText = `${shortName} added a new relevant person •`
    const avatarsStyles = [localStyles.avatar, localStyles.contactAvatar]

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

        if (contactAvatarURL) {
            const contactAvatar = generatorParserImageElement(avatarsStyles, contactAvatarURL)
            elementsData.push(contactAvatar)
        } else {
            const component = (
                <View style={avatarsStyles}>
                    <SVGGenericUser width={20} height={20} svgid={id} />
                </View>
            )
            const contactAvatar = generatorParserCustomElement(component)
            elementsData.push(contactAvatar)
        }

        const entry2 = generatorParserTextElement([localStyles.entry, { overflow: 'hidden' }], contactName)
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
    contactAvatar: {
        marginLeft: 4,
        overflow: 'hidden',
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
