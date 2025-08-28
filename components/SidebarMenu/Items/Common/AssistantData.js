import React from 'react'
import { StyleSheet, View } from 'react-native'

import useCollapsibleSidebar from '../../Collapsible/UseCollapsibleSidebar'
import UserName from './UserName'
import AssistantAvatar from '../../../AdminPanel/Assistants/AssistantAvatar'

export default function AssistantData({ assistant }) {
    const { expanded } = useCollapsibleSidebar()
    const { photoURL50, uid, displayName } = assistant

    return (
        <View style={localStyles.container}>
            <AssistantAvatar
                photoURL={photoURL50}
                assistantId={assistant.uid}
                size={20}
                containerStyle={{ marginRight: expanded ? 10 : 2 }}
            />
            {expanded && <UserName userId={uid} name={displayName} containerStyle={{ marginRight: 5 }} />}
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
    },
})
