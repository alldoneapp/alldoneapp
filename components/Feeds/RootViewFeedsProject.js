import React, { useEffect, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import moment from 'moment'

import FeedDVList from './FeedDVList'
import HeaderProject from './HeaderProject'
import { useSelector } from 'react-redux'
import URLsProjects, { URL_PROJECT_DETAILS_FEED } from '../../URLSystem/Projects/URLsProjects'
import Backend from '../../utils/BackendBridge'
import { DV_TAB_PROJECT_UPDATES } from '../../utils/TabNavigationConstants'

export default function RootViewFeedsProject({ projectId }) {
    const selectedTab = useSelector(state => state.selectedNavItem)
    const project = useSelector(state => state.loggedUserProjectsMap[projectId])

    const [innerFeeds, setInnerFeeds] = useState(null)
    const currentDate = moment()
    const currentDateFormated = currentDate.format('DDMMYYYY')

    const feedViewData = { type: 'project', projectId, project }

    const writeBrowserURL = () => {
        if (selectedTab === DV_TAB_PROJECT_UPDATES) {
            const data = { projectId }
            URLsProjects.push(URL_PROJECT_DETAILS_FEED, data, projectId)
        }
    }

    useEffect(() => {
        Backend.unsubDetailedViewFeeds()
        Backend.watchDetailedViewFeeds(projectId, 'projects', projectId, setInnerFeeds)
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
            <HeaderProject />
            <FeedDVList
                projectId={projectId}
                currentDateFormated={currentDateFormated}
                feedViewData={feedViewData}
                innerFeeds={innerFeeds}
                objectId={projectId}
            />
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        marginBottom: 8,
    },
})
