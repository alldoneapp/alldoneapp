import React, { useEffect } from 'react'
import { StyleSheet, View } from 'react-native'
import { useSelector } from 'react-redux'

import URLsSettings, { URL_SETTINGS_PROFILE } from '../../../URLSystem/Settings/URLsSettings'
import SkillsArea from './Skills/SkillsArea'
import ProfileHeader from './ProfileHeader'
import ProfileProperties, { ProfileDescriptionProperty } from './Properties/ProfileProperties'
import LogoutAndRemoveSection from './Properties/LogoutAndRemoveSection'
import UserData from './Properties/UserData'
import AchievementsArea from './Achievements/AchievementsArea'

export default function UserProfileSettings() {
    const loggedUser = useSelector(state => state.loggedUser)

    useEffect(() => {
        writeBrowserURL()
    }, [])

    const writeBrowserURL = () => {
        URLsSettings.push(URL_SETTINGS_PROFILE)
    }

    return (
        <View style={localStyles.container}>
            <ProfileHeader />
            <UserData user={loggedUser} />
            <ProfileProperties user={loggedUser} hideDescription={true}>
                <AchievementsArea user={loggedUser} />
                <SkillsArea userId={loggedUser.uid} />
            </ProfileProperties>
            <LogoutAndRemoveSection />
            <ProfileDescriptionProperty user={loggedUser} />
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flex: 1,
    },
})
