import React from 'react'
import { Image, StyleSheet, View } from 'react-native'

import SVGGenericUser from '../../../assets/svg/SVGGenericUser'

export default function AssistantAvatar({ photoURL, assistantId, size, containerStyle, imageStyle }) {
    return (
        <View style={[localStyles.container, containerStyle]}>
            <View style={localStyles.imageContainer}>
                {photoURL ? (
                    <Image
                        style={[localStyles.image, { width: size, height: size }, imageStyle]}
                        source={{ uri: photoURL }}
                    />
                ) : (
                    <View style={[localStyles.image, { width: size, height: size }, imageStyle]}>
                        <SVGGenericUser width={size} height={size} svgid={assistantId} />
                    </View>
                )}
            </View>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    image: {
        borderRadius: 100,
        overflow: 'hidden',
    },
    imageContainer: {
        flex: 1,
    },
})
