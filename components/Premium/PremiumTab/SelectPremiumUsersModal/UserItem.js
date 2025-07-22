import React from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'

import styles, { colors } from '../../../styles/global'
import Icon from '../../../Icon'
import SelectedAvatar from '../../../UIComponents/FloatModals/GoalAssigneesModal/SelectedAvatar'
import Avatar from '../../../Avatar'

export default function UserItem({ user, toggleSelection, isSelected, paidByOtherUser }) {
    const { displayName, photoURL, uid } = user

    const selectUser = () => {
        toggleSelection(isSelected, uid)
    }

    return (
        <View style={[localStyles.container, paidByOtherUser && { opacity: 0.5 }]}>
            <TouchableOpacity style={localStyles.userDataContainer} onPress={selectUser} disabled={paidByOtherUser}>
                <View style={localStyles.userData}>
                    {isSelected ? (
                        <SelectedAvatar photoURL={photoURL} />
                    ) : (
                        <Avatar
                            avatarId={uid}
                            reviewerPhotoURL={photoURL}
                            size={32}
                            borderSize={0}
                            externalStyle={{ marginRight: 8 }}
                        />
                    )}
                    <Text style={localStyles.text}>{displayName}</Text>
                </View>
                {(isSelected || paidByOtherUser) && <Icon name="crown" color={colors.Text03} size={24} />}
            </TouchableOpacity>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        height: 48,
        flexDirection: 'row',
        alignItems: 'center',
        marginHorizontal: 8,
    },
    userDataContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        flex: 1,
        justifyContent: 'space-between',
    },
    userData: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    text: {
        ...styles.subtitle1,
        color: '#ffffff',
    },
})
