import { useEffect } from 'react'
import v4 from 'uuid/v4'
import { useDispatch } from 'react-redux'

import { unwatch, watchProject } from '../utils/backends/firestore'
import { PROJECT_PRIVATE } from '../components/SettingsView/ProjectsSettings/ProjectHelper'
import store from '../redux/store'
import SharedHelper from '../utils/SharedHelper'
import { navigateToAllProjectsTasks, resetFloatPopup, setShowAccessDeniedPopup } from '../redux/actions'
import NavigationService from '../utils/NavigationService'

export default function usePrivateProject(projectId) {
    const dispatch = useDispatch()

    const callback = project => {
        const { loggedUser } = store.getState()

        if (
            project &&
            project.isShared === PROJECT_PRIVATE &&
            (!project.userIds.includes(loggedUser.uid) || loggedUser.isAnonymous)
        ) {
            if (loggedUser.isAnonymous) {
                SharedHelper.redirectToPrivateResource()
            } else {
                dispatch([resetFloatPopup(), setShowAccessDeniedPopup(true), navigateToAllProjectsTasks()])
                NavigationService.navigate('Root')
            }
        }
    }

    useEffect(() => {
        const watcherKey = v4()
        watchProject(projectId, callback, watcherKey)
        return () => {
            unwatch(watcherKey)
        }
    }, [projectId])

    return null
}
