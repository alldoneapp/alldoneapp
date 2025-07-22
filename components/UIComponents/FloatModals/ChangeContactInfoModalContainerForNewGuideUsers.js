import React from 'react'
import { StyleSheet, View } from 'react-native'
import { useSelector, useDispatch } from 'react-redux'

import ChangeContactInfoModal from './ChangeContactInfoModal'
import { setUserInfoModalWhenUserJoinsToGuide } from '../../../redux/actions'
import ProjectHelper from '../../SettingsView/ProjectsSettings/ProjectHelper'

export default function ChangeContactInfoModalContainerForNewGuideUsers() {
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
        <View style={localStyles.parent}>
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
        justifyContent: 'center',
        alignItems: 'center',
    },
})
