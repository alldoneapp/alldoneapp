import React from 'react'
import { StyleSheet, Text, View } from 'react-native'

import styles, { colors } from '../../../styles/global'
import Button from '../../../UIControls/Button'

export default function VariableItem({ disabled, variable, openVariableModal, removeVariable, index }) {
    const { name } = variable

    const edit = () => {
        openVariableModal(index)
    }

    const remove = () => {
        removeVariable(index)
    }

    return (
        <View style={localStyles.variableContainer}>
            <Text style={localStyles.text}>{`$${name}`}</Text>
            <View style={{ flexDirection: 'row' }}>
                <Button
                    iconColor={colors.Text02}
                    icon="edit"
                    type={'ghost'}
                    onPress={edit}
                    noBorder={true}
                    buttonStyle={{ marginRight: 4 }}
                />
                {!disabled && (
                    <Button
                        iconColor={colors.UtilityRed150}
                        icon="trash-2"
                        type={'ghost'}
                        onPress={remove}
                        noBorder={true}
                        buttonStyle={{ opacity: 0.5 }}
                    />
                )}
            </View>
        </View>
    )
}

const localStyles = StyleSheet.create({
    variableContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 4,
    },
    text: {
        ...styles.subtitle2,
        color: colors.Text02,
    },
})
