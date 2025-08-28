import React from 'react'
import { StyleSheet, TouchableOpacity, View } from 'react-native'
import Hotkeys from 'react-hot-keys'
import { useSelector } from 'react-redux'

import Icon from '../../Icon'
import { tasksViewLabelColor } from '../../styles/global'
import Shortcut from '../../UIControls/Shortcut'

export default function SubtasksIndicator({ showSubTaskList, onPressSubTaskIndicator }) {
    const showShortcuts = useSelector(state => state.showShortcuts)

    return (
        <View style={localStyles.subtaskIndicatorMobile}>
            <Hotkeys keyName={'alt+s'} onKeyDown={onPressSubTaskIndicator} filter={e => true}>
                <TouchableOpacity activeOpacity={0.35} onPress={onPressSubTaskIndicator}>
                    {showShortcuts ? (
                        <View style={[localStyles.shortcut]}>
                            <Shortcut text={'S'} />
                        </View>
                    ) : (
                        <Icon
                            name={showSubTaskList ? 'chevron-down' : 'chevron-right'}
                            size={24}
                            color={tasksViewLabelColor}
                            style={{ opacity: 0.4 }}
                        />
                    )}
                </TouchableOpacity>
            </Hotkeys>
        </View>
    )
}

const localStyles = StyleSheet.create({
    subtaskIndicatorMobile: {
        position: 'absolute',
        top: 7,
        left: 8,
        zIndex: 10,
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
