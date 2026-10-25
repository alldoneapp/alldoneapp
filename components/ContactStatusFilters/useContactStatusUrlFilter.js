import { useEffect, useRef } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { setContactStatusFilter } from '../../redux/actions'
import URLsPeople, {
    URL_ALL_PROJECTS_PEOPLE_ALL,
    URL_ALL_PROJECTS_PEOPLE_FOLLOWED,
    URL_PROJECT_PEOPLE_ALL,
    URL_PROJECT_PEOPLE_FOLLOWED,
} from '../../URLSystem/People/URLsPeople'
import { readContactStatusFromUrl } from '../../URLSystem/People/contactStatusUrl'
import { ALL_TAB } from '../Feeds/Utils/FeedsConstants'
import { CONTACT_STATUS_FILTER_UNASSIGNED } from './contactStatusFilterConstants'

export default function useContactStatusUrlFilter({
    projectId,
    routeUserId,
    currentUserUid,
    contactsActiveTab,
    contactStatuses,
}) {
    const dispatch = useDispatch()
    const contactStatusFilter = useSelector(state => state.contactStatusFilter)
    const filterScope = useRef(null)

    // Keep the selection in the saved list URL without leaking it into other
    // screens (for example, the default status when adding a contact there).
    useEffect(() => () => dispatch(setContactStatusFilter(null)), [dispatch])

    useEffect(() => {
        const scope = `${projectId || ''}:${currentUserUid}`
        let statusId = contactStatusFilter || null
        // The URL owns the first render on arrival (reload, bookmark or back from
        // details). Later chip presses own the URL, until the project/user changes.
        if (filterScope.current !== scope || !projectId) {
            statusId = projectId
                ? readContactStatusFromUrl(`${window.location.pathname}${window.location.search}`, projectId)
                : null
        }
        filterScope.current = scope
        if (statusId && contactStatuses && statusId !== CONTACT_STATUS_FILTER_UNASSIGNED && !contactStatuses[statusId])
            statusId = null
        if (statusId !== (contactStatusFilter || null)) dispatch(setContactStatusFilter(statusId))

        const urlConstant = projectId
            ? contactsActiveTab === ALL_TAB
                ? URL_PROJECT_PEOPLE_ALL
                : URL_PROJECT_PEOPLE_FOLLOWED
            : contactsActiveTab === ALL_TAB
              ? URL_ALL_PROJECTS_PEOPLE_ALL
              : URL_ALL_PROJECTS_PEOPLE_FOLLOWED
        const basePath = URLsPeople.getPath(urlConstant, projectId, routeUserId)
        // Replace when only the filter changed, preserving the board's history
        // entry so returning from a contact also restores its filter.
        const writeUrl = window.location.pathname === `/${basePath}` ? URLsPeople.replace : URLsPeople.push
        if (projectId) writeUrl(urlConstant, { projectId, userId: routeUserId }, projectId, routeUserId, statusId)
        else writeUrl(urlConstant)
    }, [projectId, routeUserId, currentUserUid, contactsActiveTab, contactStatusFilter, contactStatuses, dispatch])
}
