import React from 'react'
import { Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import Icon from '../Icon'
import styles, { colors, hexColorToRGBa } from '../styles/global'

export default function WorkflowUserItem({ user, selected, closePopover, active }) {
    const select = () => {
        const step = {
            uid: user.uid,
            photoURL: user.photoURL,
            displayName: user.displayName,
        }
        closePopover(step)
    }

    return (
        <TouchableOpacity style={[localStyles.container, active && localStyles.activeContainer]} onPress={select}>
            <View style={localStyles.userContainer}>
                <Image
                    source={{ uri: user.photoURL }}
                    style={[localStyles.userImage, active && localStyles.userImageSelected]}
                />
                <Text style={[styles.subtitle1, localStyles.userName, active && localStyles.userNameSelected]}>
                    {user.displayName}
                </Text>
            </View>
            {selected && (
                <View style={[localStyles.checkContainer]}>
                    <Icon name="check" size={24} color="white" />
                </View>
            )}
        </TouchableOpacity>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flex: 1,
        flexDirection: 'row',
        padding: 8,
        alignItems: 'center',
    },
    activeContainer: {
        backgroundColor: hexColorToRGBa(colors.Text03, 0.16),
        borderRadius: 4,
        marginHorizontal: 0,
        paddingHorizontal: 8,
    },
    userContainer: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    userImage: {
        width: 32,
        height: 32,
        marginRight: 8,
        borderRadius: 100,
    },
    userImageSelected: {
        borderWidth: 2,
        borderColor: colors.Primary100,
    },
    checkContainer: {
        marginLeft: 'auto',
    },
    userName: {
        color: 'white',
    },
    userNameSelected: {
        color: colors.Primary100,
    },
})
