import React, { Component } from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import styles, { colors, windowTagStyle } from '../styles/global'
import Icon from '../Icon'
import store from '../../redux/store'
import PropTypes from 'prop-types'

class TaskVisibility extends Component {
    constructor(props) {
        super(props)
        const storeState = store.getState()

        this.state = {
            smallScreenNavigation: storeState.smallScreenNavigation,
            unsubscribe: store.subscribe(this.updateState),
        }
    }

    componentWillUnmount() {
        this.state.unsubscribe()
    }

    updateState = () => {
        const storeState = store.getState()

        this.setState({
            smallScreenNavigation: storeState.smallScreenNavigation,
        })
    }

    render() {
        const { smallScreenNavigation } = this.state
        const { isPrivate, onPress, isMobile, style, disabled } = this.props

        return (
            <TouchableOpacity onPress={onPress} disabled={disabled}>
                <View style={[localStyles.container, style]}>
                    <Icon
                        name={isPrivate ? 'lock' : 'unlock'}
                        size={16}
                        color={colors.Text03}
                        style={localStyles.icon}
                    />
                    <Text
                        style={[
                            styles.subtitle2,
                            !smallScreenNavigation && !isMobile && localStyles.text,
                            windowTagStyle(),
                        ]}
                    >
                        {smallScreenNavigation || isMobile ? '' : isPrivate ? 'Private' : 'Public'}
                    </Text>
                </View>
            </TouchableOpacity>
        )
    }
}

TaskVisibility.propTypes = {
    isPrivate: PropTypes.bool.isRequired,
    onPress: PropTypes.func,
    isMobile: PropTypes.bool,
    style: PropTypes.object,
}

TaskVisibility.defaultProps = {
    isPrivate: true,
    isMobile: false,
}

const localStyles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        backgroundColor: colors.Gray300,
        borderRadius: 12,
        alignItems: 'center',
        justifyContent: 'center',
        height: 24,
    },
    icon: {
        marginHorizontal: 4,
    },
    text: {
        color: colors.Text03,
        marginVertical: 1,
        marginRight: 10,
        marginLeft: 2,
    },
})
export default TaskVisibility
