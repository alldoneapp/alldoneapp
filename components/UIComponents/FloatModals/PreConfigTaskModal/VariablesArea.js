import React from 'react'
import { StyleSheet, View } from 'react-native'

import VariableItem from './VariableItem'
import AddVariable from './AddVariable'

export default function VariablesArea({ disabled, variables, openVariableModal, removeVariable }) {
    return (
        <View style={localStyles.container}>
            {variables.map((variable, index) => (
                <VariableItem
                    disabled={disabled}
                    key={variable.name}
                    variable={variable}
                    openVariableModal={openVariableModal}
                    removeVariable={removeVariable}
                    index={index}
                />
            ))}
            {!disabled && <AddVariable openVariableModal={openVariableModal} />}
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        marginVertical: 8,
    },
})
