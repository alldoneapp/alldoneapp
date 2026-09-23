import React from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { useSelector } from 'react-redux'

import DvTypeIndicator from './DvTypeIndicator'
import { colors } from '../styles/global'
import { translate } from '../../i18n/TranslationService'
import useLastEditDate from '../../hooks/useLastEditDate'

function LastEdited({ lastEditionDate, editorName, shortEditorName, useShortName }) {
    const editionText = useLastEditDate(lastEditionDate)
    const name = useShortName ? shortEditorName || editorName : editorName
    if (!editionText) return null

    return (
        <Text style={localStyles.lastEdited} numberOfLines={1} ellipsizeMode="tail">
            {`${translate('edited')} ${editionText}${name ? ` ${translate('by')} ${name}` : ''}`}
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
}) {
    const mobile = useSelector(state => state.smallScreenNavigation)
    const tablet = useSelector(state => state.isMiddleScreen)

    return (
        <View style={localStyles.container}>
            <TouchableOpacity style={localStyles.title} onPress={onPress} disabled={disabled}>
                {children}
            </TouchableOpacity>
            <View style={localStyles.meta}>
                <DvTypeIndicator label={typeLabel} icon={typeIcon} mobile={mobile} />
                {!mobile && !hideLastEdited && lastEditionDate && (
                    <LastEdited
                        lastEditionDate={lastEditionDate}
                        editorName={editorName}
                        shortEditorName={shortEditorName}
                        useShortName={tablet}
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
    title: {
        flex: 1,
        minWidth: 0,
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
    lastEdited: {
        fontFamily: 'Roboto-Regular',
        fontSize: 11,
        lineHeight: 12,
        color: colors.Text03,
        textAlign: 'right',
        marginTop: 2,
        maxWidth: '100%',
    },
})
