import { useSelector } from 'react-redux'
import v4 from 'uuid/v4'

import { useEffect } from 'react'
import { unwatchSidebarTasksAmount, watchSidebarTasksAmount } from '../../utils/backends/Tasks/taskNumbers'

export default function useSideBarTasksAmount() {
    const loggedUserProjects = useSelector(state => state.loggedUserProjects)
    const projectWorkstreams = useSelector(state => state.projectWorkstreams)

    const projectIds = loggedUserProjects.map(project => project.id)

    const workstreamsUsersIdsByProject = projectIds.map((projectId, index) => {
        return projectWorkstreams[projectId].map(ws => {
            return { wsId: ws.uid, userIds: ws.userIds }
        })
    })

    useEffect(() => {
        const normalWatcherKeys = projectIds.map(() => v4())
        const observedWatcherKeys = projectIds.map(() => v4())
        watchSidebarTasksAmount(projectIds, workstreamsUsersIdsByProject, normalWatcherKeys, observedWatcherKeys)
        return () => {
            unwatchSidebarTasksAmount([...normalWatcherKeys, ...observedWatcherKeys])
        }
    }, [JSON.stringify(projectIds), JSON.stringify(workstreamsUsersIdsByProject)])
}
