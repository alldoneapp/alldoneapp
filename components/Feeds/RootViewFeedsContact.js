import React, { useEffect, useState } from 'react'
import { StyleSheet, View } from 'react-native'

import FeedDVList from './FeedDVList'
import HeaderContact from './HeaderContact'
import { useSelector } from 'react-redux'
import URLsContacts, { URL_CONTACT_DETAILS_FEED } from '../../URLSystem/Contacts/URLsContacts'
import Backend from '../../utils/BackendBridge'
import { DV_TAB_CONTACT_UPDATES } from '../../utils/TabNavigationConstants'

export default function RootViewFeedsContact({ contact, contactId, projectId }) {
    const selectedTab = useSelector(state => state.selectedNavItem)

    const [innerFeeds, setInnerFeeds] = useState(null)

    const feedViewData = { type: 'contact', contactId, contact }

    const writeBrowserURL = () => {
        if (selectedTab === DV_TAB_CONTACT_UPDATES) {
            const data = { projectId: projectId, userId: contact.uid }
            URLsContacts.push(URL_CONTACT_DETAILS_FEED, data, projectId, contact.uid)
        }
    }

    useEffect(() => {
        Backend.unsubDetailedViewFeeds()
        Backend.watchDetailedViewFeeds(projectId, 'contacts', contactId, setInnerFeeds)
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
            <HeaderContact />
            <FeedDVList
                projectId={projectId}
                feedViewData={feedViewData}
                innerFeeds={innerFeeds}
                objectId={contactId}
            />
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        marginBottom: 8,
    },
})
