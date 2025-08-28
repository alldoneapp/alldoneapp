import React from 'react'
import { View } from 'react-native'

import UserObjectHeader from './UserObjectHeader'
import UserObjectBody from './UserObjectBody'

export default function UserObject({ feedObjectData, projectId, feedActiveTab, viewType, style }) {
    const { object, feeds } = feedObjectData
    const { userId, lastChangeDate } = object
    return (
        <View style={style}>
            {viewType !== 'user' && <UserObjectHeader feed={object} projectId={projectId} />}
            <UserObjectBody
                feeds={feeds}
                userId={userId}
                projectId={projectId}
                lastChangeDate={lastChangeDate}
                feedActiveTab={feedActiveTab}
            />
        </View>
    )
}
