import React, { useEffect, useRef, useState } from 'react'
import { View, StyleSheet } from 'react-native'
import { useSelector } from 'react-redux'

import Spinner from './Spinner'

export const LOADING_DATA_SPINNER_DELAY_MS = 300
export const LOADING_DATA_SPINNER_MIN_VISIBLE_MS = 500

export default function LoadingData() {
    const spinnerRequested = useSelector(state => state.showLoadingDataSpinner)
    const [spinnerVisible, setSpinnerVisible] = useState(false)
    const shownAtRef = useRef(null)

    useEffect(() => {
        let timer

        if (spinnerRequested && !spinnerVisible) {
            timer = setTimeout(() => {
                shownAtRef.current = Date.now()
                setSpinnerVisible(true)
            }, LOADING_DATA_SPINNER_DELAY_MS)
        } else if (!spinnerRequested && spinnerVisible) {
            const visibleFor = shownAtRef.current == null ? 0 : Date.now() - shownAtRef.current
            const hideDelay = Math.max(0, LOADING_DATA_SPINNER_MIN_VISIBLE_MS - visibleFor)
            timer = setTimeout(() => {
                shownAtRef.current = null
                setSpinnerVisible(false)
            }, hideDelay)
        }

        return () => clearTimeout(timer)
    }, [spinnerRequested, spinnerVisible])

    return (
        spinnerVisible && (
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
