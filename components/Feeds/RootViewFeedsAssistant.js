import React, { useEffect, useState } from 'react'
import { StyleSheet, View } from 'react-native'

import FeedDVList from './FeedDVList'
import HeaderAssistant from './HeaderAssistant'
import { useSelector } from 'react-redux'
import Backend from '../../utils/BackendBridge'
import { DV_TAB_ASSISTANT_UPDATES } from '../../utils/TabNavigationConstants'
import URLsAssistants, { URL_ASSISTANT_DETAILS_UPDATES } from '../../URLSystem/Assistants/URLsAssistants'
import { filterDetailedViewFeeds, getAttachedNoteFeedSource, getAttachedNoteId } from './Utils/DetailFeedHelper'

export default function RootViewFeedsAssistant({ projectId, assistant }) {
    const selectedTab = useSelector(state => state.selectedNavItem)

    const [innerFeeds, setInnerFeeds] = useState(null)
    const noteId = getAttachedNoteId(assistant, projectId)
    const relatedObjectIds = noteId ? [noteId] : []
    const relatedFeedSources = [getAttachedNoteFeedSource(noteId)].filter(Boolean)

    const feedViewData = { type: 'assistant', assistantId: assistant.uid, assistant }

    const writeBrowserURL = () => {
        if (selectedTab === DV_TAB_ASSISTANT_UPDATES) {
            const data = { projectId, assistantId: assistant.uid }
            URLsAssistants.push(URL_ASSISTANT_DETAILS_UPDATES, data, projectId, assistant.uid)
        }
    }

    useEffect(() => {
        Backend.unsubDetailedViewFeeds()
        Backend.watchDetailedViewFeeds(projectId, 'assistants', assistant.uid, setInnerFeeds, relatedFeedSources)
        writeBrowserURL()
    }, [])

    const cleanComponent = () => {
        Backend.unsubDetailedViewFeeds()
    }

    useEffect(() => {
        writeBrowserURL()
        return cleanComponent
    }, [])

    return (
        <View style={localStyles.container}>
            <HeaderAssistant />
            <FeedDVList
                projectId={projectId}
                feedViewData={feedViewData}
                innerFeeds={filterDetailedViewFeeds(innerFeeds, assistant.uid, relatedObjectIds)}
                objectId={assistant.uid}
                relatedObjectIds={relatedObjectIds}
            />
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        marginBottom: 8,
    },
})
