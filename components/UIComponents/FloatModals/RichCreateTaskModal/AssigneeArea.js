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

    // AT-2464: an unresolvable project is a real state here, not a defensive `?.` — `RichCreateTaskModal`
    // deliberately falls back to a bare `{ id: projectId }` when `loggedUserProjectsMap` has no entry
    // (PT-4745, so that an unknown id keeps the switcher row instead of hiding it), and the automatic
    // project option can resolve to no host project at all. Dereferencing that threw one line above the
    // AT-2464 crash site, in the same render — and a throw here takes the whole app down through the
    // top-level ErrorBoundary. "Not a guide" is the right answer for a project we cannot read.
    const isGuide = !!ProjectHelper.getProjectById(projectId)?.parentTemplateId

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
