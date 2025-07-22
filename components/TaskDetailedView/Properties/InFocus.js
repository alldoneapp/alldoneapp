import React from 'react'
import { StyleSheet, Text, View } from 'react-native'
import Hotkeys from 'react-hot-keys'
import { useSelector } from 'react-redux'

import Icon from '../../Icon'
import styles, { colors } from '../../styles/global'
import { translate } from '../../../i18n/TranslationService'
import GhostButton from '../../UIControls/GhostButton'
import { execShortcutFn } from '../../../utils/HelperFunctions'
import { updateFocusedTask } from '../../../utils/backends/Tasks/tasksFirestore'

export default function InFocus({ projectId, taskId, disabled, task }) {
    const blockShortcuts = useSelector(state => state.blockShortcuts)
    const inFocusTaskId = useSelector(state => state.loggedUser.inFocusTaskId)
    const loggedUserId = useSelector(state => state.loggedUser.uid)

    const active = inFocusTaskId === taskId

    const focusTask = () => {
        updateFocusedTask(loggedUserId, projectId, active ? null : task, null, null)
    }

    return (
        <View style={localStyles.container}>
            <View style={{ marginRight: 8 }}>
                <Icon name="crosshair" size={24} color={colors.Text03} />
            </View>
            <Text style={[styles.subtitle2, { color: colors.Text03 }]}>{translate('Focus')}</Text>
            <View style={{ marginLeft: 'auto' }}>
                <Hotkeys
                    keyName={`alt+F`}
                    disabled={disabled || blockShortcuts}
                    onKeyDown={(sht, event) => execShortcutFn(this.buttonRef, focusTask, event)}
                    filter={e => true}
                >
                    <GhostButton
                        ref={ref => (this.buttonRef = ref)}
                        title={translate(active ? 'In focus' : 'Out of focus')}
                        type={'ghost'}
                        icon="crosshair"
                        onPress={focusTask}
                        disabled={disabled}
                        shortcutText={'F'}
                        accessible={false}
                    />
                </Hotkeys>
            </View>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flex: 1,
        flexDirection: 'row',
        maxHeight: 56,
        minHeight: 56,
        height: 56,
        paddingLeft: 8,
        paddingVertical: 8,
        alignItems: 'center',
    },
})
