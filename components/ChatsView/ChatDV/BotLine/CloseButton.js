import React from 'react'
import { StyleSheet } from 'react-native'

import Button from '../../../UIControls/Button'

export default function CloseButton({ setFullscreen }) {
    const closeFullscreen = () => {
        setFullscreen(false)
    }

    return (
        <Button
            ref={ref => (this.xBtnRef = ref)}
            type={'ghost'}
            noBorder={true}
            icon="x"
            onPress={closeFullscreen}
            buttonStyle={localStyles.container}
        />
    )
}

const localStyles = StyleSheet.create({
    container: {
        marginLeft: 8,
        marginRight: 20,
        padding: 10,
    },
})
