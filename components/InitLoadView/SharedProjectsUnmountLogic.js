import React, { useEffect } from 'react'
import { View } from 'react-native'
import { useDispatch } from 'react-redux'

import ProjectHelper from '../SettingsView/ProjectsSettings/ProjectHelper'
import store from '../../redux/store'
import { unwatchProjectsData } from '../../utils/InitialLoad/initialLoadHelper'
import { removeSharedProjectsData } from '../../redux/actions'

export default function SharedProjectsUnmountLogic() {
    const dispatch = useDispatch()

    useEffect(() => {
        return () => {
            const { loggedUserProjects, loggedUser } = store.getState()
            const sharedProjects = ProjectHelper.getSharedProjectsInList(loggedUserProjects, loggedUser.projectIds)
            const projectIds = sharedProjects.map(project => project.id)
            unwatchProjectsData(projectIds)
            dispatch(removeSharedProjectsData(projectIds))
        }
    }, [])

    return <View />
}
