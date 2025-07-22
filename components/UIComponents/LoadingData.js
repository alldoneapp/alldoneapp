import React from 'react'
import { View, StyleSheet } from 'react-native'
import { useSelector } from 'react-redux'

import Spinner from './Spinner'

export default function LoadingData() {
    const showLoadingDataSpinner = useSelector(state => state.showLoadingDataSpinner)
    return (
        showLoadingDataSpinner && (
            <View style={localStyles.container}>
                <Spinner containerSize={48} spinnerSize={32} />
            </View>
        )
    )
}

const localStyles = StyleSheet.create({
    container: {
        position: 'absolute',
        bottom: 56,
        right: 56,
        zIndex: 10000,
    },
})
