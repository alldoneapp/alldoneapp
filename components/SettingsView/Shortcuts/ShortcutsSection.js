import React, { useEffect } from 'react'
import { StyleSheet, View } from 'react-native'
import { useSelector } from 'react-redux'

import General from './General'
import Tasks from './Tasks'
import Notes from './Notes'
import Goals from './Goals'
import People from './People'
import Feed from './Feed'
import URLsSettings, { URL_SETTINGS_SHORTCUTS } from '../../../URLSystem/Settings/URLsSettings'

export default function ShortcutsSection({}) {
    const selectedTab = useSelector(state => state.selectedNavItem)

    useEffect(() => {
        writeBrowserURL()
    }, [])

    const writeBrowserURL = () => {
        URLsSettings.push(URL_SETTINGS_SHORTCUTS)
    }

    return (
        <View style={localStyles.container}>
            <General />
            <Tasks />
            <Goals />
            <Notes />
            <People />
            <Feed />
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flex: 1,
    },
})
