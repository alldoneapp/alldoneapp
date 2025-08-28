import React from 'react'
import { StyleSheet, Text, TouchableOpacity } from 'react-native'

import Icon from '../Icon'
import styles, { windowTagStyle } from '../styles/global'
import { dismissAllPopups } from '../../utils/HelperFunctions'
import { getCommentTagColors, getCommentTagParsed } from '../Feeds/Utils/HelperFunctions'

export default function ObjectCommentsTag({
    commentsData,
    isOpen,
    onOpen,
    onClose,
    style,
    isInDetailView,
    accessibilityLabel,
    disabled,
    inTextInput,
}) {
    const { lastComment, lastCommentType, amount } = commentsData
    const { backgroundColor, fontColor } = getCommentTagColors(lastCommentType)
    const parsedComment = getCommentTagParsed(lastComment, amount)

    const onPress = () => {
        if (isOpen && !isInDetailView) {
            onClose()
        } else {
            dismissAllPopups()
            onOpen()
        }
    }

    return (
        <TouchableOpacity
            accessibilityLabel={accessibilityLabel}
            style={[
                inTextInput ? localStyles.inTextInput : localStyles.container,
                { backgroundColor: backgroundColor },
                style,
            ]}
            onPress={onPress}
            disabled={disabled}
            accessible={false}
        >
            <Icon accessibilityLabel={accessibilityLabel} name="message-circle" color={fontColor} size={16} />
            <Text
                accessibilityLabel={accessibilityLabel}
                numberOfLines={1}
                style={[localStyles.text, { color: fontColor }, windowTagStyle()]}
            >
                {parsedComment}
            </Text>
        </TouchableOpacity>
    )
}

const localStyles = StyleSheet.create({
    container: {
        height: 24,
        maxHeight: 24,
        borderRadius: 12,
        paddingLeft: 5.33,
        paddingRight: 10,
        flexDirection: 'row',
        alignItems: 'center',
        marginLeft: 8,
        overflow: 'hidden',
    },
    inTextInput: {
        ...styles.subtitle2,
        display: 'inline-flex',
        flexDirection: 'row',
        alignItems: 'center',
        borderRadius: 50,
        fontSize: 18,
        paddingLeft: 4,
        paddingRight: 8,
        height: 24,
        maxWidth: '100%',
    },
    text: {
        ...styles.subtitle2,
        marginLeft: 5.33,
    },
})
