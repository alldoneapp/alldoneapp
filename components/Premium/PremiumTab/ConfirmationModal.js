import React, { useEffect, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'

import Button from '../../UIControls/Button'
import styles, { colors, hexColorToRGBa } from '../../styles/global'
import { translate } from '../../../i18n/TranslationService'

export default function ConfirmationModal({ onProceed, closeModal, title, description }) {
    const [processing, setProcessing] = useState(false)

    const onKeyDown = event => {
        const { key } = event
        if (key === 'Escape') closeModal()
        else if (key === 'Enter') onProceed()
    }

    const onPress = async () => {
        setProcessing(true)
        await onProceed()
        setProcessing(false)
    }

    useEffect(() => {
        document.addEventListener('keydown', onKeyDown)
        return () => {
            document.removeEventListener('keydown', onKeyDown)
        }
    })

    return (
        <View style={localStyles.overlay}>
            <View style={localStyles.container}>
                <View style={{ paddingHorizontal: 16 }}>
                    <Text style={[styles.title7, { color: 'white' }]}>{translate(title)}</Text>
                    <Text style={[styles.body2, { color: colors.Text03 }]}>{translate(description)}</Text>
                </View>
                <View style={localStyles.buttons}>
                    <Button
                        title={translate('Cancel')}
                        type={'secondary'}
                        buttonStyle={{ marginRight: 8 }}
                        onPress={closeModal}
                        disabled={processing}
                    />
                    <Button
                        title={translate('Proceed')}
                        type={'danger'}
                        onPress={onPress}
                        disabled={processing}
                        processing={processing}
                        processingTitle={translate('Loading')}
                    />
                </View>
            </View>
        </View>
    )
}

const localStyles = StyleSheet.create({
    overlay: {
        position: 'fixed',
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
        top: '50%',
        left: '58.5%',
        transform: [{ translateX: '-60%' }, { translateY: '-50%' }],
        position: 'fixed',
        width: 317,
        shadowColor: 'rgba(78, 93, 120, 0.56)',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 1,
        shadowRadius: 16,
        elevation: 3,
        borderRadius: 4,
        backgroundColor: colors.Secondary400,
        paddingVertical: 16,
        height: 162,
    },
    buttons: {
        flexDirection: 'row',
        justifyContent: 'center',
        marginTop: 16,
    },
})
