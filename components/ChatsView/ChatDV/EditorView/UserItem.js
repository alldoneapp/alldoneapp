import React from 'react'
import { Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import HelperFunctions from '../../../../utils/HelperFunctions'
import Icon from '../../../Icon'
import global, { colors } from '../../../styles/global'

const UserItem = ({ user, selectUser, selected = false }) => {
    return (
        <View style={{ paddingHorizontal: 8 }}>
            <TouchableOpacity
                accessible={false}
                style={[localStyles.innerContainer, selected && { backgroundColor: 'rgba(139, 149, 167, 0.22)' }]}
                onPress={() => selectUser(user)}
            >
                <Image
                    source={{ uri: user.photoURL }}
                    style={[localStyles.userImage, selected && localStyles.circle]}
                />
                <Text style={[localStyles.members, selected && { color: colors.Primary100 }]}>
                    {HelperFunctions.getFNameFLastN(user.displayName)}
                </Text>
                {selected && <Icon name={'check'} size={24} color="#fff" style={{ marginLeft: 'auto' }} />}
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
