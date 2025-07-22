import React, { useEffect } from 'react'
import { StyleSheet, View } from 'react-native'

import Button from '../../../UIControls/Button'
import { translate } from '../../../../i18n/TranslationService'

export default function ButtonsArea({ executeTrigger, inProgress, hidePopup, disabled }) {
    const onKeyDown = e => {
        if (inProgress) return
        if (e.key === 'Escape') {
            hidePopup(e)
        } else if (e.key === 'Enter') {
            executeTrigger()
        }
    }

    useEffect(() => {
        document.addEventListener('keydown', onKeyDown)
        return () => {
            document.removeEventListener('keydown', onKeyDown)
        }
    })

    return (
        <View style={localStyles.footer}>
            <Button
                title={translate('Cancel')}
                type={'secondary'}
                onPress={hidePopup}
                buttonStyle={{ marginRight: 16 }}
                disabled={inProgress}
            />
            <Button
                title={translate('Proceed')}
                onPress={executeTrigger}
                type={'danger'}
                processing={inProgress}
                processingTitle={`${translate('Kicking')}...`}
                disabled={inProgress || disabled}
            />
        </View>
    )
}

const localStyles = StyleSheet.create({
    footer: {
        flex: 0,
        flexDirection: 'row',
        padding: 16,
    },
})
