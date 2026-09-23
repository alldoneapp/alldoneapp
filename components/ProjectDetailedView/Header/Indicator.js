import React from 'react'
import { StyleSheet, View } from 'react-native'
import { useSelector } from 'react-redux'
import DvTypeIndicator from '../../UIComponents/DvTypeIndicator'

const Indicator = () => {
    const mobile = useSelector(state => state.smallScreenNavigation)

    return (
        <View style={localStyles.container}>
            <DvTypeIndicator label="PROJECT" icon="circle" mobile={mobile} />
        </View>
    )
}

export default Indicator

const localStyles = StyleSheet.create({
    container: {
        marginTop: 41,
    },
})
