import React, { useEffect } from 'react'
import { View, StyleSheet } from 'react-native'
import { useSelector } from 'react-redux'

import Spinner from './Spinner'

export default function LoadingData() {
    const showLoadingDataSpinner = useSelector(state => state.showLoadingDataSpinner)
    const isLoadingData = useSelector(state => state.isLoadingData)

    useEffect(() => {
        // Diagnostic logs for spinner behavior
        console.debug('LoadingData: spinner state changed', {
            showLoadingDataSpinner,
            isLoadingData,
        })
    }, [showLoadingDataSpinner, isLoadingData])
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
