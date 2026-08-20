import React, { useEffect, useState } from 'react'
import { Image, StyleSheet, TouchableOpacity, View } from 'react-native'
import Hotkeys from 'react-hot-keys'
import { find } from 'lodash'
import { useSelector } from 'react-redux'

import Shortcut from '../Shortcut'
import ProjectHelper from '../../SettingsView/ProjectsSettings/ProjectHelper'
import { colors } from '../../styles/global'
import { execShortcutFn } from '../../../utils/HelperFunctions'
import SVGGenericUser from '../../../assets/svg/SVGGenericUser'
import { WORKSTREAM_ID_PREFIX } from '../../Workstreams/WorkstreamHelper'
import Icon from '../../Icon'
import { ALL_GOALS_ID } from '../../AllSections/allSectionHelper'
import store from '../../../redux/store'
import { requestProjectDataOnLookupMiss } from '../../../utils/InitialLoad/projectDataLoader'

export default function AssigneeButton({ projectId, task, disabled, showPopover }) {
    const showShortcuts = useSelector(state => state.showShortcuts)
    const currentUserId = useSelector(state => state.currentUser.uid)
    const loggedUserId = useSelector(state => state.loggedUser.uid)
    const [photoURL, setPhotoURL] = useState('')

    const userId = task.userId ? task.userId : currentUserId !== ALL_GOALS_ID ? currentUserId : loggedUserId
    const disableAssigneePicker = disabled || task.done

    // AT-2386: `state.project*[projectId]` is filled on demand now, so this lookup can legitimately
    // find nobody. It always could in principle - a deleted assignee - and `user.photoURL` on an
    // undefined `user` threw; that is now a missing avatar instead of a crashed row.
    //
    // `projectPeopleKey` re-runs the effect once the project's people land, so the avatar fills in
    // silently rather than staying blank. A STRING of the four sizes, not the arrays themselves:
    // the slices are seeded `[]` for every project from the first frame, so their presence never
    // changes and only their contents do — and a primitive cannot allocate a fresh identity on
    // every selector run the way an object would (AT-2336).
    const projectPeopleKey = useSelector(state =>
        [
            state.projectUsers[projectId],
            state.projectContacts[projectId],
            state.projectWorkstreams[projectId],
            state.projectAssistants[projectId],
        ]
            .map(list => (list ? list.length : -1))
            .join('|')
    )

    useEffect(() => {
        const { projectUsers, projectContacts, projectWorkstreams, projectAssistants, globalAssistants } =
            store.getState()

        const user =
            find(projectUsers[projectId], ['uid', userId]) ||
            find(projectContacts[projectId], ['uid', userId]) ||
            find(projectWorkstreams[projectId], ['uid', userId]) ||
            find(projectAssistants[projectId], ['uid', userId]) ||
            find(globalAssistants, ['uid', userId])

        if (!user) {
            requestProjectDataOnLookupMiss(projectId)
            setPhotoURL('')
            return
        }

        setPhotoURL(user.photoURL)
    }, [userId, projectId, projectPeopleKey])

    return (
        <Hotkeys
            keyName={'alt+a'}
            disabled={disableAssigneePicker}
            onKeyDown={(sht, event) => {
                if (!disableAssigneePicker) execShortcutFn(this.buttonRef, showPopover, event)
            }}
            filter={e => true}
        >
            <TouchableOpacity
                ref={ref => (this.btnRef = ref)}
                onPress={!disableAssigneePicker ? showPopover : undefined}
                disabled={disableAssigneePicker}
            >
                {showShortcuts ? (
                    <View style={[localStyles.shortcut, disableAssigneePicker && localStyles.containerDisabled]}>
                        <Shortcut text={'A'} />
                    </View>
                ) : (
                    <View style={[localStyles.assigneeButton, disableAssigneePicker && localStyles.containerDisabled]}>
                        {userId.startsWith(WORKSTREAM_ID_PREFIX) ? (
                            <Icon size={24} name="workstream" color={colors.Text03} />
                        ) : photoURL ? (
                            <Image style={{ width: 24, height: 24 }} source={{ uri: photoURL }} />
                        ) : (
                            <SVGGenericUser width={24} height={24} svgid={`ci_p_${userId}_${projectId}`} />
                        )}
                    </View>
                )}
            </TouchableOpacity>
        </Hotkeys>
    )
}

const localStyles = StyleSheet.create({
    containerDisabled: {
        opacity: 0.5,
    },
    assigneeButton: {
        width: 24,
        height: 24,
        borderRadius: 50,
        backgroundColor: '#ffffff',
    },
    shortcut: {
        width: 24,
        height: 24,
        borderRadius: 50,
        backgroundColor: 'rgba(138, 148, 166, 0.24)',
        justifyContent: 'center',
        alignItems: 'center',
    },
})
