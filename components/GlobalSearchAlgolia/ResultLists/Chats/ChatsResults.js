import React from 'react'
import { StyleSheet, View } from 'react-native'

import ChatsByProject from './ChatsByProject'

export default function ChatsResults({ projects, activeTab, chatsResult, activeItemData, activeItemRef }) {
    return (
        <View style={localStyles.container}>
            {projects.map(project => {
                return (
                    <ChatsByProject
                        key={project.index}
                        project={project}
                        chats={chatsResult[project.id]}
                        activeTab={activeTab}
                        activeItemIndex={activeItemData.projectId === project.id ? activeItemData.activeIndex : -1}
                        activeItemRef={activeItemRef}
                    />
                )
            })}
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flex: 1,
    },
})
