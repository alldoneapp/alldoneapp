import React, { useEffect, useState } from 'react'
import { StyleSheet, View } from 'react-native'

import FeedDVList from './FeedDVList'
import HeaderTask from './HeaderTask'
import { useSelector } from 'react-redux'
import URLsTasks, { URL_TASK_DETAILS_FEED } from '../../URLSystem/Tasks/URLsTasks'
import Backend from '../../utils/BackendBridge'
import { DV_TAB_TASK_UPDATES } from '../../utils/TabNavigationConstants'

export default function RootViewFeedsTask({ projectId, task, taskId }) {
    const selectedTab = useSelector(state => state.selectedNavItem)

    const [innerFeeds, setInnerFeeds] = useState(null)

    const feedViewData = { type: 'task', taskId, task }

    const writeBrowserURL = () => {
        if (selectedTab === DV_TAB_TASK_UPDATES) {
            const data = { projectId: projectId, task: task.id }
            URLsTasks.push(URL_TASK_DETAILS_FEED, data, projectId, task.id)
        }
    }

    useEffect(() => {
        Backend.unsubDetailedViewFeeds()
        Backend.watchDetailedViewFeeds(projectId, 'tasks', taskId, setInnerFeeds)
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
            <HeaderTask />
            <FeedDVList projectId={projectId} feedViewData={feedViewData} innerFeeds={innerFeeds} objectId={taskId} />
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        marginBottom: 8,
    },
})
