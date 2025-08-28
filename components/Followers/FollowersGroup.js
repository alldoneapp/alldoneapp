import React from 'react'
import { View, StyleSheet } from 'react-native'

import FollowerAvatarWrapper from './FollowerAvatarWrapper'
import PlusButtonWrapper from './PlusButtonWrapper'
import { MAX_USERS_TO_SHOW } from './FollowerConstants'

export default function FollowersGroup({ followersIds, users, markAssignee = false, followObjectsType }) {
    const followers = []
    const followersToShow = []
    let count = 0
    for (let i = 0; i < followersIds.length; i++) {
        if (followersIds[i] !== undefined && users[followersIds[i]] !== undefined) {
            count++
            const user = users[followersIds[i]]
            followers.push(user)
            if (count <= MAX_USERS_TO_SHOW) {
                followersToShow.push(user)
            }
        }
    }

    return (
        <View style={localStyles.container}>
            {followersToShow.map(
                (user, index) =>
                    user && (
                        <View
                            key={user.uid}
                            style={followersToShow.length > 1 && index > 0 ? localStyles.avatarOverlap : null}
                        >
                            <FollowerAvatarWrapper
                                key={user.uid}
                                avatarUrl={user.photoURL}
                                followers={followers}
                                markAssignee={markAssignee}
                                followObjectsType={followObjectsType}
                            />
                        </View>
                    )
            )}
            {followers.length > MAX_USERS_TO_SHOW && (
                <PlusButtonWrapper
                    followers={followers}
                    markAssignee={markAssignee}
                    followObjectsType={followObjectsType}
                />
            )}
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        marginLeft: 16,
        flexDirection: 'row',
    },
    avatarOverlap: {
        marginLeft: -12,
    },
})
