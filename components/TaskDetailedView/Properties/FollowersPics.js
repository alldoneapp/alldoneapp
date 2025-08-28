import React, { Component } from 'react'
import { Image, StyleSheet, TouchableOpacity } from 'react-native'

export default class FollowersPics extends Component {
    constructor(props) {
        super(props)
    }

    render() {
        return (
            <TouchableOpacity style={localStyles.container} onPress={this.onPress}>
                <Image style={localStyles.userImage} source={{ uri: this.props.photoURL }}></Image>
            </TouchableOpacity>
        )
    }

    onPress = () => {}
}

const localStyles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 16,
        paddingVertical: 8,
    },
    userImage: {
        width: 32,
        height: 32,
        backgroundColor: 'transparent',
        marginRight: 4,
    },
})
