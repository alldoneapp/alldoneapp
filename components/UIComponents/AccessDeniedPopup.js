import React, { useEffect } from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { useDispatch, useSelector } from 'react-redux'

import styles, { colors, hexColorToRGBa } from '../styles/global'
import Button from '../UIControls/Button'
import { setShowAccessDeniedPopup, hideFloatPopup } from '../../redux/actions'
import Icon from '../Icon'
import { translate } from '../../i18n/TranslationService'

export default function AccessDeniedPopup() {
    const dispatch = useDispatch()
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)

    useEffect(() => {
        document.addEventListener('keydown', onKeyDown)
        return () => {
            document.removeEventListener('keydown', onKeyDown)
        }
    })

    const onKeyDown = e => {
        if (e.key === 'Escape' || e.key === 'Enter') {
            e.preventDefault()
            closeModal()
        }
    }

    const closeModal = e => {
        if (e) e.preventDefault()
        dispatch([hideFloatPopup(), setShowAccessDeniedPopup(false)])
    }

    return (
        <View style={localStyles.container} onTouchStart={closeModal}>
            <TouchableOpacity style={localStyles.backdrop} onPress={closeModal} />
            <View style={[localStyles.popup, smallScreenNavigation && { marginLeft: 300 }]}>
                <View style={localStyles.body}>
                    <View style={{ marginBottom: 20 }}>
                        <Text style={[styles.title7, { color: '#ffffff' }]}>
                            {translate('Ups, this object is private')}
                        </Text>
                        <Text style={[styles.body2, { color: colors.Text03 }]}>
                            {translate('This object owner set privacy to Private')}
                        </Text>
                        <Text style={[styles.body1, localStyles.bodyText]}>
                            {translate(
                                'Ups, looks like the owner of this resource set it to Private, so you can’t see it'
                            )}
                        </Text>
                    </View>
                </View>
                <View style={localStyles.buttonContainer}>
                    <Button title={'Ok'} type={'primary'} onPress={closeModal} />
                </View>
                <View style={localStyles.closeContainer}>
                    <TouchableOpacity style={localStyles.closeButton} onPress={closeModal}>
                        <Icon name="x" size={24} color={colors.Text03} />
                    </TouchableOpacity>
                </View>
            </View>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
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
    backdrop: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 10100,
    },
    body: {
        paddingHorizontal: 16,
    },
    bodyText: {
        color: colors.Grey400,
        marginTop: 20,
        marginBottom: 8,
    },
    popup: {
        backgroundColor: colors.Secondary400,
        paddingVertical: 16,
        shadowColor: 'rgba(0,0,0,0.04)',
        shadowOffset: { width: 0, height: 16 },
        shadowOpacity: 1,
        shadowRadius: 24,
        borderRadius: 4,
        alignItems: 'center',
        maxWidth: 305,
        zIndex: 11000,
    },
    buttonContainer: {
        width: '100%',
        flexDirection: 'row',
        paddingHorizontal: 16,
        paddingTop: 16,
        borderTopColor: hexColorToRGBa('#ffffff', 0.2),
        borderTopWidth: 1,
        justifyContent: 'center',
    },
    closeContainer: {
        position: 'absolute',
        top: 13,
        right: 13,
    },
    closeButton: {
        alignItems: 'center',
        justifyContent: 'center',
    },
})
