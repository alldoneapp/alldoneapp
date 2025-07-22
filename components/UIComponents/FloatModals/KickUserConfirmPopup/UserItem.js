import React from 'react'
import { Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native'

import styles, { colors } from '../../../styles/global'
import Icon from '../../../Icon'

export default function UserItem({ user, selectedUserId, setSelectedUserId, inProgress }) {
    const { uid, photoURL, displayName } = user
    return (
        <TouchableOpacity onPress={() => setSelectedUserId(uid)} disabled={inProgress}>
            <View style={localStyles.userItem}>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <Image source={{ uri: photoURL }} style={localStyles.userImage} />
                    <Text style={[styles.subtitle1, { color: '#ffffff', marginLeft: 8 }]}>{displayName}</Text>
                </View>
                {selectedUserId === uid && <Icon name="check" size={24} color="white" />}
            </View>
        </TouchableOpacity>
    )
}

const localStyles = StyleSheet.create({
    userItem: {
        height: 48,
        paddingVertical: 12,
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    userImage: {
        backgroundColor: colors.Text03,
        height: 32,
        width: 32,
        borderRadius: 100,
    },
})
