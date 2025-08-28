import React, { Component } from 'react'
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native'
import Icon from '../Icon'
import styles, { colors } from '../styles/global'
import { hideFloatPopup, showFloatPopup } from '../../redux/actions'
import store from '../../redux/store'
import Popover from 'react-tiny-popover'

export default class ActionButton extends Component {
    constructor(props) {
        super(props)
        const storeState = store.getState()

        this.state = {
            visiblePopover: false,
            smallScreen: storeState.smallScreen,
            unsubscribe: store.subscribe(this.updateState),
        }
    }

    componentWillUnmount() {
        this.state.unsubscribe()
    }

    updateState = () => {
        const storeState = store.getState()

        this.setState({
            smallScreen: storeState.smallScreen,
        })
    }

    render() {
        let disabledStyle = null
        if (this.props.feed) {
            if (this.props.feed.uid === store.getState().loggedUser.uid) {
                disabledStyle = { backgroundColor: 'rgba(124, 124, 124)', pointerEvents: 'none', opacity: 0.5 }
            } else if (this.props.feed.usersIdGaveKarma) {
                const userGivingKarmaId = store.getState().loggedUser.uid
                for (let i = 0; i < this.props.feed.usersIdGaveKarma.length; i++) {
                    if (this.props.feed.usersIdGaveKarma[i] === userGivingKarmaId) {
                        disabledStyle = { backgroundColor: 'rgba(124, 124, 124)', pointerEvents: 'none', opacity: 0.5 }
                        break
                    }
                }
            }
        }

        return (
            <View style={[{ marginRight: 4 }, disabledStyle]}>
                <Popover
                    content={
                        this.props.modalContent
                            ? React.cloneElement(this.props.modalContent, { hidePopover: this.hidePopover })
                            : undefined
                    }
                    onClickOutside={this.hidePopover}
                    isOpen={this.state.visiblePopover}
                    position={['bottom', 'left', 'right', 'top']}
                    padding={4}
                    align={'end'}
                    contentLocation={this.state.smallScreen ? null : undefined}
                >
                    <TouchableOpacity
                        testID="touchableOpacity"
                        style={[localStyles.container, this.props.style]}
                        onPress={() => {
                            if (this.props.onPress) {
                                this.props.onPress()
                            }

                            if (this.props.modalContent) {
                                this.showPopover()
                            }
                        }}
                    >
                        <Icon
                            name={this.props.icon.icon}
                            size={24}
                            color={this.props.icon.color ? this.props.icon.color : colors.Text03}
                        ></Icon>
                        <View style={{ marginLeft: 12 }}>
                            <Text style={[styles.buttonLabel, { color: colors.Text03 }]}>{this.props.text.text}</Text>
                        </View>
                    </TouchableOpacity>
                </Popover>
            </View>
        )
    }

    showPopover = () => {
        this.setState({ visiblePopover: true })
        store.dispatch(showFloatPopup())
    }

    hidePopover = () => {
        // This timeout is necessary to stop the propagation of the click
        // to close the Modal, and reach the dismiss event of the EditStep
        setTimeout(async () => {
            this.setState({ visiblePopover: false })
            store.dispatch(hideFloatPopup())
        })
    }
}

const localStyles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        alignItems: 'center',
        height: 40,
        paddingHorizontal: 16,
        borderRadius: 4,
    },
})
