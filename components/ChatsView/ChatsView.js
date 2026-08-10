import React, { useEffect, useMemo, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { checkIfSelectedAllProjects, checkIfSelectedProject } from '../SettingsView/ProjectsSettings/ProjectHelper'
import { useDispatch, useSelector } from 'react-redux'
import { DV_TAB_ROOT_CHATS } from '../../utils/TabNavigationConstants'
import { ALL_TAB } from '../Feeds/Utils/FeedsConstants'
import { setChatsUnreadOnly, setNavigationRoute } from '../../redux/actions'
import URLsChats, {
    URL_ALL_PROJECTS_CHATS_ALL,
    URL_ALL_PROJECTS_CHATS_FOLLOWED,
    URL_PROJECT_USER_CHATS_ALL,
    URL_PROJECT_USER_CHATS_FOLLOWED,
} from '../../URLSystem/Chats/URLsChats'
import ChatsByProject from './ChatsByProject'
import { sortBy } from 'lodash'
import HashtagFiltersView from '../HashtagFilters/HashtagFiltersView'
import NothingToShowOnChats from '../UIComponents/NothingToShowOnChats'
import AllProjectsLine from '../TaskListView/Header/AllProjectsLine/AllProjectsLine'
import MarkAsRead from './MarkAsRead'
import ChatFiltersLine from './ChatFiltersLine'

function ChatsView() {
    const dispatch = useDispatch()
    const selectedProjectIndex = useSelector(state => state.selectedProjectIndex)
    const loggedUserProjects = useSelector(state => state.loggedUserProjects)
    const loggedUserId = useSelector(state => state.loggedUser.uid)
    const archivedProjectIds = useSelector(state => state.loggedUser.archivedProjectIds)
    const templateProjectIds = useSelector(state => state.loggedUser.templateProjectIds)
    const chatsActiveTab = useSelector(state => state.chatsActiveTab)
    const unreadOnly = useSelector(state => state.chatsUnreadOnly)
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)
    const isMiddleScreen = useSelector(state => state.isMiddleScreen)

    const inAllProjects = checkIfSelectedAllProjects(selectedProjectIndex)
    const inSelectedProject = checkIfSelectedProject(selectedProjectIndex)

    // How many project sections this actually mounts, because it keeps being re-investigated
    // (AT-2162, AT-2200) and the raw user document is misleading:
    //
    // `loggedUserProjects` is NOT the user's whole project list. It is loaded from the already
    // narrowed `loggedUser.projectIds` that `updateInactiveProjectsData` (redux/store.js) produces,
    // which drops archived projects, and - for a user who owns at least one template - every
    // template and every guide except the one named in the URL. The filter below is therefore
    // mostly a second line of defence; it only has anything left to remove when a URL opened an
    // archived project (`areArchivedActive`) or an active template.
    //
    // Verified against production for the largest account (140 project ids: 31 archived, 31
    // templates, 64 guides): 14 sections mount, not 140 and not the 78 that "minus archived, minus
    // templates" suggests. Across a 4,000-user sample the maximum anywhere is 14 and the median is
    // 2, so there is nothing here worth virtualizing - per-project listener cost is the lever, not
    // the number of projects.
    //
    // Guides are deliberately kept (sorted after the normal projects), matching every sibling
    // "All Projects" view - Tasks/Done, Goals, Notes, Skills. Excluding them here would gain at
    // most 4 sections for a real user and make Chats inconsistent with all of them.
    //
    // Memoized so the derived arrays keep their identity across renders: `sortedProjectIds` is a
    // dependency of ChatFiltersLine's own useMemo, and a fresh array on every render made that
    // recompute the unread counts over every project each time (AT-2162).
    const sortedProjects = useMemo(() => {
        const projects = loggedUserProjects.filter(
            project => !templateProjectIds.includes(project.id) && !archivedProjectIds.includes(project.id)
        )

        const normalProjects = projects.filter(project => !project.parentTemplateId)
        const guides = projects.filter(project => !!project.parentTemplateId)

        return [
            ...sortBy(normalProjects, [item => -item.lastChatActionDate]),
            ...sortBy(guides, [item => -item.lastChatActionDate]),
        ]
    }, [loggedUserProjects, templateProjectIds, archivedProjectIds])

    const sortedProjectIds = useMemo(() => sortedProjects.map(project => project.id), [sortedProjects])

    const selectedProjectId = inSelectedProject ? loggedUserProjects[selectedProjectIndex].id : null
    const filteredProjectIds = useMemo(() => (inSelectedProject ? [selectedProjectId] : sortedProjectIds), [
        inSelectedProject,
        selectedProjectId,
        sortedProjectIds,
    ])

    const [areThereChats, setAreThereChats] = useState({})
    const setUnreadOnly = value => dispatch(setChatsUnreadOnly(value))

    useEffect(() => () => dispatch(setChatsUnreadOnly(false)), [])

    const writeBrowserURL = () => {
        if (inSelectedProject) {
            URLsChats.push(
                chatsActiveTab === ALL_TAB ? URL_PROJECT_USER_CHATS_ALL : URL_PROJECT_USER_CHATS_FOLLOWED,
                null,
                loggedUserProjects[selectedProjectIndex].id,
                loggedUserId
            )
        } else {
            URLsChats.push(
                chatsActiveTab === ALL_TAB ? URL_ALL_PROJECTS_CHATS_ALL : URL_ALL_PROJECTS_CHATS_FOLLOWED,
                null
            )
        }
    }

    useEffect(() => {
        dispatch(setNavigationRoute(DV_TAB_ROOT_CHATS))
    }, [])

    useEffect(() => {
        writeBrowserURL()
    }, [chatsActiveTab, selectedProjectIndex])

    return (
        <View
            style={[
                localStyles.container,
                inAllProjects && localStyles.containerSpace,
                smallScreenNavigation ? localStyles.containerMobile : isMiddleScreen && localStyles.containerTablet,
            ]}
        >
            {inAllProjects && (
                <AllProjectsLine
                    showActions={false}
                    customRight={<MarkAsRead projectIds={sortedProjectIds} userId={loggedUserId} />}
                />
            )}

            <HashtagFiltersView />

            <ChatFiltersLine projectIds={filteredProjectIds} unreadOnly={unreadOnly} setUnreadOnly={setUnreadOnly} />

            {inSelectedProject ? (
                <ChatsByProject
                    project={loggedUserProjects[selectedProjectIndex]}
                    setChatXProject={setAreThereChats}
                    unreadOnly={unreadOnly}
                />
            ) : (
                <>
                    {!Object.values(areThereChats).includes(true) && <NothingToShowOnChats isInChats />}
                    {sortedProjects.map(project => (
                        <ChatsByProject
                            key={project.id}
                            project={project}
                            isInAllProjects
                            setChatXProject={setAreThereChats}
                            unreadOnly={unreadOnly}
                        />
                    ))}
                </>
            )}
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        marginHorizontal: 104,
    },
    containerSpace: {
        marginBottom: 32,
    },
    containerMobile: {
        marginHorizontal: 16,
    },
    containerTablet: {
        marginHorizontal: 56,
    },
})

export default ChatsView
