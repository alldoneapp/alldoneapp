import React, { Component } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import Icon from './Icon'

export default class AccessLearnings extends Component {
    constructor(props) {
        super(props)

        console.ignoredYellowBox = ['Setting a timer']
    }

    render() {
        return (
            <View style={styles.mainInfo}>
                <Icon name="grid" size={24} color="white"></Icon>
                <Text style={styles.itemText}>Access Learnings</Text>
            </View>
        )
    }
}

const styles = StyleSheet.create({
    mainInfo: {
        flexDirection: 'row',
        alignItems: 'center',
        width: 198,
        height: 40,
        borderRadius: 4,
        backgroundColor: '#0D55CF',
        borderColor: '#0D55CF',
        paddingLeft: 19,
    },
    itemText: {
        paddingLeft: 15,
        color: 'white',
        fontFamily: 'Roboto-Medium',
        fontSize: 14,
        lineHeight: 14,
        letterSpacing: 0.05,
    },
})
