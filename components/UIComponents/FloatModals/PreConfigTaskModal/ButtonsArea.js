import React from 'react'
import { StyleSheet, View } from 'react-native'

import Button from '../../../UIControls/Button'
import { translate } from '../../../../i18n/TranslationService'

export default function ButtonsArea({ adding, addTask, saveTask, disableButton, deleteTask }) {
    return (
        <View style={localStyles.buttonContainer}>
            {!adding && (
                <Button
                    title={translate('Delete')}
                    type={'danger'}
                    onPress={deleteTask}
                    buttonStyle={{ marginRight: 16 }}
                />
            )}
            <Button
                title={translate(adding ? 'Add' : 'Save')}
                onPress={adding ? addTask : saveTask}
                type={'primary'}
                disabled={disableButton}
            />
        </View>
    )
}

const localStyles = StyleSheet.create({
    buttonContainer: {
        flexDirection: 'row',
        justifyContent: 'center',
        marginTop: 16,
        position: 'relative',
        zIndex: 1,
    },
})
