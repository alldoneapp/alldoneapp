import React, { useState } from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { useSelector } from 'react-redux'

import DvTypeIndicator from './DvTypeIndicator'
import styles, { colors } from '../styles/global'
import { translate } from '../../i18n/TranslationService'
import useLastEditDate from '../../hooks/useLastEditDate'

function LastEdited({ lastEditionDate, editorName, shortEditorName, useShortName, mobile }) {
    const editionText = useLastEditDate(lastEditionDate, 1000, mobile)
    const name = useShortName ? shortEditorName || editorName : editorName
    if (!editionText) return null
    const text = mobile
        ? `${editionText}${name ? ` ${translate('by')} ${name}` : ''}`
        : `${translate('edited')} ${editionText}${name ? ` ${translate('by')} ${name}` : ''}`

    return (
        <Text
            style={[localStyles.lastEdited, mobile && localStyles.lastEditedMobile]}
            numberOfLines={1}
            ellipsizeMode="tail"
        >
            {text}
        </Text>
    )
}

export default function DvTitleLayout({
    children,
    onPress,
    disabled,
    typeLabel,
    typeIcon,
    lastEditionDate,
    editorName,
    shortEditorName,
    hideLastEdited,
    maxHeight,
}) {
    const mobile = useSelector(state => state.smallScreenNavigation)
    const tablet = useSelector(state => state.isMiddleScreen)
    const [titleHeight, setTitleHeight] = useState(0)
    const maxTitleHeight = maxHeight == null ? null : Math.max(0, maxHeight - 32)

    return (
        <View style={localStyles.container}>
            <View style={[localStyles.titleFrame, maxTitleHeight != null && { maxHeight: maxTitleHeight }]}>
                <TouchableOpacity
                    style={localStyles.title}
                    onPress={onPress}
                    disabled={disabled}
                    onLayout={({ nativeEvent }) => setTitleHeight(nativeEvent.layout.height)}
                >
                    {children}
                </TouchableOpacity>
                {maxTitleHeight != null && titleHeight > maxTitleHeight && (
                    <Text style={localStyles.ellipsis}>...</Text>
                )}
            </View>
            <View style={[localStyles.meta, mobile && localStyles.metaMobile]}>
                <DvTypeIndicator label={typeLabel} icon={typeIcon} mobile={false} />
                {!hideLastEdited && lastEditionDate && (
                    <LastEdited
                        lastEditionDate={lastEditionDate}
                        editorName={editorName}
                        shortEditorName={shortEditorName}
                        useShortName={mobile || tablet}
                        mobile={mobile}
                    />
                )}
            </View>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        marginTop: 32,
        minWidth: 0,
    },
    titleFrame: {
        flex: 1,
        minWidth: 0,
        overflow: 'hidden',
    },
    title: {
        minWidth: 0,
    },
    ellipsis: {
        ...styles.title4,
        color: colors.Text01,
        backgroundColor: '#ffffff',
        paddingHorizontal: 8,
        position: 'absolute',
        bottom: 0,
        right: 0,
    },
    meta: {
        alignItems: 'flex-end',
        justifyContent: 'center',
        flexShrink: 1,
        maxWidth: '42%',
        minWidth: 0,
        marginLeft: 16,
        marginTop: 2,
    },
    metaMobile: {
        maxWidth: 128,
        marginLeft: 8,
    },
    lastEdited: {
        fontFamily: 'Roboto-Regular',
        fontSize: 11,
        lineHeight: 12,
        color: colors.Text03,
        textAlign: 'right',
        marginTop: 2,
        maxWidth: '100%',
    },
    lastEditedMobile: {
        fontSize: 10,
        lineHeight: 11,
    },
})
