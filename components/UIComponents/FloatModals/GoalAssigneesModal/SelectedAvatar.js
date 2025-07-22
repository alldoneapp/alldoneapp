import React from 'react'
import { StyleSheet, View } from 'react-native'

import { colors } from '../../../styles/global'
import Icon from '../../../Icon'
import Avatar from '../../../Avatar'

export default function SelectedAvatar({ photoURL, userIsWorkstream, userId }) {
    return (
        <View style={[localStyles.container, localStyles.avatar]}>
            <Avatar
                avatarId={userId}
                reviewerPhotoURL={photoURL}
                size={userIsWorkstream ? 24 : 32}
                borderSize={0}
                externalStyle={userIsWorkstream && localStyles.workstream}
            />
            <View style={localStyles.border} />
            <View style={localStyles.check}>
                <Icon name="check" size={12} color="#ffffff" />
            </View>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        marginRight: 8,
    },
    avatar: {
        height: 32,
        width: 32,
        borderRadius: 100,
    },
    border: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        borderRadius: 100,
        borderWidth: 2,
        borderColor: colors.Primary100,
    },
    check: {
        position: 'absolute',
        right: -2,
        bottom: -2,
        width: 16,
        height: 16,
        backgroundColor: colors.Primary100,
        borderRadius: 100,
        justifyContent: 'center',
        alignItems: 'center',
    },
    workstream: {
        alignItems: 'center',
        justifyContent: 'center',
        width: 32,
        height: 32,
        borderRadius: 100,
        overflow: 'hidden',
        marginRight: 8,
        backgroundColor: 'transparent',
    },
})
