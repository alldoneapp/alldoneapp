import React, { useState } from 'react'
import { Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import HelperFunctions from '../../utils/HelperFunctions'
import Icon from '../Icon'
import global, { colors } from '../styles/global'

const UserItem = ({ user, selectUser, all }) => {
    const [marked, setMarked] = useState(false)
    return (
        <View style={{ paddingHorizontal: 8 }}>
            <TouchableOpacity
                accessible={false}
                style={[localStyles.innerContainer, !all && marked && { backgroundColor: 'rgba(139, 149, 167, 0.22)' }]}
                onPress={() => {
                    setMarked(!marked)
                    selectUser(user)
                }}
            >
                <Image
                    source={{ uri: user.photoURL }}
                    style={[localStyles.userImage, !all && marked && localStyles.circle]}
                />
                <Text style={[localStyles.members, !all && marked && { color: colors.Primary100 }]}>
                    {HelperFunctions.getFNameFLastN(user.displayName)}
                </Text>
                {!all ? marked && <Icon name={'check'} size={24} color="#fff" style={{ marginLeft: 'auto' }} /> : null}
            </TouchableOpacity>
        </View>
    )
}

const localStyles = StyleSheet.create({
    innerContainer: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        borderRadius: 4,
        paddingVertical: 8,
        paddingHorizontal: 8,
    },
    userImage: {
        height: 32,
        width: 32,
        borderRadius: 100,
        marginRight: 8,
    },
    circle: {
        borderWidth: 2,
        borderColor: colors.Primary100,
    },
    members: {
        ...global.subtitle1,
        color: 'white',
    },
})

export default UserItem
