import React, { useEffect, useRef, useState } from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import v4 from 'uuid/v4'
import { useDispatch, useSelector } from 'react-redux'

import styles, { colors, hexColorToRGBa, POPOVER_MOBILE_WIDTH, SIDEBAR_MENU_WIDTH } from '../styles/global'
import store from '../../redux/store'
import {
    blockBackgroundTabShortcut,
    hideFloatPopup,
    hideGlobalSearchPopup,
    resetNotesAmounts,
    setBlockShortcuts,
    setGlobalSearchResults,
    setSearchText,
    startLoadingData,
    stopLoadingData,
    unblockBackgroundTabShortcut,
} from '../../redux/actions'
import Icon from '../Icon'
import SearchForm from './Form/SearchForm'
import { GLOBAL_SEARCH_MODAL_ID, removeModal, storeModal } from '../ModalsManager/modalsManager'
import ResultLists from './ResultLists/ResultLists'
import {
    MENTION_MODAL_CONTACTS_TAB,
    MENTION_MODAL_GOALS_TAB,
    MENTION_MODAL_NOTES_TAB,
    MENTION_MODAL_TASKS_TAB,
    MENTION_MODAL_TOPICS_TAB,
} from '../Feeds/CommentsTextInput/textInputHelper'
import algoliasearch from 'algoliasearch'
import {
    CHATS_INDEX_NAME_PREFIX,
    CONTACTS_INDEX_NAME_PREFIX,
    GOALS_INDEX_NAME_PREFIX,
    NOTES_INDEX_NAME_PREFIX,
    TASKS_INDEX_NAME_PREFIX,
} from './searchHelper'
import { FEED_PUBLIC_FOR_ALL } from '../Feeds/Utils/FeedsConstants'
import Backend from '../../utils/BackendBridge'
import { convertNoteObjectType, getInitialTab, goToObjectDetailView } from './searchFunctions'
import ProjectFilter from './Filter/ProjectFilter'
import ActiveFullSearch from './Filter/ActiveFullSearch'
import Line from '../UIComponents/FloatModals/GoalMilestoneModal/Line'
import SelectProjectModalInSearch, {
    ALL_PROJECTS_OPTION,
} from '../UIComponents/FloatModals/SelectProjectModal/SelectProjectModalInSearch'
import {
    watchUserProjects,
    unwatch,
    runHttpsCallableFunction,
    spentGold,
    getAllUserProjects,
} from '../../utils/backends/firestore'
import { PLAN_STATUS_PREMIUM } from '../Premium/PremiumHelper'
import ProjectHelper, { checkIfSelectedProject } from '../SettingsView/ProjectsSettings/ProjectHelper'
import { getDvMainTabLink } from '../../utils/LinkingHelper'

export default function GlobalSearchModal() {
    const dispatch = useDispatch()

    const activeFullSearchDate = useSelector(state => state.loggedUser.activeFullSearchDate)
    const premiumStatus = useSelector(state => state.loggedUser.premium.status)
    const realTemplateProjectsAmount = useSelector(state => state.loggedUser.realTemplateProjectIds.length)
    const searchText = useSelector(state => state.searchText)
    const mobile = useSelector(state => state.smallScreenNavigation)
    const tablet = useSelector(state => state.isMiddleScreen)
    const [projects, setProjects] = useState([])
    const [fullSearchMap, setFullSearchMap] = useState({ all: false, indexing: true })
    const [activeFullSearchInAllProjects, setActiveFullSearchInAllProjects] = useState(false)
    const [indexingFullSearchInAllProjects, setIndexingActiveFullSearchInAllProjects] = useState(false)
    const [indexing, setIndexing] = useState(false)
    const [showShortcuts, setShowShortcuts] = useState(false)
    const [activeTab, setActiveTab] = useState(getInitialTab)
    const [localText, setLocalText] = useState(searchText)
    const [processing, setProcessing] = useState({
        [MENTION_MODAL_CONTACTS_TAB]: false,
        [MENTION_MODAL_GOALS_TAB]: false,
        [MENTION_MODAL_NOTES_TAB]: false,
        [MENTION_MODAL_TASKS_TAB]: false,
        [MENTION_MODAL_TOPICS_TAB]: false,
    })
    const [tasksResult, setTasksResult] = useState({})
    const [tasksResultAmount, setTasksResultAmount] = useState(0)
    const [goalsResult, setGoalsResult] = useState({})
    const [goalsResultAmount, setGoalsResultAmount] = useState(0)
    const [notesResult, setNotesResult] = useState({})
    const [notesResultAmount, setNotesResultAmount] = useState(0)
    const [contactsResult, setContactsResult] = useState({})
    const [contactsResultAmount, setContactsResultAmount] = useState(0)
    const [chatsResult, setChatsResult] = useState({})
    const [chatsResultAmount, setChatsResultAmount] = useState(0)

    const [activeItemData, setActiveItemData] = useState({ projectId: '', activeIndex: -1 })
    const [showSelectProjectModal, setShowSelectProjectModal] = useState(false)
    const [selectedProject, setSelectedProject] = useState({ id: ALL_PROJECTS_OPTION })
    const searchInstanceIdRef = useRef(v4())
    const modalRef = useRef(null)
    const searchInputRef = useRef(null)
    const activeItemRef = useRef(null)
    const scrollRef = useRef(null)
    const resultsContainerRef = useRef(null)

    const inSelectedProject = selectedProject.id !== ALL_PROJECTS_OPTION

    const onKeyDownShortcuts = event => {
        if (event.altKey && !showShortcuts) {
            setShowShortcuts(true)
            event.preventDefault()
        }
    }

    const onKeyUpShortcuts = event => {
        if (!event.altKey && showShortcuts) {
            setShowShortcuts(false)
            event.preventDefault()
        }
    }

    const isSearching = () => {
        return (
            processing[MENTION_MODAL_CONTACTS_TAB] ||
            processing[MENTION_MODAL_CONTACTS_TAB] ||
            processing[MENTION_MODAL_CONTACTS_TAB] ||
            processing[MENTION_MODAL_CONTACTS_TAB] ||
            processing[MENTION_MODAL_CONTACTS_TAB]
        )
    }

    const updateTemporaryProjectsAndUsers = async () => {
        const {
            loggedUser,
            areArchivedActive,
            activeGuideId,
            activeTemplateId,
            loggedUserProjects,
            selectedProjectIndex,
        } = store.getState()
        const { realGuideProjectIds, realTemplateProjectIds, realArchivedProjectIds } = loggedUser

        const inactiveGuideIds = realGuideProjectIds.filter(id => id !== activeGuideId)
        const inactiveTemplateIds = realTemplateProjectIds.filter(id => id !== activeTemplateId)

        const inactiveProjectIds = []
        inactiveProjectIds.push(...inactiveGuideIds)
        inactiveProjectIds.push(...inactiveTemplateIds)
        if (!areArchivedActive) inactiveProjectIds.push(...realArchivedProjectIds)

        dispatch(startLoadingData())
        const projectsList = await getAllUserProjects(loggedUser.uid)
        dispatch(stopLoadingData())

        const activeProjects = ProjectHelper.getActiveProjects2(projectsList, loggedUser)
        const guides = ProjectHelper.getGuideProjects(projectsList, loggedUser)
        const templates = ProjectHelper.getTemplateProjects(projectsList, loggedUser)
        const archived = ProjectHelper.getArchivedProjects2(projectsList, loggedUser)

        let sortedProjects = [
            ...ProjectHelper.sortProjects(activeProjects, loggedUser.uid),
            ...ProjectHelper.sortProjects(guides, loggedUser.uid),
            ...ProjectHelper.sortProjects(templates, loggedUser.uid),
            ...ProjectHelper.sortProjects(archived, loggedUser.uid),
        ]

        if (checkIfSelectedProject(selectedProjectIndex)) {
            const selectedProject = sortedProjects.find(
                project => project.id === loggedUserProjects[selectedProjectIndex].id
            )
            sortedProjects = [
                selectedProject,
                ...sortedProjects.filter(project => project.id !== loggedUserProjects[selectedProjectIndex].id),
            ]
        }

        setProjects(sortedProjects)
    }

    useEffect(() => {
        updateTemporaryProjectsAndUsers()
    }, [])

    useEffect(() => {
        document.addEventListener('keydown', onKeyDownShortcuts)
        document.addEventListener('keyup', onKeyUpShortcuts)
        return () => {
            document.removeEventListener('keydown', onKeyDownShortcuts)
            document.removeEventListener('keyup', onKeyUpShortcuts)
        }
    })

    useEffect(() => {
        document.addEventListener('keydown', onKeyDown)
        return () => document.removeEventListener('keydown', onKeyDown)
    })

    useEffect(() => {
        activeItemRef.current = null
        setActiveItemData({ projectId: '', activeIndex: -1 })
        scrollRef?.current?.scrollTo({ y: 0, animated: false })
    }, [activeTab])

    useEffect(() => {
        if (activeItemData.projectId && activeItemData.activeIndex > -1) {
            const scrollAreaHeight = scrollRef.current.getVisibleHigh()
            let scrollAreaScreenPosition

            let itemHeight
            let itemRelativePositionToParent
            let itemScreenPosition

            let scrollContentScreenPosition
            activeItemRef.current.measure((fx, fy, width, height, px, py) => {
                itemHeight = height
                itemRelativePositionToParent = fy
                itemScreenPosition = py
                scrollRef.current.getContainerRef().current.measure((x, fy, width, height, px, py) => {
                    scrollAreaScreenPosition = py
                    resultsContainerRef.current.measure((fx, fy, width, height, px, py) => {
                        scrollContentScreenPosition = py
                        const scrolledOffset = scrollAreaScreenPosition - scrollContentScreenPosition
                        const itemPositionRelativeToScroll = itemScreenPosition - scrollContentScreenPosition
                        if (itemPositionRelativeToScroll < scrolledOffset) {
                            setTimeout(() => {
                                scrollRef.current.scrollTo({
                                    y: itemPositionRelativeToScroll,
                                    animated: false,
                                })
                            })
                        } else if (itemPositionRelativeToScroll + itemHeight > scrollAreaHeight + scrolledOffset) {
                            setTimeout(() => {
                                scrollRef.current.scrollTo({
                                    y: itemPositionRelativeToScroll + itemHeight - scrollAreaHeight,
                                    animated: false,
                                })
                            })
                        }
                    })
                })
            })
        }
    }, [activeItemData])

    useEffect(() => {
        dispatch([blockBackgroundTabShortcut(), setBlockShortcuts(true)])
        storeModal(GLOBAL_SEARCH_MODAL_ID)

        return () => {
            dispatch([unblockBackgroundTabShortcut(), setBlockShortcuts(false)])
            removeModal(GLOBAL_SEARCH_MODAL_ID)
        }
    }, [])

    useEffect(() => {
        if (
            !processing?.[MENTION_MODAL_TASKS_TAB] &&
            !processing?.[MENTION_MODAL_GOALS_TAB] &&
            !processing?.[MENTION_MODAL_NOTES_TAB] &&
            !processing?.[MENTION_MODAL_CONTACTS_TAB] &&
            !processing?.[MENTION_MODAL_TOPICS_TAB]
        ) {
            showNextPositiveResultsTab()
        }
    }, [processing])

    const onKeyDown = event => {
        const { key } = event
        if (key === 'Escape') {
            hidePopup()
        } else if (key === 'Enter') {
            if (projects.length > 0) {
                if (localText.trim() && (searchInputRef.current.isFocused() || activeItemData.activeIndex === -1)) {
                    onSearch()
                } else if (activeItemData.activeIndex !== -1) {
                    const { resultsByProject, objectType, detailedViewType } = selectActiveTabData()
                    const object = resultsByProject[activeItemData.projectId][activeItemData.activeIndex]
                    const objectId = objectType === 'contacts' ? object.uid : object.id

                    const { inactive, projectType } = ProjectHelper.checkIfProjectIdBelongsToInactiveProject(
                        activeItemData.projectId
                    )
                    if (inactive) {
                        const { parentObject } = object
                        const url =
                            objectType === 'notes' && parentObject
                                ? `/projects/${activeItemData.projectId}/${convertNoteObjectType(parentObject.type)}/${
                                      parentObject.id
                                  }/note`
                                : getDvMainTabLink(activeItemData.projectId, objectId, objectType)

                        ProjectHelper.navigateToInactiveProject(projectType, url)
                    } else {
                        goToObjectDetailView(activeItemData.projectId, objectId, objectType, detailedViewType)
                    }
                }
                setTimeout(() => {
                    if (searchInputRef && searchInputRef.current) {
                        searchInputRef.current.focus()
                    }
                })
            }
            event.preventDefault()
            event.stopPropagation()
        } else if (key === 'ArrowDown') {
            event.preventDefault()
            event.stopPropagation()
            selectDown()
        } else if (key === 'ArrowUp') {
            event.preventDefault()
            event.stopPropagation()
            selectUp()
        }
    }

    const selectActiveTabData = () => {
        if (activeTab === MENTION_MODAL_TASKS_TAB) {
            return {
                resultsByProject: tasksResult,
                resultsAmount: tasksResultAmount,
                objectType: 'tasks',
                detailedViewType: 'task',
            }
        } else if (activeTab === MENTION_MODAL_GOALS_TAB) {
            return {
                resultsByProject: goalsResult,
                resultsAmount: goalsResultAmount,
                objectType: 'goals',
                detailedViewType: 'goal',
            }
        } else if (activeTab === MENTION_MODAL_NOTES_TAB) {
            return {
                resultsByProject: notesResult,
                resultsAmount: notesResultAmount,
                objectType: 'notes',
                detailedViewType: 'note',
            }
        } else if (activeTab === MENTION_MODAL_CONTACTS_TAB) {
            return {
                resultsByProject: contactsResult,
                resultsAmount: contactsResultAmount,
                objectType: 'contacts',
                detailedViewType: 'people',
            }
        } else if (activeTab === MENTION_MODAL_TOPICS_TAB) {
            return {
                resultsByProject: chatsResult,
                resultsAmount: chatsResultAmount,
                objectType: 'chats',
                detailedViewType: 'chat',
            }
        }
    }

    const selectDown = () => {
        const { resultsByProject, resultsAmount } = selectActiveTabData()
        if (resultsAmount > 0) {
            searchInputRef.current.blur()
            setActiveItemData(activeItemData => {
                const { projectId, activeIndex } = activeItemData
                let nextProjectId = ''
                let nextActiveIndex = -1

                if (projectId) {
                    if (resultsAmount === 1) {
                        return { ...activeItemData }
                    }
                    if (activeIndex + 1 < resultsByProject[projectId].length) {
                        nextProjectId = projectId
                        nextActiveIndex = activeIndex + 1
                    } else {
                        let startProjectFinded = false
                        let projectIndex = 0
                        while (nextActiveIndex === -1) {
                            const project = projects[projectIndex]

                            if (startProjectFinded) {
                                if (resultsByProject[project.id].length > 0) {
                                    nextProjectId = project.id
                                    nextActiveIndex = 0
                                }
                            } else if (project.id === projectId) {
                                startProjectFinded = true
                            }

                            const nextIndex = projectIndex + 1
                            projectIndex = nextIndex === projects.length ? 0 : nextIndex
                        }
                    }
                } else {
                    for (let i = 0; i < projects.length; i++) {
                        const project = projects[i]
                        if (resultsByProject[project.id].length > 0) {
                            nextProjectId = project.id
                            nextActiveIndex = 0
                            break
                        }
                    }
                }

                return { projectId: nextProjectId, activeIndex: nextActiveIndex }
            })
        }
    }

    const selectUp = () => {
        const { resultsByProject, resultsAmount } = selectActiveTabData()
        if (resultsAmount > 0) {
            searchInputRef.current.blur()
            setActiveItemData(activeItemData => {
                const { projectId, activeIndex } = activeItemData
                let nextProjectId = ''
                let nextActiveIndex = -1

                if (projectId) {
                    if (resultsAmount === 1) {
                        return { ...activeItemData }
                    }
                    if (activeIndex - 1 > -1) {
                        nextProjectId = projectId
                        nextActiveIndex = activeIndex - 1
                    } else {
                        let startProjectFinded = false
                        let projectIndex = 0
                        while (nextActiveIndex === -1) {
                            const project = projects[projectIndex]

                            if (startProjectFinded) {
                                if (resultsByProject[project.id].length > 0) {
                                    nextProjectId = project.id
                                    nextActiveIndex = resultsByProject[project.id].length - 1
                                }
                            } else if (project.id === projectId) {
                                startProjectFinded = true
                            }

                            const nextIndex = projectIndex - 1
                            projectIndex = nextIndex === -1 ? projects.length - 1 : nextIndex
                        }
                    }
                } else {
                    for (let i = projects.length - 1; i > -1; i--) {
                        const project = projects[i]
                        if (resultsByProject[project.id].length > 0) {
                            nextProjectId = project.id
                            nextActiveIndex = resultsByProject[project.id].length - 1
                            break
                        }
                    }
                }

                return { projectId: nextProjectId, activeIndex: nextActiveIndex }
            })
        }
    }

    const hidePopup = event => {
        event?.preventDefault?.()
        dispatch([
            hideFloatPopup(),
            setGlobalSearchResults(null),
            hideGlobalSearchPopup(),
            setSearchText(''),
            resetNotesAmounts(),
        ])
    }

    const onSearchInAlgolia = async (client, indexPrefix, setResults, setResultsAmount, tab, searchInstanceId) => {
        const { loggedUser } = store.getState()

        setResults({})
        setResultsAmount(0)

        const algoliaIndex = client.initIndex(indexPrefix)

        let projectsIdsFilter = ``
        if (inSelectedProject) {
            projectsIdsFilter = `projectId:${selectedProject.id}`
        } else {
            const projectIds = projects.map(p => p.id)
            projectsIdsFilter = projectIds.map(id => `projectId:${id}`).join(' OR ')
        }

        let filters = ''
        if (indexPrefix === GOALS_INDEX_NAME_PREFIX || indexPrefix === CHATS_INDEX_NAME_PREFIX) {
            filters = `(${projectsIdsFilter}) AND (isPublicFor:${FEED_PUBLIC_FOR_ALL} OR isPublicFor:${loggedUser.uid})`
        } else if (indexPrefix === CONTACTS_INDEX_NAME_PREFIX) {
            filters = `(${projectsIdsFilter}) AND (isPrivate:false OR isPublicFor:${loggedUser.uid}) AND isAssistant:false`
        } else {
            filters = `(${projectsIdsFilter}) AND (isPrivate:false OR isPublicFor:${loggedUser.uid})`
        }

        try {
            const results = await algoliaIndex.search(localText, { filters: filters })

            if (searchInstanceId === searchInstanceIdRef.current) {
                const objectsResult = {}
                for (let project of projects) {
                    objectsResult[project.id] = []
                }

                let objectsResultAmount = results.hits.length

                if (inSelectedProject) {
                    objectsResult[selectedProject.id] = results.hits
                } else {
                    // Group results by project
                    for (let i = 0; i < results.hits.length; i++) {
                        const hit = results.hits[i]
                        objectsResult[hit.projectId].push(hit)
                    }
                }

                if (indexPrefix !== CHATS_INDEX_NAME_PREFIX) {
                    const entries = Object.entries(objectsResult)
                    objectsResultAmount = 0
                    for (let i = 0; i < entries.length; i++) {
                        const projectId = entries[i][0]
                        const resultsInProject = entries[i][1]

                        const project = projects.find(project => project.id === projectId)
                        const isGuide = project && !!project.parentTemplateId
                        if (isGuide) {
                            if (indexPrefix === TASKS_INDEX_NAME_PREFIX || indexPrefix === NOTES_INDEX_NAME_PREFIX) {
                                objectsResult[projectId] = resultsInProject.filter(object => {
                                    const needToShowObject = object.userId === loggedUser.uid
                                    if (needToShowObject) objectsResultAmount++
                                    return needToShowObject
                                })
                            } else if (indexPrefix === GOALS_INDEX_NAME_PREFIX) {
                                objectsResult[projectId] = resultsInProject.filter(object => {
                                    const needToShowObject = object.ownerId === loggedUser.uid
                                    if (needToShowObject) objectsResultAmount++
                                    return needToShowObject
                                })
                            } else if (indexPrefix === CONTACTS_INDEX_NAME_PREFIX) {
                                objectsResult[projectId] = resultsInProject.filter(object => {
                                    const needToShowObject =
                                        object.uid === loggedUser.uid || object.recorderUserId === loggedUser.uid
                                    if (needToShowObject) objectsResultAmount++
                                    return needToShowObject
                                })
                            }
                        } else {
                            objectsResultAmount += objectsResult[projectId].length
                        }
                    }
                }

                setResults(objectsResult)
                setResultsAmount(objectsResultAmount)

                setProcessing(processing => {
                    return { ...processing, [tab]: false }
                })
            }
        } catch (error) {
            setProcessing(processing => {
                return { ...processing, [tab]: false }
            })
        }
    }

    const showNextPositiveResultsTab = () => {
        const tabResults = [
            tasksResultAmount,
            goalsResultAmount,
            notesResultAmount,
            contactsResultAmount,
            chatsResultAmount,
        ]
        if (tabResults[activeTab] === 0) {
            for (let resultIdx in tabResults) {
                if (tabResults[resultIdx] > 0) {
                    setActiveTab(parseInt(resultIdx))
                    break
                }
            }
        }
    }

    const updateIndexationDataAndFullSearchData = projects => {
        const fullSearchMap = { all: true, indexing: false }
        projects.forEach(project => {
            fullSearchMap[project.id] = project.activeFullSearch
            if (!project.activeFullSearch || project.activeFullSearch === 'indexing') fullSearchMap.all = false
            if (project.activeFullSearch === 'indexing') fullSearchMap.indexing = true
        })
        setFullSearchMap(fullSearchMap)
    }

    useEffect(() => {
        const { loggedUser } = store.getState()
        const watcherKey = v4()
        watchUserProjects(loggedUser.uid, watcherKey, updateIndexationDataAndFullSearchData)
        return () => {
            unwatch(watcherKey)
        }
    }, [])

    useEffect(() => {
        const activeFullSearchInAllProjects = inSelectedProject
            ? fullSearchMap[selectedProject.id] && fullSearchMap[selectedProject.id] !== 'indexing'
            : fullSearchMap.all
        setActiveFullSearchInAllProjects(activeFullSearchInAllProjects)
        setIndexingActiveFullSearchInAllProjects(fullSearchMap.indexing)
    }, [inSelectedProject, JSON.stringify(selectedProject), JSON.stringify(fullSearchMap)])

    const onSearch = async () => {
        if (localText.trim() !== '') {
            searchInstanceIdRef.current = v4()
            const searchInstanceId = searchInstanceIdRef.current
            setProcessing({
                [MENTION_MODAL_CONTACTS_TAB]: true,
                [MENTION_MODAL_GOALS_TAB]: true,
                [MENTION_MODAL_NOTES_TAB]: true,
                [MENTION_MODAL_TASKS_TAB]: true,
                [MENTION_MODAL_TOPICS_TAB]: true,
            })
            setActiveItemData({ projectId: '', activeIndex: -1 })
            const { ALGOLIA_APP_ID, ALGOLIA_SEARCH_ONLY_API_KEY } = Backend.getAlgoliaSearchOnlyKeys()

            const client = algoliasearch(ALGOLIA_APP_ID, ALGOLIA_SEARCH_ONLY_API_KEY)

            const promises = []
            promises.push(
                onSearchInAlgolia(
                    client,
                    TASKS_INDEX_NAME_PREFIX,
                    setTasksResult,
                    setTasksResultAmount,
                    MENTION_MODAL_TASKS_TAB,
                    searchInstanceId
                )
            )
            promises.push(
                onSearchInAlgolia(
                    client,
                    GOALS_INDEX_NAME_PREFIX,
                    setGoalsResult,
                    setGoalsResultAmount,
                    MENTION_MODAL_GOALS_TAB,
                    searchInstanceId
                )
            )
            promises.push(
                onSearchInAlgolia(
                    client,
                    NOTES_INDEX_NAME_PREFIX,
                    setNotesResult,
                    setNotesResultAmount,
                    MENTION_MODAL_NOTES_TAB,
                    searchInstanceId
                )
            )
            promises.push(
                onSearchInAlgolia(
                    client,
                    CONTACTS_INDEX_NAME_PREFIX,
                    setContactsResult,
                    setContactsResultAmount,
                    MENTION_MODAL_CONTACTS_TAB,
                    searchInstanceId
                )
            )
            promises.push(
                onSearchInAlgolia(
                    client,
                    CHATS_INDEX_NAME_PREFIX,
                    setChatsResult,
                    setChatsResultAmount,
                    MENTION_MODAL_TOPICS_TAB,
                    searchInstanceId
                )
            )
            Promise.all(promises)
        }
    }

    const activateFullSearch = async () => {
        setIndexing(true)
        const { loggedUser } = store.getState()
        spentGold(loggedUser.uid, 500)
        await runHttpsCallableFunction('indexProjectsRecordsInAlgoliaSecondGen', { userId: loggedUser.uid })
        setIndexing(false)
        onSearch()
    }

    const width = mobile ? POPOVER_MOBILE_WIDTH : tablet ? 400 : 520
    let sidebarOpenStyle = mobile ? null : { marginLeft: SIDEBAR_MENU_WIDTH }

    const updateSelectedProject = projectId => {
        const project =
            projectId === ALL_PROJECTS_OPTION
                ? { id: ALL_PROJECTS_OPTION }
                : projects.find(project => project.id === projectId)
        setSelectedProject(project)
    }

    return (
        <View style={localStyles.container} ref={modalRef}>
            <TouchableOpacity style={localStyles.backdrop} onPress={hidePopup} />

            {showSelectProjectModal ? (
                <SelectProjectModalInSearch
                    projectId={selectedProject.id}
                    closePopover={() => {
                        setShowSelectProjectModal(false)
                    }}
                    projects={projects}
                    setSelectedProjectId={updateSelectedProject}
                    showGuideTab={!!activeFullSearchDate}
                    showTemplateTab={realTemplateProjectsAmount > 0}
                    showArchivedTab={true}
                    showAllProjects={true}
                />
            ) : (
                <View style={[localStyles.popup, { width: width }, sidebarOpenStyle]}>
                    <View style={localStyles.titleContainer}>
                        <Text style={[styles.title7, localStyles.title]}>Search</Text>
                    </View>
                    <ProjectFilter
                        setShowSelectProjectModal={() => {
                            setShowSelectProjectModal(true)
                        }}
                        selectedProject={selectedProject}
                        containerStyle={inSelectedProject && { marginBottom: 16 }}
                        disabled={projects.length === 0 || indexing || indexingFullSearchInAllProjects}
                    />

                    <ActiveFullSearch
                        activeFullSearchInAllProjects={
                            activeFullSearchDate &&
                            activeFullSearchInAllProjects &&
                            premiumStatus === PLAN_STATUS_PREMIUM
                        }
                        activateFullSearch={activateFullSearch}
                        disabled={isSearching() || projects.length === 0 || indexing || indexingFullSearchInAllProjects}
                        closeModalSearchModal={hidePopup}
                    />

                    <Line style={{ width: '100%', marginTop: 0, marginBottom: 16 }} />
                    <SearchForm
                        searchInputRef={searchInputRef}
                        onPressButton={onSearch}
                        localText={localText}
                        setLocalText={setLocalText}
                        showShortcuts={showShortcuts}
                        placeholder="Search term..."
                        buttonIcon="search"
                        disabledButton={projects.length === 0 || indexing || indexingFullSearchInAllProjects}
                    />

                    <ResultLists
                        projects={projects}
                        processing={processing}
                        tasksResultAmount={tasksResultAmount}
                        tasksResult={tasksResult}
                        goalsResultAmount={goalsResultAmount}
                        goalsResult={goalsResult}
                        notesResultAmount={notesResultAmount}
                        notesResult={notesResult}
                        contactsResultAmount={contactsResultAmount}
                        contactsResult={contactsResult}
                        chatsResultAmount={chatsResultAmount}
                        chatsResult={chatsResult}
                        activeItemData={activeItemData}
                        activeTab={activeTab}
                        setActiveTab={setActiveTab}
                        activeItemRef={activeItemRef}
                        scrollRef={scrollRef}
                        resultsContainerRef={resultsContainerRef}
                        showShortcuts={showShortcuts}
                        indexing={indexing || indexingFullSearchInAllProjects}
                    />

                    <View style={localStyles.closeContainer}>
                        <TouchableOpacity style={localStyles.closeButton} onPress={hidePopup}>
                            <Icon name={'x'} size={24} color={colors.Text03} />
                        </TouchableOpacity>
                    </View>
                </View>
            )}
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        position: 'absolute',
        zIndex: 10000,
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: hexColorToRGBa(colors.Text03, 0.24),
        justifyContent: 'center',
        alignItems: 'center',
    },
    backdrop: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 10100,
    },
    popup: {
        backgroundColor: colors.Secondary400,
        paddingVertical: 16,
        shadowColor: 'rgba(0,0,0,0.04)',
        shadowOffset: { width: 0, height: 16 },
        shadowOpacity: 1,
        shadowRadius: 24,
        borderRadius: 4,
        alignItems: 'center',
        height: 512,
        maxHeight: 512,
        minHeight: 512,
        zIndex: 11000,
    },
    titleContainer: {
        width: '100%',
        paddingHorizontal: 16,
    },
    title: {
        color: '#ffffff',
    },
    closeContainer: {
        position: 'absolute',
        top: 8,
        right: 8,
    },
    closeButton: {
        alignItems: 'center',
        justifyContent: 'center',
    },
})
