import React, { Component } from 'react'
import { StyleSheet, Text, View, Animated } from 'react-native'
import styles, { colors } from '../../styles/global'
import { TouchableWithoutFeedback } from 'react-native-gesture-handler'

export default class FollowingSwitch extends Component {
    constructor(props) {
        super(props)

        this.state = {
            yes: false,
            marginLeft: new Animated.Value(1),
            backgroundColorAnim: new Animated.Value(0),
            textColorAnim: new Animated.Value(0),
        }
    }

    render() {
        let backgroundColor = this.state.backgroundColorAnim.interpolate({
            inputRange: [0, 1],
            outputRange: [colors.Gray300, colors.Primary300],
        })
        let textColor = this.state.textColorAnim.interpolate({
            inputRange: [0, 1],
            outputRange: [colors.Text02, colors.Primary300],
        })
        return (
            <View style={localStyles.container}>
                <View style={localStyles.textContainer}>
                    <Animated.Text style={[this.state.yes ? styles.subtitle1 : styles.body1, { color: textColor }]}>
                        {this.state.yes ? 'Yes' : 'No'}
                    </Animated.Text>
                </View>
                <TouchableWithoutFeedback onPress={this.onPress}>
                    <Animated.View
                        style={[
                            localStyles.switchContainer,
                            {
                                paddingLeft: this.state.marginLeft,
                                backgroundColor: backgroundColor,
                                borderColor: backgroundColor,
                            },
                        ]}
                    >
                        <View style={localStyles.lever}></View>
                    </Animated.View>
                </TouchableWithoutFeedback>
            </View>
        )
    }

    onPress = () => {
        if (this.state.yes) {
            Animated.parallel(
                [
                    Animated.timing(this.state.marginLeft, {
                        toValue: 1,
                        duration: 125,
                    }),
                    Animated.timing(this.state.backgroundColorAnim, {
                        toValue: 0,
                        duration: 125,
                    }),
                    Animated.timing(this.state.textColorAnim, {
                        toValue: 0,
                        duration: 125,
                    }),
                ],
                { stopTogether: false }
            ).start()
        } else {
            Animated.parallel(
                [
                    Animated.timing(this.state.marginLeft, {
                        toValue: 19,
                        duration: 125,
                    }),
                    Animated.timing(this.state.backgroundColorAnim, {
                        toValue: 1,
                        duration: 125,
                    }),
                    Animated.timing(this.state.textColorAnim, {
                        toValue: 1,
                        duration: 125,
                    }),
                ],
                { stopTogether: false }
            ).start()
        }

        this.setState({ yes: !this.state.yes })
    }
}

const localStyles = StyleSheet.create({
    container: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
    },
    switchContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        width: 42,
        height: 24,
        paddingRight: 1,
        borderWidth: 1,
        borderRadius: 21,
        //borderColor: colors.Primary300,
        //backgroundColor: colors.Primary300,
    },
    lever: {
        width: 20,
        height: 20,
        backgroundColor: 'white',
        borderRadius: 100,
    },
    textContainer: {
        marginRight: 12,
    },
})
