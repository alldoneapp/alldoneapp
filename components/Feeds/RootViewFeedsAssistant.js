import React, { useEffect, useState } from 'react'
import { StyleSheet, View } from 'react-native'

import FeedDVList from './FeedDVList'
import HeaderAssistant from './HeaderAssistant'
import { useSelector } from 'react-redux'
import Backend from '../../utils/BackendBridge'
import { DV_TAB_ASSISTANT_UPDATES } from '../../utils/TabNavigationConstants'
import URLsAssistants, { URL_ASSISTANT_DETAILS_UPDATES } from '../../URLSystem/Assistants/URLsAssistants'

export default function RootViewFeedsAssistant({ projectId, assistant }) {
    const selectedTab = useSelector(state => state.selectedNavItem)

    const [innerFeeds, setInnerFeeds] = useState(null)

    const feedViewData = { type: 'assistant', assistantId: assistant.uid, assistant }

    const writeBrowserURL = () => {
        if (selectedTab === DV_TAB_ASSISTANT_UPDATES) {
            const data = { projectId, assistantId: assistant.uid }
            URLsAssistants.push(URL_ASSISTANT_DETAILS_UPDATES, data, projectId, assistant.uid)
        }
    }

    useEffect(() => {
        Backend.unsubDetailedViewFeeds()
        Backend.watchDetailedViewFeeds(projectId, 'assistants', assistant.uid, setInnerFeeds)
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
                innerFeeds={innerFeeds}
                objectId={assistant.uid}
            />
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        marginBottom: 8,
    },
})
