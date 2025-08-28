import React from 'react'
import { StyleSheet, View } from 'react-native'

import Button from '../../../UIControls/Button'
import { translate } from '../../../../i18n/TranslationService'

export default function ButtonsArea({ adding, addData, updateData, disabled, closeModal }) {
    return (
        <View style={localStyles.buttonContainer}>
            <Button
                title={translate('Back')}
                onPress={closeModal}
                type={'secondary'}
                buttonStyle={{ marginRight: 16 }}
            />
            <Button
                title={translate(adding ? 'Add' : 'Update')}
                onPress={adding ? addData : updateData}
                type={'primary'}
                disabled={disabled}
            />
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
