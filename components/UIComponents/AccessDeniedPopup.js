import React, { useEffect } from 'react'
import { Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { useDispatch } from 'react-redux'

import styles, { colors, hexColorToRGBa } from '../styles/global'
import Button from '../UIControls/Button'
import { setShowAccessDeniedPopup, hideFloatPopup } from '../../redux/actions'
import Icon from '../Icon'
import { translate } from '../../i18n/TranslationService'
import { fixedModalOverlayStyle } from '../../utils/fixedModalPosition'
import { useFixedModalOverlayPadding } from '../../hooks/useSafeAreaOverlayPadding'

export default function AccessDeniedPopup() {
    const safeAreaOverlayPadding = useFixedModalOverlayPadding()
    const dispatch = useDispatch()

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
        // Dismissal lives on the backdrop element only: an onTouchStart on the
        // container bubbled up from the card, so tapping the text inside
        // dismissed the popup on touch devices.
        <View style={[localStyles.container, safeAreaOverlayPadding]}>
            <TouchableOpacity style={localStyles.backdrop} onPress={closeModal} />
            <View style={localStyles.popup}>
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
        ...Platform.select({ web: fixedModalOverlayStyle }),
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
        boxShadow: '0px 16px 24px rgba(0,0,0,0.04)',
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
