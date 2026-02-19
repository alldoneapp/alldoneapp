import React from 'react'
import { StyleSheet, View } from 'react-native'

import ChatsSwitchableTagContainer from './ChatsSwitchableTag/ChatsSwitchableTagContainer'
import MainSectionTabsHeader from '../TaskListView/Header/MainSectionTabsHeader'

function ChatsHeader() {
    return (
        <View style={localStyles.container}>
            <MainSectionTabsHeader
                showSectionToggle={true}
                renderSectionToggle={() => <ChatsSwitchableTagContainer />}
            />
        </View>
    )
}

export default ChatsHeader

const localStyles = StyleSheet.create({
    container: {
        width: '100%',
    },
})
