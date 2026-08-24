import { useSelector } from 'react-redux'
import v4 from 'uuid/v4'

import { useEffect, useRef } from 'react'
import {
    clearSidebarTasksAmount,
    unwatchSidebarTasksAmount,
    watchSidebarTasksAmount,
} from '../../utils/backends/Tasks/taskNumbers'

export default function useSideBarTasksAmount() {
    const loggedUserProjects = useSelector(state => state.loggedUserProjects)
    const projectWorkstreams = useSelector(state => state.projectWorkstreams)

    const projectIds = loggedUserProjects.map(project => project.id)

    const workstreamsUsersIdsByProject = projectIds.map(projectId => {
        return (projectWorkstreams[projectId] || []).map(ws => {
            return { wsId: ws.uid, userIds: ws.userIds }
        })
    })
    const projectIdsKey = JSON.stringify(projectIds)
    const workstreamsUsersIdsKey = JSON.stringify(workstreamsUsersIdsByProject)
    const watcherControllerRef = useRef(null)

    useEffect(() => {
        const normalWatcherKeys = projectIds.map(() => v4())
        const observedWatcherKeys = projectIds.map(() => v4())
        watcherControllerRef.current = watchSidebarTasksAmount(
            projectIds,
            workstreamsUsersIdsByProject,
            normalWatcherKeys,
            observedWatcherKeys
        )
        return () => {
            watcherControllerRef.current = null
            unwatchSidebarTasksAmount([...normalWatcherKeys, ...observedWatcherKeys], { clearNumbers: false })
        }
    }, [projectIdsKey])

    useEffect(() => {
        watcherControllerRef.current?.updateWorkstreamsUsersIdsByProject(workstreamsUsersIdsByProject)
    }, [workstreamsUsersIdsKey])

    // A dependency update above is only a watcher reconfiguration and must keep
    // the last confirmed counts visible. Clear them only when the whole owner
    // leaves the tree (logout / session teardown).
    useEffect(() => () => clearSidebarTasksAmount(), [])
}
