import React, { useEffect, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { useSelector } from 'react-redux'

import styles, { colors } from '../styles/global'
import Icon from '../Icon'
import { getAttachmentTagName } from '../Feeds/CommentsTextInput/textInputHelper'
import { getCustomStyle } from '../../utils/HelperFunctions'

export default function MediaTag({ text, ico, style, useCommentTagStyle, iconSize, textStyle }) {
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)
    const isMiddleScreen = useSelector(state => state.isMiddleScreen)
    const [textToShow, setTextToShow] = useState('')

    useEffect(() => {
        const fileName = getAttachmentTagName(text, smallScreenNavigation, isMiddleScreen)
        setTextToShow(fileName)
    }, [smallScreenNavigation, isMiddleScreen])

    return (
        <View style={[localStyles.tag, getCustomStyle(false, null, useCommentTagStyle), style]}>
            <View
                style={[
                    localStyles.icoContainer,
                    useCommentTagStyle && localStyles.icoContainerComment,
                    iconSize && { width: iconSize + 2, height: iconSize + 2 },
                ]}
            >
                <Icon name={ico} size={iconSize || useCommentTagStyle ? 12 : 14} color="#ffffff" />
            </View>
            <Text
                style={[localStyles.text, useCommentTagStyle && localStyles.commentText, textStyle]}
                numberOfLines={1}
            >
                {textToShow}
            </Text>
        </View>
    )
}

const localStyles = StyleSheet.create({
    tag: {
        ...styles.subtitle2,
        display: 'inline-flex',
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: colors.UtilityDarkBlue125,
        borderRadius: 50,
        fontSize: 18,
        paddingLeft: 2,
        paddingRight: 8,
        height: 24,
        maxWidth: '100%',
    },
    icoContainer: {
        backgroundColor: colors.UtilityDarkBlue300,
        borderRadius: 10,
        width: 20,
        height: 20,
        justifyContent: 'center',
        alignItems: 'center',
    },
    icoContainerComment: {
        width: 18,
        height: 18,
    },
    text: {
        fontFamily: 'Roboto-Medium',
        fontSize: 14,
        color: colors.UtilityDarkBlue300,
        marginLeft: 4,
        marginTop: 1,
    },
    commentText: {
        ...styles.caption1,
        color: colors.UtilityDarkBlue300,
    },
})
