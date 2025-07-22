import React from 'react'
import { Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native'

import styles, { colors, em2px, hexColorToRGBa } from '../../styles/global'
import Icon from '../../Icon'
import { setShowNoteMaxLengthModal } from '../../../redux/actions'
import { useDispatch, useSelector } from 'react-redux'
import { translate } from '../../../i18n/TranslationService'

export default function NoteMaxLengthModal() {
    const dispatch = useDispatch()
    const showNoteMaxLengthModal = useSelector(state => state.showNoteMaxLengthModal)
    const mobile = useSelector(state => state.smallScreenNavigation)

    const close = () => {
        dispatch(setShowNoteMaxLengthModal(false))
    }

    return (
        showNoteMaxLengthModal && (
            <View style={localStyles.parent}>
                <View style={[localStyles.container, !mobile && { marginLeft: 263 }]}>
                    <Text style={[styles.title7, localStyles.title]}>{translate('Note size limit reached')}</Text>
                    <View style={{ flexDirection: 'row' }}>
                        <Icon name="info" color={colors.Text03} size={18} style={{ marginTop: 2, marginRight: 8 }} />
                        <Text style={localStyles.description}>
                            {translate('Looks like this note is really big already')}
                        </Text>
                    </View>
                    <Text style={localStyles.description}>{translate('Note size limit reached Description')}</Text>
                    <TouchableOpacity style={localStyles.button} onPress={close}>
                        <Text style={localStyles.buttonText}>Ok</Text>
                    </TouchableOpacity>
                </View>
            </View>
        )
    )
}

const localStyles = StyleSheet.create({
    parent: {
        position: 'absolute',
        zIndex: 10000,
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: hexColorToRGBa(colors.Text03, 0.24),
        justifyContent: 'center',
        alignItems: 'center',
    },
    container: {
        width: 317,
        backgroundColor: '#091540',
        padding: 16,
        borderRadius: 4,
        ...Platform.select({
            web: {
                boxShadow: `${0}px ${16}px ${32}px rgba(0,0,0,0.04), ${0}px ${16}px ${24}px rgba(0, 0, 0, 0.04)`,
            },
        }),
    },
    title: {
        color: '#FFFFFF',
        fontWeight: '500',
    },
    button: {
        borderRadius: 4,
        backgroundColor: '#0C66FF',
        justifyContent: 'center',
        paddingHorizontal: 16,
        paddingVertical: 13,
        alignSelf: 'center',
        marginTop: 16,
    },
    buttonText: {
        fontFamily: 'Roboto-regular',
        fontWeight: '500',
        color: '#FFFFFF',
        fontSize: 14,
        lineHeight: 14,
        letterSpacing: em2px(0.05),
    },
    description: {
        ...styles.body2,
        color: '#8A94A6',
    },
})
