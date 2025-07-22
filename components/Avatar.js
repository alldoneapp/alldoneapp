import React from 'react'
import { View, Image, StyleSheet } from 'react-native'
import { colors } from './styles/global'
import SVGGenericUser from '../assets/svg/SVGGenericUser'
import { WORKSTREAM_ID_PREFIX } from './Workstreams/WorkstreamHelper'
import Icon from './Icon'

const Avatar = ({
    avatarId,
    workstreamBackgroundColor,
    reviewerPhotoURL,
    externalStyle,
    highlight,
    size = 20,
    borderSize = 2,
}) => {
    const isWorkstream = avatarId?.startsWith(WORKSTREAM_ID_PREFIX)
    return (
        <View
            style={[
                localStyles.outline,
                isWorkstream && { backgroundColor: workstreamBackgroundColor ? workstreamBackgroundColor : '#ffffff' },
                highlight && { backgroundColor: colors.Primary100 },
                size && { width: size + borderSize * 2, height: size + borderSize * 2 },
                externalStyle,
            ]}
        >
            {isWorkstream ? (
                <Icon size={size} name="workstream" color={highlight ? '#ffffff' : colors.Text03} />
            ) : reviewerPhotoURL != null && reviewerPhotoURL !== '' ? (
                <Image
                    style={[localStyles.userImage, size && { width: size, height: size }]}
                    source={{ uri: reviewerPhotoURL }}
                />
            ) : (
                <View style={[localStyles.userImage, size && { width: size, height: size }, { overflow: 'hidden' }]}>
                    <SVGGenericUser width={size} height={size} svgid={`ci_p_observed_list_${avatarId}`} />
                </View>
            )}
        </View>
    )
}

export default Avatar

const localStyles = StyleSheet.create({
    outline: {
        width: 24,
        height: 24,
        borderRadius: 100,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: colors.Text03,
    },
    userImage: {
        width: 20,
        height: 20,
        borderRadius: 100,
    },
})
