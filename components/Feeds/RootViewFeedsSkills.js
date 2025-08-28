import React, { useEffect, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { useSelector } from 'react-redux'

import FeedDVList from './FeedDVList'
import Backend from '../../utils/BackendBridge'
import { DV_TAB_SKILL_UPDATES } from '../../utils/TabNavigationConstants'
import URLsSkills, { URL_SKILL_DETAILS_FEED } from '../../URLSystem/Skills/URLsSkills'
import HeaderSkills from './HeaderSkills'

export default function RootViewFeedsSkills({ projectId }) {
    const selectedTab = useSelector(state => state.selectedNavItem)
    const skill = useSelector(state => state.skillInDv)

    const [innerFeeds, setInnerFeeds] = useState(null)

    const feedViewData = { type: 'skill', skillId: skill.id, skill }

    const writeBrowserURL = () => {
        if (selectedTab === DV_TAB_SKILL_UPDATES) {
            const data = { projectId, skill: skill.id }
            URLsSkills.push(URL_SKILL_DETAILS_FEED, data, projectId, skill.id)
        }
    }

    useEffect(() => {
        Backend.unsubDetailedViewFeeds()
        Backend.watchDetailedViewFeeds(projectId, 'skills', skill.id, setInnerFeeds)
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
            <HeaderSkills />
            <FeedDVList projectId={projectId} feedViewData={feedViewData} innerFeeds={innerFeeds} objectId={skill.id} />
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        marginBottom: 8,
    },
})
