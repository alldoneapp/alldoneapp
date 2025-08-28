import React from 'react'
import { StyleSheet, View } from 'react-native'

import { ESTIMATION_OPTIONS } from '../../../../utils/EstimationHelper'
import EstimationModalItem from './EstimationModalItem'

export default function EstimationModalOptions({ projectId, setEstimation, selectedEstimation, disabled }) {
    return (
        <View style={localStyles.container}>
            {ESTIMATION_OPTIONS.map(value => {
                const isSelected = selectedEstimation === value
                return (
                    <View key={value}>
                        <EstimationModalItem
                            projectId={projectId}
                            item={value}
                            isSelected={isSelected}
                            onPress={() => setEstimation(value)}
                            disabled={disabled}
                        />
                    </View>
                )
            })}
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flex: 1,
        justifyContent: 'space-around',
    },
})
