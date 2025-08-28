import React, { useEffect, useState } from 'react'
import { StyleSheet, View } from 'react-native'

import FeedDVList from './FeedDVList'
import HeaderUser from './HeaderUser'
import { useSelector } from 'react-redux'
import URLsPeople, { URL_PEOPLE_DETAILS_FEED } from '../../URLSystem/People/URLsPeople'
import Backend from '../../utils/BackendBridge'
import { DV_TAB_USER_UPDATES } from '../../utils/TabNavigationConstants'

export default function RootViewFeedsUser({ user, userId, projectId }) {
    const selectedTab = useSelector(state => state.selectedNavItem)

    const [innerFeeds, setInnerFeeds] = useState(null)

    const feedViewData = { type: 'user', userId, user }

    const writeBrowserURL = () => {
        if (selectedTab === DV_TAB_USER_UPDATES) {
            const data = { projectId: projectId, userId: user.uid }
            URLsPeople.push(URL_PEOPLE_DETAILS_FEED, data, projectId, user.uid)
        }
    }

    useEffect(() => {
        Backend.unsubDetailedViewFeeds()
        Backend.watchDetailedViewFeeds(projectId, 'users', userId, setInnerFeeds)
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
            <HeaderUser />
            <FeedDVList projectId={projectId} feedViewData={feedViewData} innerFeeds={innerFeeds} objectId={userId} />
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        marginBottom: 8,
    },
})
