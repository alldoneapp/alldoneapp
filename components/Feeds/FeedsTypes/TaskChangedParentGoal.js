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
    generatorParserCustomElement,
} from '../Utils/HelperFunctions'
import LinkTag from '../../Tags/LinkTag'
import ContactsHelper, { getUserPresentationDataInProject } from '../../ContactsView/Utils/ContactsHelper'
import { getDvMainTabLink } from '../../../utils/LinkingHelper'

export default function TaskChangedParentGoal({ feed, projectId, showNewFeedDot, feedActiveTab }) {
    const activeModalInFeed = useSelector(state => state.activeModalInFeed)
    const isMiddleScreen = useSelector(state => state.isMiddleScreen)
    const [width, setWidth] = useState(0)
    const { isSubtask, newParentGoalId, oldParentGoalId, turnedToTask, creatorId } = feed

    const { photoURL, shortName } = getUserPresentationDataInProject(projectId, creatorId)

    let firstEntryText = ''
    let secondEntryText = ''

    if (turnedToTask && isSubtask) {
        firstEntryText = `${shortName} turned into task • By changing linked goal from`
        secondEntryText = newParentGoalId ? (oldParentGoalId ? 'to' : 'none to') : 'to none'
    } else {
        firstEntryText = `${shortName} ${
            oldParentGoalId ? 'changed linked goal • From' : `linked ${isSubtask ? 'subtask' : 'task'} to goal •`
        }`
        secondEntryText = newParentGoalId ? 'to' : 'to none'
    }

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

        if (oldParentGoalId) {
            const goal1Link = `${window.location.origin}${getDvMainTabLink(projectId, oldParentGoalId, 'goals')}`
            const goal1 = generatorParserCustomElement(
                <LinkTag link={goal1Link} tagStyle={{ marginLeft: 8, marginRight: -2 }} useCommentTagStyle={true} />
            )
            elementsData.push(goal1)
        }

        if ((turnedToTask && isSubtask) || oldParentGoalId) {
            const entry2 = generatorParserTextElement([localStyles.entry, { overflow: 'hidden' }], secondEntryText)
            elementsData.push(entry2)
        }

        if (newParentGoalId) {
            const goal2Link = `${window.location.origin}${getDvMainTabLink(projectId, newParentGoalId, 'goals')}`
            const goal2 = generatorParserCustomElement(
                <LinkTag
                    link={goal2Link}
                    tagStyle={{ marginLeft: oldParentGoalId ? 8 : 4 }}
                    useCommentTagStyle={true}
                />
            )
            elementsData.push(goal2)
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
    entry: {
        ...styles.body2,
        color: colors.Text02,
        marginLeft: 4,
    },
})
