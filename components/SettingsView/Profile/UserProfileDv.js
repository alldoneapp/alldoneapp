import React, { useEffect } from 'react'
import { StyleSheet, View } from 'react-native'
import { useSelector } from 'react-redux'

import SkillsArea from './Skills/SkillsArea'
import ProfileHeader from './ProfileHeader'
import ProfileProperties from './Properties/ProfileProperties'
import URLsPeople, { URL_PEOPLE_DETAILS_PROFILE } from '../../../URLSystem/People/URLsPeople'
import { DV_TAB_USER_PROFILE } from '../../../utils/TabNavigationConstants'
import UserData from './Properties/UserData'
import ChatWith from './Properties/ChatWith'
import ProjectHelper from '../ProjectsSettings/ProjectHelper'

export default function UserProfileDv({ projectIndex, projectId, user }) {
    const selectedNavItem = useSelector(state => state.selectedNavItem)

    const projectRole = ProjectHelper.getUserRoleInProject(projectId, user.uid, user.role)

    useEffect(() => {
        writeBrowserURL()
    }, [])

    const writeBrowserURL = () => {
        if (selectedNavItem === DV_TAB_USER_PROFILE) {
            URLsPeople.push(URL_PEOPLE_DETAILS_PROFILE, { projectId, userId: user.uid }, projectId, user.uid)
        }
    }

    return (
        <View style={localStyles.container}>
            <ProfileHeader />
            <UserData user={user} projectRole={projectRole} />
            <ProfileProperties user={user} projectIndex={projectIndex} projectId={projectId} />
            <SkillsArea projectId={projectId} userId={user.uid} />
            <ChatWith user={user} projectId={projectId} />
            <View style={{ marginBottom: 70 }} />
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flex: 1,
    },
})
