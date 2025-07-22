import React, { useEffect } from 'react'
import { StyleSheet, View } from 'react-native'

import { colors } from '../../../styles/global'
import { translate } from '../../../../i18n/TranslationService'
import Button from '../../../UIControls/Button'

export default function CustomEstimationModalEstimateButton({ days, hours, minutes, setEstimation }) {
    const estimate = () => {
        const total = parseInt(days || 0) * 8 * 60 + parseInt(hours || 0) * 60 + parseInt(minutes || 0)
        setEstimation(total || 0)
    }

    const onHandleKeydown = e => {
        if (e.key === 'Enter') estimate()
    }

    useEffect(() => {
        document.addEventListener('keydown', onHandleKeydown)
        return () => {
            document.removeEventListener('keydown', onHandleKeydown)
        }
    })

    return (
        <View style={localStyles.container}>
            <Button
                title={translate('Estimate')}
                type={'primary'}
                onPress={estimate}
                accessible={false}
                shortcutText={'Enter'}
                disabled={false}
            />
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 8,
        paddingHorizontal: 16,
        borderTopColor: colors.funnyWhite,
        borderTopWidth: 1,
        marginTop: 8,
    },
})
