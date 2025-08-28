import React, { useEffect, useState } from 'react'
import { StyleSheet, Text, TouchableOpacity } from 'react-native'
import { useSelector } from 'react-redux'

import styles, { colors } from '../styles/global'
import Icon from '../Icon'
import { getAttachmentTagName, LOADING_MODE } from '../Feeds/CommentsTextInput/textInputHelper'
import Spinner from '../UIComponents/Spinner'
import { getCustomStyle, getFileSize } from '../../utils/HelperFunctions'
import { checkIsLimitedByTraffic } from '../Premium/PremiumHelper'

export default function FileDownloadableTag({
    projectId,
    text,
    uri,
    style,
    inDetaliedView,
    isLoading,
    disabled,
    useCommentTagStyle,
    iconSize,
    textStyle,
}) {
    const virtualQuillLoaded = useSelector(state => state.virtualQuillLoaded)
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)
    const isMiddleScreen = useSelector(state => state.isMiddleScreen)
    const { uid } = useSelector(state => state.loggedUser)
    const [textToShow, setTextToShow] = useState('')

    const downloadFile = () => {
        if (!checkIsLimitedByTraffic(projectId)) {
            window.open(uri, '_blank')
            getFileSize(projectId, uri, uid)
        }
    }

    useEffect(() => {
        if (!virtualQuillLoaded) {
            const fileName = getAttachmentTagName(text, smallScreenNavigation, isMiddleScreen)
            setTextToShow(fileName)
        }
    }, [smallScreenNavigation, isMiddleScreen])

    return (
        <TouchableOpacity
            disabled={isLoading === LOADING_MODE || disabled}
            onPress={downloadFile}
            onClick={e => {
                e.stopPropagation()
            }}
            style={[localStyles.tag, getCustomStyle(inDetaliedView, null, useCommentTagStyle), style]}
        >
            {isLoading === LOADING_MODE ? (
                <Spinner containerSize={iconSize || 16} spinnerSize={iconSize || 16} />
            ) : (
                <Icon
                    name={'file'}
                    size={iconSize || (inDetaliedView ? 18 : useCommentTagStyle ? 14 : 16)}
                    color={colors.Text03}
                />
            )}
            <Text
                style={[
                    localStyles.text,
                    inDetaliedView ? localStyles.detaliedViewtext : useCommentTagStyle && localStyles.commentText,
                    textStyle,
                ]}
                numberOfLines={1}
            >
                {textToShow}
            </Text>
        </TouchableOpacity>
    )
}

const localStyles = StyleSheet.create({
    tag: {
        display: 'inline-flex',
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: colors.Gray300,
        borderRadius: 50,
        paddingLeft: 5.33,
        paddingRight: 8,
        height: 24,
        maxWidth: '100%',
    },
    text: {
        fontFamily: 'Roboto-Medium',
        fontSize: 14,
        color: colors.Text03,
        marginLeft: 7.33,
        marginTop: 1,
    },
    detaliedViewtext: {
        ...styles.title6,
        color: colors.Text03,
    },
    commentText: {
        ...styles.caption1,
        color: colors.Text03,
        marginLeft: 4.33,
    },
})
