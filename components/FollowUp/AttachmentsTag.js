import React, { useState } from 'react'

import { Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import styles, { colors, windowTagStyle } from '../styles/global'
import Icon from '../Icon'

const AttachmentsTag = ({ text, removeTag, ico, icoImgUrl, imageUrl, style, maxWidth }) => {
    const [isHidden, setIsHidden] = useState(true)
    const [textToShow, setTextToShow] = useState(text)

    const onLayout = data => {
        const width = data.nativeEvent.layout.width
        if (maxWidth && width > maxWidth) {
            const newTextToShow =
                textToShow.substring(textToShow.length - 3) === '...'
                    ? `${textToShow.substring(0, textToShow.length - 4)}...`
                    : `${textToShow}...`
            setTextToShow(newTextToShow)
        } else {
            setIsHidden(false)
        }
    }

    return (
        <View style={[localStyles.container, style, isHidden ? { opacity: 0 } : null]} onLayout={onLayout}>
            {imageUrl ? (
                <Image style={localStyles.image} source={{ uri: imageUrl }}></Image>
            ) : (
                <View style={localStyles.icon}>
                    {icoImgUrl ? <Image style={localStyles.iconImage} source={{ uri: icoImgUrl }}></Image> : null}
                    <Icon name={ico} size={16} color={colors.Text03} />
                </View>
            )}

            <Text style={[styles.subtitle2, localStyles.text, windowTagStyle()]}>{textToShow}</Text>
            {removeTag ? (
                <View style={localStyles.removeContainer}>
                    <TouchableOpacity style={localStyles.button} onPress={removeTag}>
                        <Icon name="x-circle" size={16} color={colors.Text03} />
                    </TouchableOpacity>
                </View>
            ) : null}
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        backgroundColor: colors.Gray300,
        borderRadius: 12,
        alignItems: 'center',
        height: 24,
        alignSelf: 'flex-start',
    },
    icon: {
        marginLeft: 5.33,
        marginRight: 7.33,
        flexDirection: 'row',
        alignSelf: 'center',
    },
    iconImage: {
        width: 16,
        height: 16,
        borderRadius: 100,
        marginLeft: 2,
        marginRight: 4,
    },
    text: {
        color: colors.Text03,
        marginRight: 8,
    },
    button: {
        marginRight: 4.67,
        marginLeft: 0.67,
    },
    removeContainer: {
        flexDirection: 'row',
        flexGrow: 1,
        justifyContent: 'flex-end',
    },
    image: {
        width: 20,
        height: 20,
        borderRadius: 100,
        marginLeft: 2,
        marginRight: 4,
    },
})

export default AttachmentsTag
