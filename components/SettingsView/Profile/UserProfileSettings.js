import React, { useEffect } from 'react'
import { StyleSheet, View } from 'react-native'
import { useSelector } from 'react-redux'

import URLsSettings, { URL_SETTINGS_PROFILE } from '../../../URLSystem/Settings/URLsSettings'
import SkillsArea from './Skills/SkillsArea'
import ProfileHeader from './ProfileHeader'
import ProfileProperties from './Properties/ProfileProperties'
import LogoutAndRemoveSection from './Properties/LogoutAndRemoveSection'
import UserData from './Properties/UserData'

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
            <ProfileProperties user={loggedUser} />
            <SkillsArea userId={loggedUser.uid} />
            <LogoutAndRemoveSection />
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flex: 1,
    },
})
