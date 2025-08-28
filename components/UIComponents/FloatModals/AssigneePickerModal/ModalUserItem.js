import React from 'react'
import { Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { useSelector } from 'react-redux'

import { DEFAULT_WORKSTREAM_ID, WORKSTREAM_ID_PREFIX } from '../../../Workstreams/WorkstreamHelper'
import Icon from '../../../Icon'
import styles, { colors, hexColorToRGBa } from '../../../styles/global'
import { translate } from '../../../../i18n/TranslationService'
import { ALL_GOALS_ID } from '../../../AllSections/allSectionHelper'

export default function ModalUserItem({ user, hoverUserId, selectedUserId, onPress }) {
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)
    const isHovered = hoverUserId === user.uid
    const isSelected = selectedUserId === user.uid

    return (
        <TouchableOpacity key={user.uid} onPress={e => onPress(e, user)}>
            <View style={[localStyles.userItem, isHovered && localStyles.itemSelected]}>
                <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center' }}>
                    {user.uid.startsWith(WORKSTREAM_ID_PREFIX) ? (
                        <View style={[localStyles.streamIcon, isHovered && localStyles.userImageSelected]}>
                            <Icon size={24} name="workstream" color={isHovered ? colors.Primary100 : '#ffffff'} />
                        </View>
                    ) : user.uid === ALL_GOALS_ID ? (
                        <View style={[localStyles.streamIcon, isHovered && localStyles.userImageSelected]}>
                            <Icon size={24} name="circle" color={isHovered ? colors.Primary100 : '#ffffff'} />
                        </View>
                    ) : (
                        <Image
                            source={{ uri: user.photoURL }}
                            style={[localStyles.userImage, isHovered && localStyles.userImageSelected]}
                        />
                    )}

                    <Text
                        style={[styles.subtitle1, localStyles.userName, isHovered && localStyles.userNameSelected]}
                        numberOfLines={1}
                    >
                        {user.uid === DEFAULT_WORKSTREAM_ID ? translate(user.displayName) : user.displayName}
                    </Text>
                </View>
                {isSelected && !smallScreenNavigation && (
                    <Text style={[styles.body2, { color: colors.Text03, marginRight: 8 }]}>{translate('View')}</Text>
                )}
                {isSelected ? (
                    <Icon name="check" size={24} color="white" />
                ) : (
                    <View style={{ width: 24, height: 24 }} />
                )}
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
    itemSelected: {
        backgroundColor: hexColorToRGBa(colors.Text03, 0.16),
        borderRadius: 4,
        marginLeft: -8,
        paddingLeft: 8,
        marginRight: -8,
        paddingRight: 8,
    },
    userImage: {
        backgroundColor: colors.Text03,
        height: 32,
        width: 32,
        borderRadius: 100,
    },
    streamIcon: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        height: 32,
        width: 32,
        borderRadius: 100,
    },
    userImageSelected: {
        borderWidth: 2,
        borderColor: colors.Primary100,
    },
    userName: {
        color: '#ffffff',
        marginLeft: 8,
    },
    userNameSelected: {
        color: colors.Primary100,
    },
})
