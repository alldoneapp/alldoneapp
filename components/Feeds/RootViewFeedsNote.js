import React, { useEffect, useState } from 'react'
import { StyleSheet, View } from 'react-native'

import FeedDVList from './FeedDVList'
import HeaderNote from './HeaderNote'
import { useSelector } from 'react-redux'
import URLsTasks, { URL_NOTE_DETAILS_FEED } from '../../URLSystem/Notes/URLsNotes'
import Backend from '../../utils/BackendBridge'
import { DV_TAB_NOTE_UPDATES } from '../../utils/TabNavigationConstants'

export default function RootViewFeedsNote({ projectId, note, noteId }) {
    const selectedTab = useSelector(state => state.selectedNavItem)
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)
    const isMiddleScreen = useSelector(state => state.isMiddleScreen)

    const [innerFeeds, setInnerFeeds] = useState(null)

    const feedViewData = { type: 'note', noteId, note }

    const writeBrowserURL = () => {
        if (selectedTab === DV_TAB_NOTE_UPDATES) {
            const data = { note: note.id }

            data.projectId = projectId
            URLsTasks.push(URL_NOTE_DETAILS_FEED, data, projectId, note.id, note.title)
        }
    }

    useEffect(() => {
        Backend.unsubDetailedViewFeeds()
        Backend.watchDetailedViewFeeds(projectId, 'notes', noteId, setInnerFeeds)
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
        <View
            style={
                smallScreenNavigation
                    ? localStyles.containerMobile
                    : isMiddleScreen
                    ? localStyles.containerTablet
                    : localStyles.container
            }
        >
            <HeaderNote />
            <FeedDVList projectId={projectId} feedViewData={feedViewData} innerFeeds={innerFeeds} objectId={noteId} />
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        marginBottom: 92,
        marginHorizontal: 104,
    },
    containerMobile: {
        marginHorizontal: 0,
    },
    containerTablet: {
        marginHorizontal: 56,
    },
})
