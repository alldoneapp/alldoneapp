import React, { Component } from 'react'
import { StyleSheet, View } from 'react-native'
import { colors } from '../styles/global'

import { themed } from '../../Themes/colorMode'

export default class HintOverlay extends Component {
    constructor(props) {
        super(props)
    }

    render() {
        return (
            <View style={localStyles.container}>
                <View style={localStyles.redDisk}></View>
            </View>
        )
    }
}

const localStyles = StyleSheet.create({
    container: {
        height: 12,
        width: 12,
        borderRadius: 100,
        backgroundColor: themed.Surface,
        alignItems: 'center',
        justifyContent: 'center',
    },
    redDisk: {
        height: 8,
        width: 8,
        backgroundColor: colors.Red200,
    },
})
