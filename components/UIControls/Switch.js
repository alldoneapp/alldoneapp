import React, { useRef, useEffect } from 'react'
import { View, Text, StyleSheet, TouchableOpacity, Animated } from 'react-native'

import styles, { colors } from '../styles/global'
import { translate } from '../../i18n/TranslationService'

export default function Switch({ active, activeSwitch, deactiveSwitch, disabled }) {
    const SWITCH_ACTIVE_POSTION = 18
    const SWITCH_INACTIVE_POSTION = 0
    const switchMarginLeft = useRef(
        new Animated.Value(active ? SWITCH_ACTIVE_POSTION : SWITCH_INACTIVE_POSTION)
    ).current

    // A press must never throw. This component's API is `active` + `activeSwitch`/`deactiveSwitch`,
    // and a caller that reaches for React Native's core `value`/`onValueChange` names instead gets
    // `undefined` here — which used to surface as an uncaught `TypeError: t is not a function` from
    // deep inside PressResponder, with no hint of which switch or which prop was wrong (AT-2518).
    // A missing handler is now a no-op with a named warning: the toggle still does not move, but the
    // page keeps working and the console says exactly what to fix.
    const onPresSwitch = () => {
        const handler = active ? deactiveSwitch : activeSwitch
        if (typeof handler !== 'function') {
            console.warn(
                `Switch: no ${active ? 'deactiveSwitch' : 'activeSwitch'} handler. This component takes ` +
                    '`active`, `activeSwitch` and `deactiveSwitch`, not `value`/`onValueChange`.'
            )
            return
        }
        handler()
    }

    useEffect(() => {
        const nextPosition = active ? SWITCH_ACTIVE_POSTION : SWITCH_INACTIVE_POSTION
        Animated.timing(switchMarginLeft, {
            toValue: nextPosition,
            duration: 300,
            // marginLeft is a layout prop, so the native driver cannot drive it.
            useNativeDriver: false,
        }).start()
    }, [active])

    return (
        <TouchableOpacity style={localStyles.container} onPress={onPresSwitch} disabled={disabled} accessible={false}>
            <Text style={active ? localStyles.activeText : localStyles.inactiveText}>
                {translate(active ? 'Yes' : 'No')}
            </Text>
            <View
                style={[
                    localStyles.switchContainer,
                    active ? localStyles.activeSwitchContainer : localStyles.inactiveSwitchContainer,
                ]}
            >
                <Animated.View style={{ marginLeft: switchMarginLeft }}>
                    <View style={localStyles.switch} />
                </Animated.View>
            </View>
        </TouchableOpacity>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flexDirection: 'row',
    },
    activeText: {
        ...styles.subtitle1,
        color: colors.Primary300,
    },
    inactiveText: {
        ...styles.body1,
        color: colors.Text02,
    },
    switchContainer: {
        width: 42,
        height: 24,
        borderRadius: 16,
        overflow: 'hidden',
        padding: 2,
        marginLeft: 8,
    },
    activeSwitchContainer: {
        backgroundColor: colors.Primary300,
    },
    inactiveSwitchContainer: {
        backgroundColor: colors.Gray300,
    },
    switch: {
        width: 20,
        height: 20,
        backgroundColor: '#FFFFFF',
        borderRadius: 100,
        boxShadow: '0px 0px 4px rgba(138,148,166,0.50)',
        elevation: 1,
    },
})
