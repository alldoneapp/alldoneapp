import React from 'react'
import { StyleSheet, View } from 'react-native'
import GoalsMultiToggleSwitch from './GoalsMultiToggleSwitch'
import MainSectionTabsHeader from '../TaskListView/Header/MainSectionTabsHeader'

export default function GoalsHeader() {
    return (
        <View style={localStyles.container}>
            <MainSectionTabsHeader showSectionToggle={true} renderSectionToggle={() => <GoalsMultiToggleSwitch />} />
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        width: '100%',
    },
})
