import React from 'react'
import { StyleSheet, Text, TouchableOpacity } from 'react-native'

import Icon from '../Icon'
import styles, { colors, windowTagStyle } from '../styles/global'
import { dismissAllPopups, getCustomStyle } from '../../utils/HelperFunctions'
import { getCommentTagColors, getCommentTagParsed } from '../Feeds/Utils/HelperFunctions'

export default function TaskCommentsTag({
    commentsData,
    isOpen,
    onOpen,
    onClose,
    style,
    isInDetailView,
    accessibilityLabel,
    disabled,
    inTextInput,
    inDetailView,
    outline,
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

    const outlineStyle = (border = true) => {
        return border
            ? {
                  borderWidth: 1,
                  borderColor:
                      backgroundColor === colors.Grey300
                          ? colors.UtilityBlue200
                          : backgroundColor === colors.UtilityGreen112
                          ? colors.UtilityGreen150
                          : backgroundColor === colors.UtilityOrange112
                          ? colors.UtilityOrange150
                          : backgroundColor,
              }
            : fontColor === colors.Text03
            ? colors.UtilityBlue200
            : fontColor
    }

    return (
        <TouchableOpacity
            accessibilityLabel={accessibilityLabel}
            style={[
                inTextInput ? localStyles.inTextInput : (outline ? otl : localStyles).container,
                { backgroundColor: outline ? 'transparent' : backgroundColor },
                outline && outlineStyle(),
                getCustomStyle(inDetailView, null, false),
                style,
            ]}
            onPress={onPress}
            disabled={disabled}
        >
            <Icon
                accessibilityLabel={accessibilityLabel}
                name={'message-circle'}
                color={outline ? outlineStyle(false) : fontColor}
                size={outline ? 14 : inDetailView ? 18 : 16}
            />
            <Text
                accessibilityLabel={accessibilityLabel}
                numberOfLines={1}
                style={[
                    (outline ? otl : localStyles).text,
                    inDetailView && { ...styles.title6 },
                    { color: outline ? outlineStyle(false) : fontColor },
                    windowTagStyle(),
                ]}
            >
                {parsedComment}
            </Text>
        </TouchableOpacity>
    )
}

const localStyles = StyleSheet.create({
    container: {
        borderRadius: 50,
        paddingLeft: 5.33,
        paddingRight: 8,
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
        maxWidth: '100%',
    },
    text: {
        ...styles.subtitle2,
        marginLeft: 5.33,
    },
})

const otl = StyleSheet.create({
    container: {
        borderRadius: 50,
        paddingLeft: 5.33,
        paddingRight: 8,
        flexDirection: 'row',
        alignItems: 'center',
        marginLeft: 2,
        overflow: 'hidden',
        height: 20,
        maxHeight: 20,
        minHeight: 20,
    },
    text: {
        ...styles.caption1,
        marginLeft: 5.33,
    },
})
