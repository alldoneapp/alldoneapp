import React, { Component } from 'react'
import { View, Text, StyleSheet } from 'react-native'
import PropTypes from 'prop-types'
import styles, { colors } from '../styles/global'

export const BADGE_GREY = 'grey'
export const BADGE_BLUE = 'blue'

class Badge extends Component {
    constructor(props) {
        super(props)

        this.state = {}
    }

    render() {
        const { text, theme, badgeStyle, textStyle } = this.props
        const themeStyle = localStyles[`badgeTheme${theme}`]
        const themeTextStyle = localStyles[`badgeThemeText${theme}`]

        return (
            <View style={[localStyles.container, themeStyle, badgeStyle]}>
                <Text style={[localStyles.badgeText, themeTextStyle, textStyle]}>{text}</Text>
            </View>
        )
    }
}

Badge.propTypes = {
    text: PropTypes.oneOfType([PropTypes.string, PropTypes.number]).isRequired,
    theme: PropTypes.oneOf([BADGE_GREY, BADGE_BLUE]),
    badgeStyle: PropTypes.any,
    textStyle: PropTypes.any,
}

Badge.defaultProps = {
    theme: BADGE_GREY,
}

const localStyles = StyleSheet.create({
    container: {
        alignSelf: 'center',
        height: 24,
        minWidth: 24,
        paddingHorizontal: 8,
        borderRadius: 50,
        justifyContent: 'center',
        alignItems: 'center',
    },
    [`badgeTheme${BADGE_GREY}`]: {
        backgroundColor: colors.Grey300,
    },
    [`badgeTheme${BADGE_BLUE}`]: {
        backgroundColor: colors.Secondary300,
    },
    badgeText: {
        ...styles.subtitle2,
    },
    [`badgeThemeText${BADGE_GREY}`]: {
        color: colors.Text03,
    },
    [`badgeThemeText${BADGE_BLUE}`]: {
        color: 'white',
    },
})

export default Badge
