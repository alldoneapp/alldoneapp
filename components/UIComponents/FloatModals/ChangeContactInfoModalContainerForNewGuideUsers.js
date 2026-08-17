import React from 'react'
import { Platform, StyleSheet, View } from 'react-native'
import { useSelector, useDispatch } from 'react-redux'

import ChangeContactInfoModal from './ChangeContactInfoModal'
import { setUserInfoModalWhenUserJoinsToGuide } from '../../../redux/actions'
import ProjectHelper from '../../SettingsView/ProjectsSettings/ProjectHelper'
import { colors, hexColorToRGBa } from '../../styles/global'
import useSafeAreaOverlayPadding from '../../../hooks/useSafeAreaOverlayPadding'

export default function ChangeContactInfoModalContainerForNewGuideUsers() {
    const safeAreaOverlayPadding = useSafeAreaOverlayPadding()
    const dispatch = useDispatch()
    const loggedUserId = useSelector(state => state.loggedUser.uid)
    const projectId = useSelector(state => state.loggedUserProjects[state.loggedUserProjects.length - 1].id)
    const onSaveData = value => {
        ProjectHelper.setUserInfoGlobally(
            loggedUserId,
            value.role.trim(),
            value.company.trim(),
            value.description.trim()
        )
    }

    const closePopover = () => {
        dispatch(setUserInfoModalWhenUserJoinsToGuide(false))
    }

    return (
        <View style={[localStyles.parent, safeAreaOverlayPadding]}>
            <ChangeContactInfoModal
                closePopover={closePopover}
                onSaveData={onSaveData}
                currentRole={''}
                currentCompany={''}
                currentDescription={''}
                projectId={projectId}
            />
        </View>
    )
}

const localStyles = StyleSheet.create({
    parent: {
        position: 'absolute',
        zIndex: 10000,
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        // Truly centered (not the top-pinned overlay: the child caps itself at
        // height-32, which overflowed the 80/16 reserve), and with a real
        // scrim - this was an invisible full-screen click blocker before.
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: hexColorToRGBa(colors.Text03, 0.24),
        ...Platform.select({ web: { position: 'fixed' } }),
    },
})
