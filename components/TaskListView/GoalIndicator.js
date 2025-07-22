import React, { useRef, useEffect } from 'react'
import { Animated, Easing, TouchableOpacity, View, StyleSheet } from 'react-native'
import Hotkeys from 'react-hot-keys'
import { useSelector } from 'react-redux'

import Icon from '../Icon'
import { tasksViewLabelColor } from '../styles/global'
import Shortcut from '../UIControls/Shortcut'

export default function GoalIndicator({ inEditMode, toggleTasksList, dismissibleRef, showingTasks, inside }) {
    const showShortcuts = useSelector(state => state.showShortcuts)
    const showFloatPopup = useSelector(state => state.showFloatPopup)
    const rotateIndicatorRef = useRef(new Animated.Value(0)).current

    const rotateIndicatorDegree = rotateIndicatorRef.interpolate({
        inputRange: [0, 1],
        outputRange: ['0deg', '90deg'],
    })

    const callShortcut = (s, e) => {
        e.preventDefault()
        e.stopPropagation()
        toggleTasksList()
        dismissibleRef?.toggleModal()
    }

    useEffect(() => {
        Animated.timing(rotateIndicatorRef, {
            toValue: showingTasks ? 1 : 0,
            duration: 200,
            easing: Easing.ease,
            useNativeDriver: false,
        }).start()
    }, [showingTasks])

    return (
        <View>
            {inEditMode && <Hotkeys keyName={'alt+t'} onKeyDown={callShortcut} filter={e => true} />}

            {showShortcuts && showFloatPopup === 0 && inEditMode ? (
                <View
                    style={[
                        localStyles.shortcut,
                        localStyles.indicator,
                        inEditMode && (inside ? localStyles.insideEditMode : localStyles.editMode),
                    ]}
                >
                    <Shortcut text={'T'} />
                </View>
            ) : (
                <Animated.View
                    style={[
                        localStyles.indicator,
                        inEditMode && (inside ? localStyles.insideEditMode : localStyles.editMode),
                        { transform: [{ rotate: rotateIndicatorDegree }] },
                    ]}
                >
                    <TouchableOpacity activeOpacity={0.35} onPress={toggleTasksList}>
                        <Icon name={'chevron-right'} size={24} color={tasksViewLabelColor} style={{ opacity: 0.4 }} />
                    </TouchableOpacity>
                </Animated.View>
            )}
        </View>
    )
}

const localStyles = StyleSheet.create({
    indicator: {
        position: 'absolute',
        top: 12,
        left: -24,
    },
    editMode: {
        left: -40,
    },
    insideEditMode: {
        left: -8,
    },
    shortcut: {
        width: 24,
        height: 24,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(138, 148, 166, 0.24)',
        borderRadius: 4,
    },
})
