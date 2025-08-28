import React, { useRef } from 'react'
import { StyleSheet, TouchableOpacity, View } from 'react-native'
import { useSelector } from 'react-redux'
import Hotkeys from 'react-hot-keys'

import store from '../../../../redux/store'
import { showFloatPopup } from '../../../../redux/actions'
import { execShortcutFn } from '../../../../utils/HelperFunctions'
import AssigneeShortcut from './AssigneeShortcut'
import AssigneeIcon from './AssigneeIcon'
import ProjectHelper from '../../../SettingsView/ProjectsSettings/ProjectHelper'

export default function AssigneeArea({ projectId, task, showAssignee, containerStyle }) {
    const showShortcuts = useSelector(state => state.showShortcuts)
    const buttonRef = useRef(null)

    const project = ProjectHelper.getProjectById(projectId)
    const isGuide = !!project.parentTemplateId

    return (
        <View style={[localStyles.container, containerStyle]}>
            <Hotkeys
                keyName={'alt+a'}
                onKeyDown={(sht, event) => {
                    execShortcutFn(buttonRef.current, showAssignee, event)
                }}
                filter={e => true}
                disabled={isGuide}
            >
                <TouchableOpacity ref={buttonRef} onPress={showAssignee} accessible={false} disabled={isGuide}>
                    {showShortcuts ? <AssigneeShortcut /> : <AssigneeIcon projectId={projectId} userId={task.userId} />}
                </TouchableOpacity>
            </Hotkeys>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        position: 'absolute',
        top: 70,
        right: 24,
        zIndex: 1000,
    },
})
