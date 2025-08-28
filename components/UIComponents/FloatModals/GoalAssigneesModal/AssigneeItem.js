import React from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'

import styles, { colors } from '../../../styles/global'
import Icon from '../../../Icon'
import { capacityDataMap } from '../../../GoalsView/GoalsHelper'
import SelectedAvatar from './SelectedAvatar'
import Avatar from '../../../Avatar'
import { isWorkstream } from '../../../Workstreams/WorkstreamHelper'

export default function AssigneeItem({ user, toggleSelection, isSelected, capacityKey, openCapacityModal }) {
    const { displayName, photoURL, uid } = user
    const { capacityValue } = capacityDataMap[capacityKey]

    const selectUser = e => {
        e?.preventDefault()
        e?.stopPropagation()
        toggleSelection(isSelected, uid)
    }

    const openCapacity = () => {
        openCapacityModal(uid)
    }
    const userIsWorkstream = isWorkstream(user.uid)
    const allowCapacity = !userIsWorkstream
    return (
        <View style={localStyles.container}>
            <TouchableOpacity style={localStyles.userData} onPress={selectUser}>
                {isSelected ? (
                    <SelectedAvatar userId={uid} photoURL={photoURL} userIsWorkstream={userIsWorkstream} />
                ) : (
                    <Avatar
                        avatarId={uid}
                        reviewerPhotoURL={photoURL}
                        size={userIsWorkstream ? 24 : 32}
                        borderSize={0}
                        externalStyle={userIsWorkstream ? localStyles.workstream : { marginRight: 8 }}
                    />
                )}
                <Text style={localStyles.text}>{displayName}</Text>
            </TouchableOpacity>
            {allowCapacity && (
                <TouchableOpacity style={{ flexDirection: 'row' }} onPress={openCapacity}>
                    <View
                        style={[
                            localStyles.capacityValueContainer,
                            isSelected && localStyles.capacityValueContainerSelected,
                        ]}
                    >
                        <Text style={[localStyles.capacityValue, isSelected && localStyles.capacityValueSelected]}>
                            {capacityValue}
                        </Text>
                    </View>
                    <Icon name="chevron-right" color={colors.Text03} size={24} />
                </TouchableOpacity>
            )}
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        height: 48,
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    userData: {
        flexDirection: 'row',
        alignItems: 'center',
        flex: 1,
    },
    text: {
        ...styles.subtitle1,
        color: '#ffffff',
    },
    capacityValueContainer: {
        borderRadius: 12,
        height: 24,
        backgroundColor: colors.Grey300,
        paddingHorizontal: 8,
        paddingVertical: 1,
        flexDirection: 'row',
        alignItems: 'center',
        marginRight: 4,
    },
    capacityValue: {
        ...styles.subtitle2,
        color: colors.Text03,
    },
    capacityValueContainerSelected: {
        backgroundColor: colors.Primary200,
    },
    capacityValueSelected: {
        color: '#ffffff',
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
