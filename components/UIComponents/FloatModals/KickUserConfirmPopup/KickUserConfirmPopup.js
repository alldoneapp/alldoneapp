import React, { useState, useEffect } from 'react'
import { StyleSheet, View } from 'react-native'
import { useSelector } from 'react-redux'
import v4 from 'uuid/v4'

import { colors } from '../../../styles/global'
import store from '../../../../redux/store'
import ProjectHelper from '../../../SettingsView/ProjectsSettings/ProjectHelper'
import Backend from '../../../../utils/BackendBridge'
import { applyPopoverWidth } from '../../../../utils/HelperFunctions'
import Header from './Header'
import ButtonsArea from './ButtonsArea'
import Options from './Options'
import { unwatch, watchProject } from '../../../../utils/backends/firestore'
import { kickUserFromProject } from '../../../../utils/backends/Users/usersFirestore'

export default function KickUserConfirmPopup({ projectId, userId, navigation, mainNavigation, hidePopup }) {
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)
    const [inProgress, setInProgress] = useState(false)
    const [selectedUserId, setSelectedUserId] = useState(userId)
    const [parentTemplateCreatorId, setParentTemplateCreatorId] = useState(null)

    const project = ProjectHelper.getProjectById(projectId)

    const checkIfUserIsLastUser = () => {
        if (parentTemplateCreatorId) {
            const { administratorUser } = store.getState()
            return (
                project.userIds.filter(
                    uid => uid !== userId && uid !== parentTemplateCreatorId && uid !== administratorUser.uid
                ).length === 0
            )
        } else {
            return project.userIds.filter(uid => uid !== userId).length === 0
        }
    }

    const isLastUser = checkIfUserIsLastUser()

    const updateParentTemplateCreatorId = template => {
        setParentTemplateCreatorId(template ? template.templateCreatorId : '')
    }

    useEffect(() => {
        if (project && project.parentTemplateId) {
            const watcherKey = v4()
            watchProject(project.parentTemplateId, updateParentTemplateCreatorId, watcherKey)
            return () => {
                unwatch(watcherKey)
            }
        } else {
            setParentTemplateCreatorId('')
        }
    }, [])

    const confirmKickUser = async () => {
        setInProgress(true)

        if (isLastUser) {
            await Backend.removeProject(projectId)
        } else {
            await kickUserFromProject(projectId, userId)
        }

        hidePopup()
    }

    const sidebarOpenStyle = smallScreenNavigation ? null : { marginLeft: 300 }

    return (
        <View style={[localStyles.container, applyPopoverWidth(), sidebarOpenStyle]}>
            {<Header isLastUser={isLastUser} />}
            {!isLastUser && (
                <Options
                    projectId={projectId}
                    userId={userId}
                    selectedUserId={selectedUserId}
                    setSelectedUserId={setSelectedUserId}
                    inProgress={inProgress}
                />
            )}
            <ButtonsArea
                executeTrigger={confirmKickUser}
                inProgress={inProgress}
                hidePopup={hidePopup}
                disabled={parentTemplateCreatorId === null}
            />
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        backgroundColor: colors.Secondary400,
        shadowColor: 'rgba(0,0,0,0.04)',
        shadowOffset: { width: 0, height: 16 },
        shadowOpacity: 1,
        shadowRadius: 24,
        borderRadius: 4,
        alignItems: 'center',
    },
})
