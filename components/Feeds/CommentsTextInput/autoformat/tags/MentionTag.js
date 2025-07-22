import React from 'react'
import { Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native'

import styles, { colors, windowTagStyle } from '../../../../styles/global'
import Icon from '../../../../Icon'
import { NOT_USER_MENTIONED } from '../../textInputHelper'
import { getUserOrContactForMentions, MENTION_SPACE_CODE } from '../../../Utils/HelperFunctions'
import SVGGenericUser from '../../../../../assets/svg/SVGGenericUser'

export default function MentionTag({ mentionData, onPress, projectId, disabled }) {
    const { text = '', userId = '' } = mentionData
    const parsedText = text.replaceAll(MENTION_SPACE_CODE, ' ').substring(0, 25)
    const user = userId === NOT_USER_MENTIONED ? null : getUserOrContactForMentions(projectId, userId)

    return (
        <View style={localStyles.container}>
            <TouchableOpacity style={localStyles.button} onPress={onPress} disabled={disabled}>
                {user && <Text style={{ fontFamily: 'alldone', fontSize: 16 }}></Text>}
                {user ? (
                    user.photoURL ? (
                        <Image source={{ uri: user.photoURL }} style={localStyles.avatar} />
                    ) : (
                        <View style={[localStyles.svg, localStyles.avatar]}>
                            <SVGGenericUser width={20} height={20} svgid={'asdasd213123'} />
                        </View>
                    )
                ) : (
                    <Icon name={'at-sign'} size={16} color={colors.Green300} />
                )}
                <Text style={[localStyles.name, user && { marginLeft: 4 }, windowTagStyle()]} numberOfLines={1}>
                    {parsedText}
                </Text>
            </TouchableOpacity>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        display: 'inline-flex',
        maxWidth: '100%',
    },
    button: {
        ...styles.subtitle2,
        flexDirection: 'row',
        alignItems: 'center',
        paddingLeft: 4,
        paddingRight: 8,
        backgroundColor: colors.Green125,
        borderRadius: 50,
        height: 24,
        fontSize: 18,
    },
    name: {
        ...styles.subtitle2,
        color: colors.Green300,
        marginLeft: 5.6,
    },
    avatar: {
        width: 20,
        height: 20,
        borderRadius: 100,
        position: 'absolute',
        left: 2,
    },
    svg: {
        overflow: 'hidden',
    },
})
