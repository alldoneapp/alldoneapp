import React from 'react'
import { StyleSheet, View } from 'react-native'
import { useSelector } from 'react-redux'

import UserItem from './UserItem'

export default function UsersArea({ projectId, userId, selectedUserId, setSelectedUserId, inProgress }) {
    const usersInProject = useSelector(state => state.projectUsers[projectId])

    const users = usersInProject ? usersInProject.filter(user => user.uid !== userId) : []

    return (
        <View style={{ width: '100%' }}>
            <View style={localStyles.sectionSeparator} />
            <View style={localStyles.content}>
                {users.map(user => (
                    <UserItem
                        key={user.uid}
                        user={user}
                        selectedUserId={selectedUserId}
                        setSelectedUserId={setSelectedUserId}
                        inProgress={inProgress}
                    />
                ))}
            </View>
            <View style={localStyles.sectionSeparator} />
        </View>
    )
}

const localStyles = StyleSheet.create({
    content: {
        width: '100%',
        marginTop: 8,
        paddingHorizontal: 16,
    },
    sectionSeparator: {
        width: '100%',
        height: 1,
        backgroundColor: '#ffffff',
        opacity: 0.2,
        marginTop: 8,
    },
})
