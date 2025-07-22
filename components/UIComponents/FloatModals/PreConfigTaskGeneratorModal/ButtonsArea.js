import React from 'react'
import { StyleSheet, View } from 'react-native'

import Button from '../../../UIControls/Button'
import { translate } from '../../../../i18n/TranslationService'

export default function ButtonsArea({ addTask }) {
    return (
        <View style={localStyles.buttonContainer}>
            <Button title={translate('Please do')} onPress={addTask} type={'primary'} />
        </View>
    )
}

const localStyles = StyleSheet.create({
    buttonContainer: {
        flexDirection: 'row',
        justifyContent: 'center',
        marginTop: 16,
    },
})
