import React, { useState, useEffect } from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'

import styles, { colors } from '../../../styles/global'
import Icon from '../../../Icon'
import TasksHelper from '../../../TaskListView/Utils/TasksHelper'
import Backend from '../../../../utils/BackendBridge'
import Avatar from '../../../Avatar'
import { getUserData } from '../../../../utils/backends/Users/usersFirestore'

export default function UserTag({ userId, onPress, hideRemoveButton }) {
    const [user, setUser] = useState(null)

    const updateUser = async () => {
        let user = TasksHelper.getUser(userId)
        user = user ? user : await getUserData(userId, false)
        user = user ? user : { displayName: 'Removed user' }
        setUser(user)
    }

    useEffect(() => {
        updateUser()
    }, [userId])

    const displayName = user ? user.displayName : 'Loading user...'
    const photoURL = user ? user.photoURL : ''

    return (
        <View style={localStyles.container}>
            <Avatar avatarId={userId} reviewerPhotoURL={photoURL} borderSize={0} externalStyle={localStyles.image} />
            <Text style={localStyles.name}>{displayName}</Text>
            {!hideRemoveButton && (
                <TouchableOpacity style={localStyles.iconContainer} onPress={onPress}>
                    <Icon name={'x-circle'} size={14.67} color={colors.Text03} />
                </TouchableOpacity>
            )}
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        width: 'auto',
        height: 24,
        backgroundColor: colors.Grey300,
        borderRadius: 10,
        flexDirection: 'row',
        alignItems: 'center',
        marginRight: 16,
        marginTop: 4,
    },
    name: {
        ...styles.caption1,
        color: colors.Text03,
        marginRight: 12.67,
    },
    iconContainer: {
        marginLeft: 'auto',
        marginRight: 4.67,
    },
    image: {
        width: 20,
        height: 20,
        borderRadius: 100,
        marginLeft: 2,
        marginRight: 8.67,
    },
})
