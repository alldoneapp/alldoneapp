import React, { Component } from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import Icon from '../Icon'
import styles from '../styles/global'
import AmountTag from '../Feeds/FollowSwitchableTag/AmountTag'
import { NAVBAR_ITEM_MAP } from '../../utils/TabNavigationConstants'

export default class NavigationBarPicker extends Component {
    constructor(props) {
        super(props)
    }

    render() {
        const { showFollowedNotifications, children } = this.props
        const tabText = NAVBAR_ITEM_MAP[children] ? NAVBAR_ITEM_MAP[children] : children
        return (
            <TouchableOpacity style={localStyles.container} onPress={this.props.onPress}>
                <Text style={[styles.subtitle2, { color: 'white', marginRight: 4 }]}>{tabText}</Text>

                <Icon name={this.props.expanded ? 'chevron-up' : 'chevron-down'} size={24} color="white" />

                {this.props.feedAmount > 0 && (
                    <View style={{ marginLeft: 8 }}>
                        <AmountTag feedAmount={this.props.feedAmount} isFollowedButton={showFollowedNotifications} />
                    </View>
                )}
            </TouchableOpacity>
        )
    }
}

const localStyles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        width: 102,
        height: 46,
        alignItems: 'center',
        paddingLeft: 16,
        paddingRight: 21,
        justifyContent: 'space-between',
    },
})
