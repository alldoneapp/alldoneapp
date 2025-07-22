import React, { Component } from 'react'
import { StyleSheet, View } from 'react-native'
import DeleteChatButton from './DeleteChatButton'

export default class DeleteChat extends Component {
    constructor(props) {
        super(props)
    }

    render() {
        return (
            <View style={localStyles.container}>
                <View style={{ marginLeft: 'auto' }}>
                    <DeleteChatButton projectId={this.props.projectId} chat={this.props.chat} />
                </View>
            </View>
        )
    }
}

const localStyles = StyleSheet.create({
    container: {
        flex: 1,
        flexDirection: 'row',
        paddingLeft: 11,
        paddingVertical: 8,
        alignItems: 'center',
    },
})
