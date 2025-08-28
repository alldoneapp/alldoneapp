import React, { useRef, useEffect } from 'react'
import { Animated, Easing, TouchableOpacity, View, StyleSheet } from 'react-native'
import Hotkeys from 'react-hot-keys'
import { useSelector } from 'react-redux'

import Icon from '../Icon'
import { tasksViewLabelColor } from '../styles/global'
import Shortcut from '../UIControls/Shortcut'

export default function TaskIndicator({ inEditMode, toggleSubTaskList, dismissibleRef, showSubTaskList }) {
    const showShortcuts = useSelector(state => state.showShortcuts)
    const showFloatPopup = useSelector(state => state.showFloatPopup)
    const rotateSubTaskInd = useRef(new Animated.Value(0)).current

    const rotateSubTaskIndDegree = rotateSubTaskInd.interpolate({
        inputRange: [0, 1],
        outputRange: ['0deg', '90deg'],
    })

    const callShortcut = (s, e) => {
        e.preventDefault()
        e.stopPropagation()
        toggleSubTaskList()
        dismissibleRef?.toggleModal()
    }

    useEffect(() => {
        Animated.timing(rotateSubTaskInd, {
            toValue: showSubTaskList ? 1 : 0,
            duration: 200,
            easing: Easing.ease,
            useNativeDriver: false,
        }).start()
    }, [showSubTaskList])

    return (
        <View>
            {inEditMode && <Hotkeys keyName={'alt+s'} onKeyDown={callShortcut} filter={e => true} />}

            {showShortcuts && showFloatPopup === 0 && inEditMode ? (
                <View
                    style={[
                        localStyles.shortcut,
                        localStyles.subtaskIndicator,
                        inEditMode && localStyles.subtaskIndEMode,
                    ]}
                >
                    <Shortcut text={'S'} />
                </View>
            ) : (
                <Animated.View
                    style={[
                        localStyles.subtaskIndicator,
                        inEditMode && localStyles.subtaskIndEMode,
                        { transform: [{ rotate: rotateSubTaskIndDegree }] },
                    ]}
                >
                    <TouchableOpacity activeOpacity={0.35} onPress={toggleSubTaskList}>
                        <Icon name={'chevron-right'} size={24} color={tasksViewLabelColor} style={{ opacity: 0.4 }} />
                    </TouchableOpacity>
                </Animated.View>
            )}
        </View>
    )
}

const localStyles = StyleSheet.create({
    subtaskIndicator: {
        position: 'absolute',
        top: 7,
        left: -32,
    },
    subtaskIndEMode: {
        left: -40,
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
