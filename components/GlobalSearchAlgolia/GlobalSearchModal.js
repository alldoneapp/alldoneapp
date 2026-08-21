import React, { useEffect, useRef, useState } from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import v4 from 'uuid/v4'
import { useDispatch, useSelector } from 'react-redux'

import styles, { colors, hexColorToRGBa } from '../styles/global'
import { translate } from '../../i18n/TranslationService'
import { MODAL_EDGE_GAP } from '../styles/modals'
import useModalSizing from '../../hooks/useModalSizing'
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
import {
    CHATS_INDEX_NAME_PREFIX,
    CONTACTS_INDEX_NAME_PREFIX,
    GOALS_INDEX_NAME_PREFIX,
    NOTES_INDEX_NAME_PREFIX,
    TASKS_INDEX_NAME_PREFIX,
} from './searchHelper'
import { buildTypesenseSearchFilters } from './typesenseSearchFilters'
import { multiSearchTypesense } from '../../utils/typesenseSearch'
import Backend from '../../utils/BackendBridge'
import { convertNoteObjectType, getInitialTab, goToObjectDetailView } from './searchFunctions'
import SearchFilterChips from './Filter/SearchFilterChips'
import Line from '../UIComponents/FloatModals/GoalMilestoneModal/Line'
import SelectProjectModalInSearch, {
    ALL_ARCHIVED_PROJECTS_OPTION,
    ALL_PROJECTS_OPTION,
} from '../UIComponents/FloatModals/SelectProjectModal/SelectProjectModalInSearch'
import { isProjectPickerSentinel } from '../UIComponents/FloatModals/SelectProjectModal/projectPickerConstants'
import { getAllUserProjects } from '../../utils/backends/firestore'
import ProjectHelper, { checkIfSelectedProject } from '../SettingsView/ProjectsSettings/ProjectHelper'
import { getDvMainTabLink } from '../../utils/LinkingHelper'
import { fixedModalOverlayStyle } from '../../utils/fixedModalPosition'
import BottomSheet from '../UIComponents/ModalShell/BottomSheet'
import { highResNow, shouldIgnorePressFromBeforeOpen } from '../../utils/popupDismissGuard'
import useEscapeKey from '../../hooks/useEscapeKey'
import useSafeAreaOverlayPadding from '../../hooks/useSafeAreaOverlayPadding'

// The `real*` id sets are written by `updateInactiveProjectsData` (redux/store.js)
// and are the unmasked truth; the plain sets next to them are trimmed by the
// sidebar's "archived mode". Fall back to the plain set only when the real one is
// genuinely absent (a partially-populated user: boot, anonymous, tests), never
// when it is merely empty.
const realIdSet = (realIds, maskedIds) => (Array.isArray(realIds) ? realIds : maskedIds || [])

export default function GlobalSearchModal() {
    const dispatch = useDispatch()

    const realArchivedProjectsAmount = useSelector(
        state => realIdSet(state.loggedUser.realArchivedProjectIds, state.loggedUser.archivedProjectIds).length
    )
    const searchText = useSelector(state => state.searchText)
    const mobile = useSelector(state => state.smallScreenNavigation)
    const [projects, setProjects] = useState([])
    const [showShortcuts, setShowShortcuts] = useState(false)
    const [activeTab, setActiveTab] = useState(getInitialTab)
    const [localText, setLocalText] = useState(searchText)
    const [searchOfflineNotice, setSearchOfflineNotice] = useState(false)
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
    // AT-2258 — "only objects I created". Deliberately component state and not
    // redux/user settings: the modal is unmounted while hidden, so the filter
    // resets to off every time Search is opened and the default search
    // behaviour is unchanged.
    const [createdByMeOnly, setCreatedByMeOnly] = useState(false)
    // Which bucket each project belongs to, from updateTemporaryProjectsAndUsers — the
    // per-user categorization (archived is per-user!) that scope filtering needs.
    const [projectBuckets, setProjectBuckets] = useState({
        activeIds: [],
        guideIds: [],
        templateIds: [],
        archivedIds: [],
    })
    const searchInstanceIdRef = useRef(v4())
    const modalRef = useRef(null)
    const searchInputRef = useRef(null)
    const activeItemRef = useRef(null)
    const scrollRef = useRef(null)
    const resultsContainerRef = useRef(null)
    // When this modal became visible, so a press the user made BEFORE it existed
    // cannot dismiss it (AT-2236) — see onBackdropPress below.
    const openedAtRef = useRef(highResNow())

    // Three scopes, not two (AT-2390): every active project, every archived
    // project, or one specific project. `inSelectedProject` keeps its old
    // meaning — "the scope is a single, concrete project" — because the result
    // grouping in applySearchHits branches on it, and an all-archived search
    // spans many projects exactly like an all-active one does.
    const isAllArchivedScope = selectedProject.id === ALL_ARCHIVED_PROJECTS_OPTION
    const inSelectedProject = selectedProject.id !== ALL_PROJECTS_OPTION && !isAllArchivedScope

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

    const updateTemporaryProjectsAndUsers = async () => {
        const { loggedUser, loggedUserProjects, selectedProjectIndex } = store.getState()
        const realGuideProjectIds = realIdSet(loggedUser.realGuideProjectIds, loggedUser.guideProjectIds)
        const realTemplateProjectIds = realIdSet(loggedUser.realTemplateProjectIds, loggedUser.templateProjectIds)
        const realArchivedProjectIds = realIdSet(loggedUser.realArchivedProjectIds, loggedUser.archivedProjectIds)
        const realProjectIds = realIdSet(loggedUser.realProjectIds, loggedUser.projectIds)

        dispatch(startLoadingData())
        const projectsList = await getAllUserProjects(loggedUser.uid)
        dispatch(stopLoadingData())

        // AT-2390: bucket against the REAL id sets, never the masked ones on
        // `loggedUser`. `updateInactiveProjectsData` (redux/store.js) empties
        // `archivedProjectIds` whenever `areArchivedActive` is false — which is
        // the default — so `getArchivedProjects2` returned [] for almost every
        // user. That is why the picker's Archived tab was empty: archived
        // projects never entered `projects` at all, and the tab filters that
        // same list by `realArchivedProjectIds`. The masked guide/template sets
        // are trimmed the same way for template owners, so they are read from
        // the real sets too rather than leaving the same bug in place one tab
        // over. Search scope is an explicit choice here; it must not silently
        // inherit the sidebar's "archived mode" switch.
        const archived = ProjectHelper.getArchivedProjectsInList(projectsList, realArchivedProjectIds)
        const guides = ProjectHelper.getGuideProjectsInList(projectsList, realGuideProjectIds)
        const templates = ProjectHelper.getTemplateProjectsInList(projectsList, realTemplateProjectIds)
        const activeProjects = ProjectHelper.getActiveProjectsInList(
            projectsList,
            realProjectIds,
            realArchivedProjectIds,
            realTemplateProjectIds,
            realGuideProjectIds
        )

        setProjectBuckets({
            activeIds: activeProjects.map(project => project.id),
            guideIds: guides.map(project => project.id),
            templateIds: templates.map(project => project.id),
            archivedIds: archived.map(project => project.id),
        })

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
        // The commit is closer to what the user can actually see than the first
        // render, and it is the earliest moment the backdrop can be pressed.
        openedAtRef.current = highResNow()
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
        if (key === 'Enter') {
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

    // Escape closes the popup (AT-2257). This cannot be a branch in the
    // `document` keydown listener above: the search field is autofocused and
    // re-focused on an interval, and react-native-web's TextInput stops
    // propagation of every keydown, so that listener never receives Escape while
    // the field has focus — which is always. The stack listens in the capture
    // phase instead, and being LIFO it also means the project picker opened from
    // the scope row closes itself first, leaving this popup open.
    useEscapeKey(hidePopup)

    // The backdrop covers the whole viewport — including the Search control that
    // opened this modal — from the first frame. A press the browser had already
    // queued while the main thread was busy (a still-loading notes list, a second
    // impatient tap) is delivered here right after the modal mounts and would
    // close it instantly. Such a press predates the modal and is never a dismiss.
    // Only the backdrop is guarded: the X button and Escape always close
    // immediately, so there is never a moment with no way out.
    const onBackdropPress = event => {
        if (shouldIgnorePressFromBeforeOpen(event, openedAtRef.current)) {
            event?.preventDefault?.()
            return
        }
        hidePopup(event)
    }

    // The projects the chosen scope resolves to. Every record EXISTS in the index
    // (Typesense indexes archived, template and guide projects too), so what is
    // searched is decided here and nowhere else — unlike the Algolia era, where
    // absence from the index did the filtering.
    //
    // AT-2390: the scope is the ONLY archived control now. "All projects" means
    // the active ones, exactly as it always did; archived projects are reached by
    // picking "All archived" or one of them by name. Template/guide projects are
    // never part of a group scope — picking one explicitly is the only way to
    // search them.
    const getProjectsInSearchScope = () => {
        if (inSelectedProject) return [selectedProject]
        const groupIds = isAllArchivedScope ? projectBuckets.archivedIds : projectBuckets.activeIds
        return projects.filter(project => groupIds.includes(project.id))
    }

    // Shared result processing for both engines: groups hits by project, applies the
    // guide-project visibility rules, and publishes the tab's results. Hits arrive in
    // the Algolia shape (the Typesense adapter reproduces it).
    const applySearchHits = (indexPrefix, hits, setResults, setResultsAmount, tab, searchInstanceId) => {
        const { loggedUser } = store.getState()

        if (searchInstanceId !== searchInstanceIdRef.current) return

        const objectsResult = {}
        for (let project of projects) {
            objectsResult[project.id] = []
        }

        let objectsResultAmount = hits.length

        if (inSelectedProject) {
            objectsResult[selectedProject.id] = hits
        } else {
            // Group results by project
            for (let i = 0; i < hits.length; i++) {
                const hit = hits[i]
                if (objectsResult[hit.projectId]) objectsResult[hit.projectId].push(hit)
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

    // All five tabs in ONE multi_search round-trip. An empty filter_by means "skip this
    // tab", never "search unscoped".
    const onSearchInTypesense = async searchInstanceId => {
        const { loggedUser } = store.getState()

        const tabsConfig = [
            {
                indexPrefix: TASKS_INDEX_NAME_PREFIX,
                setResults: setTasksResult,
                setResultsAmount: setTasksResultAmount,
                tab: MENTION_MODAL_TASKS_TAB,
            },
            {
                indexPrefix: GOALS_INDEX_NAME_PREFIX,
                setResults: setGoalsResult,
                setResultsAmount: setGoalsResultAmount,
                tab: MENTION_MODAL_GOALS_TAB,
            },
            {
                indexPrefix: NOTES_INDEX_NAME_PREFIX,
                setResults: setNotesResult,
                setResultsAmount: setNotesResultAmount,
                tab: MENTION_MODAL_NOTES_TAB,
            },
            {
                indexPrefix: CONTACTS_INDEX_NAME_PREFIX,
                setResults: setContactsResult,
                setResultsAmount: setContactsResultAmount,
                tab: MENTION_MODAL_CONTACTS_TAB,
            },
            {
                indexPrefix: CHATS_INDEX_NAME_PREFIX,
                setResults: setChatsResult,
                setResultsAmount: setChatsResultAmount,
                tab: MENTION_MODAL_TOPICS_TAB,
            },
        ]

        tabsConfig.forEach(({ setResults, setResultsAmount }) => {
            setResults({})
            setResultsAmount(0)
        })

        const projectsToSearch = getProjectsInSearchScope()

        const searchableTabs = []
        tabsConfig.forEach(config => {
            const filterBy = buildTypesenseSearchFilters({
                indexPrefix: config.indexPrefix,
                projects: projectsToSearch,
                loggedUser,
                createdByMeOnly,
            })
            if (filterBy) {
                searchableTabs.push({ ...config, filterBy })
            } else {
                setProcessing(processing => {
                    return { ...processing, [config.tab]: false }
                })
            }
        })
        if (searchableTabs.length === 0) return

        setSearchOfflineNotice(false)
        try {
            const results = await multiSearchTypesense(
                searchableTabs.map(({ indexPrefix, filterBy }) => ({
                    collection: indexPrefix,
                    query: localText,
                    filterBy,
                }))
            )
            searchableTabs.forEach((config, index) => {
                applySearchHits(
                    config.indexPrefix,
                    results[index].hits,
                    config.setResults,
                    config.setResultsAmount,
                    config.tab,
                    searchInstanceId
                )
            })
        } catch (error) {
            console.log('Typesense search failed:', error.message)
            // Offline fast-fail from multiSearchTypesense (Stage 7): say so
            // instead of silently showing zero results.
            setSearchOfflineNotice(error.code === 'offline')
            setProcessing({
                [MENTION_MODAL_CONTACTS_TAB]: false,
                [MENTION_MODAL_GOALS_TAB]: false,
                [MENTION_MODAL_NOTES_TAB]: false,
                [MENTION_MODAL_TASKS_TAB]: false,
                [MENTION_MODAL_TOPICS_TAB]: false,
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

            onSearchInTypesense(searchInstanceId)
        }
    }

    // Toggling "only objects I created" re-runs the current search immediately,
    // so the user sees the narrowed list without retyping. Skipped on mount:
    // the filter starts off and there is nothing searched yet.
    const createdByMeAppliedRef = useRef(createdByMeOnly)
    useEffect(() => {
        if (createdByMeAppliedRef.current === createdByMeOnly) return
        createdByMeAppliedRef.current = createdByMeOnly
        if (localText.trim() !== '') onSearch()
    }, [createdByMeOnly])

    // Same immediate re-run when the SCOPE changes. This used to watch the
    // archived chip, which was the only scope control that re-ran anything —
    // changing the picked project left the old results on screen until the user
    // pressed Search again. With the chip gone (AT-2390) the picker is the only
    // way to reach archived results, so it has to be the thing that re-runs.
    const scopeAppliedRef = useRef(selectedProject.id)
    useEffect(() => {
        if (scopeAppliedRef.current === selectedProject.id) return
        scopeAppliedRef.current = selectedProject.id
        if (localText.trim() !== '') onSearch()
    }, [selectedProject.id])

    // Desktop: a window-centered card at the L token width (round-3 centering
    // policy; the old marginLeft sidebar offset pushed it right of center).
    // Phones: the standard BottomSheet, same as every other popup — which
    // brings the scrim, drag handle, swipe/back-button dismissal, scroll lock
    // and keyboard riding along for free. The card height stays bounded (the
    // results list needs a definite height to scroll internally) but follows
    // the sheet's keyboard-aware maxHeight.
    const { isSheet: isPhone, width: cardWidth, maxHeight: sheetMaxHeight } = useModalSizing({ size: 'L' })
    // The overlay already pads MODAL_EDGE_GAP on every side; add the insets
    // on top so the centered card clears the status bar and home indicator.
    const safeAreaOverlayPadding = useSafeAreaOverlayPadding({
        top: MODAL_EDGE_GAP,
        bottom: MODAL_EDGE_GAP,
        left: MODAL_EDGE_GAP,
        right: MODAL_EDGE_GAP,
    })
    const width = isPhone ? '100%' : cardWidth
    const sheetCardStyle = isPhone
        ? {
              width: '100%',
              borderRadius: 0,
              boxShadow: 'none',
              backgroundColor: 'transparent',
              height: Math.min(512, sheetMaxHeight - 48),
          }
        : null

    const updateSelectedProject = projectId => {
        const project = isProjectPickerSentinel(projectId)
            ? { id: projectId }
            : projects.find(project => project.id === projectId)
        setSelectedProject(project)
    }

    const body = showSelectProjectModal ? (
        <SelectProjectModalInSearch
            projectId={selectedProject.id}
            closePopover={() => {
                setShowSelectProjectModal(false)
            }}
            projects={projects}
            setSelectedProjectId={updateSelectedProject}
            // AT-2390: the search scope has exactly two groups, Active and
            // Archived. The Community/Template tabs are gated off HERE rather
            // than removed from the shared picker, because the "Switch project"
            // and add-task pickers still need them.
            showGuideTab={false}
            showTemplateTab={false}
            showArchivedTab={realArchivedProjectsAmount > 0}
            showAllProjects={true}
            showAllArchivedProjects={true}
        />
    ) : (
        <View style={[localStyles.popup, { width: width }, sheetCardStyle]}>
            <View style={localStyles.titleContainer}>
                <Text style={[styles.title7, localStyles.title]}>Search</Text>
            </View>
            <SearchFilterChips
                selectedProject={selectedProject}
                onOpenScope={() => {
                    setShowSelectProjectModal(true)
                }}
                createdByMeOnly={createdByMeOnly}
                onToggleCreatedByMe={() => setCreatedByMeOnly(!createdByMeOnly)}
                disabled={projects.length === 0}
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
                disabledButton={projects.length === 0}
                onSubmitEditing={onSearch}
            />

            {searchOfflineNotice && (
                <Text style={[styles.body2, localStyles.offlineNotice]}>
                    {translate('Search needs an internet connection')}
                </Text>
            )}
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
            />

            <View style={localStyles.closeContainer}>
                <TouchableOpacity style={localStyles.closeButton} onPress={hidePopup}>
                    <Icon name={'x'} size={24} color={colors.Text03} />
                </TouchableOpacity>
            </View>
        </View>
    )

    // Phones: the standard bottom sheet, like every other popup. Its own
    // backdrop/Escape/back-button handling replaces the overlay below (the
    // AT-2236 mount grace is baked into the sheet's backdrop too).
    if (isPhone) {
        return (
            <BottomSheet isOpen={true} onRequestClose={hidePopup}>
                {body}
            </BottomSheet>
        )
    }

    return (
        <View style={[localStyles.container, safeAreaOverlayPadding]} ref={modalRef}>
            <TouchableOpacity style={localStyles.backdrop} onPress={onBackdropPress} />
            {body}
        </View>
    )
}

const localStyles = StyleSheet.create({
    offlineNotice: {
        color: colors.Text02,
        marginBottom: 12,
    },
    container: {
        ...fixedModalOverlayStyle,
        zIndex: 10000,
        backgroundColor: hexColorToRGBa(colors.Text03, 0.24),
        alignItems: 'center',
        // Mid-centered card with one edge gap on every side (the base overlay
        // style top-pins at 80px, which read as off-center on desktop).
        justifyContent: 'center',
        paddingTop: MODAL_EDGE_GAP,
        paddingBottom: MODAL_EDGE_GAP,
        paddingHorizontal: MODAL_EDGE_GAP,
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
        boxShadow: '0px 16px 24px rgba(0,0,0,0.04)',
        borderRadius: 4,
        alignItems: 'center',
        height: 512,
        maxHeight: '100%',
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
        // 44px touch target without moving the icon (same as FollowUp/CloseButton).
        padding: 10,
        margin: -10,
    },
})
