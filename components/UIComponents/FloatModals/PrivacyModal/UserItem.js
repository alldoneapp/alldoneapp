import React, { useState, useEffect } from 'react'
import { Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native'

import styles, { colors, hexColorToRGBa } from '../../../styles/global'
import Icon from '../../../Icon'
import SVGGenericUser from '../../../../assets/svg/SVGGenericUser'
import { DEFAULT_WORKSTREAM_ID, getWorkstreamById, WORKSTREAM_ID_PREFIX } from '../../../Workstreams/WorkstreamHelper'
import { translate } from '../../../../i18n/TranslationService'
import TasksHelper from '../../../TaskListView/Utils/TasksHelper'

export default function UserItem({
    isOwner,
    ownerText,
    selected,
    hovered,
    onPress,
    itemsRefs,
    itemRefIndex,
    userId,
    projectId,
}) {
    const [user, setUser] = useState(null)

    useEffect(() => {
        const isWorkstream = userId.startsWith(WORKSTREAM_ID_PREFIX)
        const user = isWorkstream ? getWorkstreamById(projectId, userId) : TasksHelper.getPeopleById(userId, projectId)
        setUser(user)
    }, [userId])

    if (!user) return null

    const { uid, photoURL, displayName } = user

    return (
        <View ref={ref => (itemsRefs[itemRefIndex] = ref)}>
            <TouchableOpacity onPress={e => onPress(e, uid)} accessible={false}>
                <View style={[localStyles.elementItem, hovered && localStyles.itemSelected]}>
                    <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center' }}>
                        {uid.startsWith(WORKSTREAM_ID_PREFIX) ? (
                            <View style={[localStyles.userImage, hovered && localStyles.userImageSelected]}>
                                <Icon size={24} name="workstream" color={colors.Text03} />
                            </View>
                        ) : photoURL ? (
                            <Image
                                source={{ uri: photoURL }}
                                style={[localStyles.userImage, hovered && localStyles.userImageSelected]}
                            />
                        ) : (
                            <View style={[localStyles.userImage, hovered && localStyles.userImageSelected]}>
                                <SVGGenericUser
                                    width={hovered ? 28 : 32}
                                    height={hovered ? 28 : 32}
                                    svgid={`av-priv-${uid}`}
                                />
                            </View>
                        )}
                        <View style={localStyles.itemTexts}>
                            <Text
                                style={[
                                    styles.subtitle1,
                                    localStyles.itemName,
                                    selected && localStyles.itemNameSelected,
                                ]}
                                numberOfLines={1}
                            >
                                {displayName !== ''
                                    ? uid === DEFAULT_WORKSTREAM_ID
                                        ? translate(displayName)
                                        : displayName
                                    : translate('Unknown user')}
                            </Text>
                            <Text
                                style={[
                                    styles.caption1,
                                    localStyles.itemSubName,
                                    (selected || isOwner) && localStyles.itemSubNameSelected,
                                ]}
                                numberOfLines={1}
                            >
                                {ownerText}
                            </Text>
                        </View>
                    </View>
                    {selected || isOwner ? (
                        <Icon name={'check'} size={24} color={isOwner ? colors.Text02 : 'white'} />
                    ) : (
                        <View style={{ width: 24, height: 24 }} />
                    )}
                </View>
            </TouchableOpacity>
        </View>
    )
}

const localStyles = StyleSheet.create({
    elementItem: {
        height: 48,
        paddingVertical: 12,
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingLeft: 8,
        paddingRight: 8,
    },
    itemSelected: {
        backgroundColor: hexColorToRGBa(colors.Text03, 0.16),
        borderRadius: 4,
    },
    userImage: {
        flexDirection: 'row',
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: 'transparent',
        height: 32,
        width: 32,
        borderRadius: 100,
        overflow: 'hidden',
    },
    userImageSelected: {
        borderWidth: 2,
        borderColor: colors.Primary100,
    },
    itemTexts: {
        flexDirection: 'row',
        alignItems: 'baseline',
    },
    itemName: {
        color: '#ffffff',
        marginLeft: 8,
    },
    itemSubName: {
        color: colors.Text04,
        marginLeft: 8,
    },
    itemSubNameSelected: {
        color: colors.Primary300,
    },
})
