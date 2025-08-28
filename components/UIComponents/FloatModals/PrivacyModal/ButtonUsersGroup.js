import React from 'react'
import { Image, StyleSheet, Text, View } from 'react-native'
import { useSelector } from 'react-redux'
import { findIndex } from 'lodash'

import styles, { colors } from '../../../styles/global'
import { MAX_VIEWERS_TO_SHOW } from './PrivacyConstants'

export default function ButtonUsersGroup({ projectId, users, inTag = false }) {
    const usersInProject = useSelector(state => state.projectUsers[projectId])
    let userObjects = []

    for (let userId of users) {
        const index = findIndex(usersInProject, ['uid', userId])
        if (index >= 0) {
            userObjects.push(usersInProject[index])
        }
    }

    const usersToShow = userObjects.slice(
        0,
        userObjects.length > MAX_VIEWERS_TO_SHOW ? MAX_VIEWERS_TO_SHOW : userObjects.length
    )
    const diff = userObjects.length - usersToShow.length

    const renderAvatar = (uri, index) => {
        const style =
            userObjects.length > 1 && index > 0 ? (inTag ? tagStyles.avatarOverlap : localStyles.avatarOverlap) : null
        return (
            <Image key={index} style={[localStyles.avatar, inTag && tagStyles.avatar, style]} source={{ uri: uri }} />
        )
    }

    const renderPlus = () => {
        return (
            <View style={[localStyles.rest, inTag && tagStyles.rest]}>
                <Text style={localStyles.restText}>{`+${diff}`}</Text>
            </View>
        )
    }

    return (
        <View style={localStyles.container}>
            {usersToShow.map((user, i) => renderAvatar(user.photoURL, i))}
            {diff > 0 && renderPlus()}
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flexDirection: 'row',
    },
    avatar: {
        width: 24,
        height: 24,
        borderRadius: 100,
    },
    rest: {
        width: 24,
        height: 24,
        borderRadius: 100,
        flexDirection: 'row',
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: colors.Grey400,
        marginLeft: -10,
    },
    restText: {
        ...styles.caption1,
        color: colors.Text02,
    },
    avatarOverlap: {
        marginLeft: -10,
    },
})

const tagStyles = StyleSheet.create({
    avatar: {
        width: 20,
        height: 20,
    },
    rest: {
        width: 20,
        height: 20,
        marginLeft: -8,
    },
    avatarOverlap: {
        marginLeft: -8,
    },
})
