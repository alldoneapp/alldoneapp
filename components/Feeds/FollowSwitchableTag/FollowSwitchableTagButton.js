import React, { useEffect, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { TouchableOpacity } from 'react-native-gesture-handler'

import styles, { colors } from '../../styles/global'
import AmountTag from './AmountTag'
import Icon from '../../Icon'
import { translate } from '../../../i18n/TranslationService'

export default function FollowSwitchableTagButton({
    text,
    icoName,
    isActive,
    feedAmount,
    onPress,
    isFollowedButton,
    backgroundAnimation,
    followedButtonSize,
    setFollowedButtonSize,
    smallScreenNavigation,
}) {
    const [horizontalLayout, setHorizontalLayout] = useState({ x: 0, width: 0 })
    const showAmountTag = feedAmount > 0

    const getLayoutData = layout => {
        const { x, width } = layout.nativeEvent.layout
        setHorizontalLayout({ x, width })
        if (isFollowedButton) {
            setFollowedButtonSize(x + width)
        }
    }

    useEffect(() => {
        if (isActive) {
            const { x, width } = horizontalLayout
            backgroundAnimation(x, width)
        }
    }, [horizontalLayout])

    useEffect(() => {
        if (!isFollowedButton && isActive) {
            const { x, width } = horizontalLayout
            backgroundAnimation(followedButtonSize, width)
        }
    }, [followedButtonSize])

    const doFilter = () => {
        onPress()
        const { x, width } = horizontalLayout
        backgroundAnimation(x, width)
    }

    return (
        <View onLayout={getLayoutData}>
            <TouchableOpacity
                style={[localStyles.button, smallScreenNavigation ? localStyles.buttonMobile : null]}
                onPress={doFilter}
            >
                {smallScreenNavigation ? (
                    <View style={localStyles.buttonMobileWrapper}>
                        <Icon
                            name={icoName}
                            color={isActive ? colors.Primary100 : colors.Text03}
                            size={20}
                            style={localStyles.buttonContent}
                        />

                        {isActive && (
                            <Text
                                style={[
                                    localStyles.buttonContent,
                                    isActive ? localStyles.activeText : localStyles.inactiveText,
                                ]}
                            >
                                {translate(text)}
                            </Text>
                        )}
                    </View>
                ) : (
                    <Text
                        style={[
                            localStyles.buttonContent,
                            isActive ? localStyles.activeText : localStyles.inactiveText,
                        ]}
                    >
                        {translate(text)}
                    </Text>
                )}
                {showAmountTag ? <AmountTag isFollowedButton={isFollowedButton} feedAmount={feedAmount} /> : null}
            </TouchableOpacity>
        </View>
    )
}

const localStyles = StyleSheet.create({
    button: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingLeft: 12,
        paddingRight: 5,
    },
    buttonMobile: {
        paddingLeft: 8,
        paddingRight: 4,
    },
    buttonContent: {
        marginRight: 4,
    },
    activeText: {
        ...styles.subtitle2,
        color: colors.Primary100,
    },
    inactiveText: {
        ...styles.body2,
        color: colors.Text03,
    },
    buttonMobileWrapper: {
        flexDirection: 'row',
        justifyContent: 'center',
        alignItems: 'center',
    },
})
