import React, { Component } from 'react'
import { StyleSheet, View } from 'react-native'

export default class Lock extends Component {
    constructor(props) {
        super(props)

        console.ignoredYellowBox = ['Setting a timer']
    }

    render() {
        return <View style={styles.container}></View>
    }
}

const styles = StyleSheet.create({
    container: {
        flex: -1,
        height: 24,
        justifyContent: 'center',
        marginRight: 5,
    },
    lock: {
        width: 30,
        height: 24,
        marginLeft: -5,
    },
})
