import React from 'react'
import { StyleSheet, View } from 'react-native'
import DvTypeIndicator from '../../UIComponents/DvTypeIndicator'
import store from '../../../redux/store'

export default function Indicator({ isSubtask }) {
    const mobile = store.getState().smallScreenNavigation

    return (
        <View style={localStyles.container}>
            <DvTypeIndicator
                label={isSubtask ? 'SUBTASK' : 'TASK'}
                icon={isSubtask ? 'check-square-Sub' : 'check-square'}
                mobile={mobile}
            />
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        marginTop: 41,
    },
})
