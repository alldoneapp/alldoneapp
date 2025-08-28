import React, { Component } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import Icon from '../../Icon'
import styles, { colors } from '../../styles/global'
import FollowingSwitch from './FollowingSwitch'

export default class Following extends Component {
    constructor(props) {
        super(props)
    }

    render() {
        return (
            <View style={localStyles.container}>
                <View style={{ marginRight: 11 }}>
                    <Icon name="eye" size={24} color={colors.Text03}></Icon>
                </View>
                <Text style={[styles.subtitle2, { color: colors.Text03 }]}>Following</Text>
                <View style={{ marginLeft: 'auto' }}>
                    <FollowingSwitch />
                </View>
            </View>
        )
    }
}

const localStyles = StyleSheet.create({
    container: {
        flex: 1,
        flexDirection: 'row',
        minHeight: 56,
        paddingLeft: 11,
        paddingVertical: 8,
        alignItems: 'center',
    },
})
