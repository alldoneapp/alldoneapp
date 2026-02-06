import React, { useEffect, useRef, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import algoliasearch from 'algoliasearch'

import { colors } from '../../styles/global'
import {
    MENTION_MODAL_CONTACTS_TAB,
    MENTION_MODAL_GOALS_TAB,
    MENTION_MODAL_NOTES_TAB,
    MENTION_MODAL_TASKS_TAB,
    MENTION_MODAL_TOPICS_TAB,
} from './textInputHelper'
import {
    COMMENT_MODAL_ID,
    BOT_OPTION_MODAL_ID,
    exitsOpenModals,
    FOLLOW_UP_MODAL_ID,
    MANAGE_TASK_MODAL_ID,
    MENTION_MODAL_ID,
    removeModal,
    storeModal,
    TAGS_INTERACTION_MODAL_ID,
    TASK_DESCRIPTION_MODAL_ID,
    TASK_PARENT_GOAL_MODAL_ID,
    WORKFLOW_MODAL_ID,
} from '../../ModalsManager/modalsManager'
import CustomScrollView from '../../UIControls/CustomScrollView'
import { applyPopoverWidth, MODAL_MAX_HEIGHT_GAP } from '../../../utils/HelperFunctions'
import Backend from '../../../utils/BackendBridge'
import MentionsContactsGrouped from './MentionsModal/MentionsContactsGrouped'
import MentionsItemsGrouped from './MentionsModal/MentionsItemsGrouped'
import MentionsItems from './MentionsModal/MentionsItems'
import Header from './MentionsModal/Header'
import EmptyMatch from './MentionsModal/EmptyMatch'
import useWindowSize from '../../../utils/useWindowSize'
import NewObjectsInMentions from '../../NewObjectsInMentions/NewObjectsInMentions'
import { useDispatch, useSelector } from 'react-redux'
import {
    blockBackgroundTabShortcut,
    removeFromMentionModalStack,
    storeInMentionModalStack,
    unblockBackgroundTabShortcut,
} from '../../../redux/actions'
import {
    TASKS_INDEX_NAME_PREFIX,
    GOALS_INDEX_NAME_PREFIX,
    CHATS_INDEX_NAME_PREFIX,
    NOTES_INDEX_NAME_PREFIX,
    CONTACTS_INDEX_NAME_PREFIX,
} from '../../GlobalSearchAlgolia/searchHelper'
import { FEED_PUBLIC_FOR_ALL } from '../Utils/FeedsConstants'
import ProjectHelper from '../../SettingsView/ProjectsSettings/ProjectHelper'
import { GLOBAL_PROJECT_ID } from '../../AdminPanel/Assistants/assistantsHelper'
import useTextChange from './useTextChange'
import store from '../../../redux/store'
import { getPreConfigTasksForProject } from '../../../utils/backends/Assistants/assistantsFirestore'

export default function MentionsModal({
    mentionText,
    selectItemToMention,
    projectId,
    setMentionModalHeight,
    keepFocus,
    inMentionsEditionTag,
    insertNormalMention,
    contentLocation,
}) {
    const [width, height] = useWindowSize()
    const dispatch = useDispatch()
    const modalId = useRef(null)
    const mentionModalStack = useSelector(state => state.mentionModalStack)
    const itemsRef = useRef([])
    const [activeTab, setActiveTab] = useState(MENTION_MODAL_CONTACTS_TAB)
    const [itemsByTab, setItemsByTab] = useState({
        [MENTION_MODAL_TASKS_TAB]: [],
        [MENTION_MODAL_GOALS_TAB]: [],
        [MENTION_MODAL_NOTES_TAB]: [],
        [MENTION_MODAL_CONTACTS_TAB]: [],
        [MENTION_MODAL_TOPICS_TAB]: [],
    })
    const itemsComponentsRefs = useRef({})
    const scrollHeight = useRef(0)
    const scrollRef = useRef()
    const offsets = useRef({ top: 0, bottom: 0 })
    const newForm = useRef()
    const [showSpinner, setShowSpinner] = useState(true)
    const showNewForm = mentionModalStack[mentionModalStack.length - 1] === modalId.current
    const getInitValue = items => (items.length === 0 ? -1 : 0)
    const activeItemIndexRef = useRef(getInitValue(itemsRef.current))
    const [activeItemIndex, setActiveItemIndex] = useState(getInitValue(itemsRef.current))
    const tmpHeight = height - (contentLocation?.top || 0) - MODAL_MAX_HEIGHT_GAP
    const maxHeight = tmpHeight < 548 ? tmpHeight : 548
    const [algoliaClient, setAlgoliaClient] = useState(() => {
        const { ALGOLIA_APP_ID, ALGOLIA_SEARCH_ONLY_API_KEY } = Backend.getAlgoliaSearchOnlyKeys()
        const client = algoliasearch(ALGOLIA_APP_ID, ALGOLIA_SEARCH_ONLY_API_KEY)
        return client
    })
    const loggedUser = useSelector(state => state.loggedUser)

    const onKeyDown = event => {
        const { key } = event
        if (
            mentionModalStack[0] === modalId.current &&
            !exitsOpenModals([
                MENTION_MODAL_ID,
                COMMENT_MODAL_ID,
                BOT_OPTION_MODAL_ID,
                MANAGE_TASK_MODAL_ID,
                FOLLOW_UP_MODAL_ID,
                WORKFLOW_MODAL_ID,
                TASK_DESCRIPTION_MODAL_ID,
                TAGS_INTERACTION_MODAL_ID,
                TASK_PARENT_GOAL_MODAL_ID,
            ])
        ) {
            if (key === 'Enter') {
                const formIsOpen = showNewForm && newForm?.current?.isOpen()
                if (showNewForm && (activeItemIndexRef.current === -1 || formIsOpen)) {
                    event?.preventDefault?.()
                    event?.stopPropagation?.()
                    newForm?.current?.open()
                } else {
                    event?.preventDefault()
                    if (itemsRef.current[activeItemIndexRef.current]) {
                        selectItemToMention(itemsRef.current[activeItemIndexRef.current], activeTab, projectId)
                    } else if (insertNormalMention) {
                        insertNormalMention()
                    }
                }
            } else if (key === 'ArrowDown') {
                selectDown()
            } else if (key === 'ArrowUp') {
                selectUp()
            } else if (key === 'Escape') {
                if (!showNewForm || !newForm?.current?.isOpen()) {
                    event?.preventDefault?.()
                    event?.stopPropagation?.()
                    closeNewForm()
                    insertNormalMention()
                }
            } else if (key === 'Tab') {
                changeTabByKey()
            }
        }
    }

    const changeTabByKey = () => {
        if (activeTab === MENTION_MODAL_TOPICS_TAB) {
            changeTab(MENTION_MODAL_TASKS_TAB)
        } else {
            changeTab(activeTab + 1)
        }
    }

    const selectDown = () => {
        if (itemsRef.current.length >= 1) {
            const index = activeItemIndexRef.current
            closeNewForm()
            scrollToFocusItem(index === -1 ? index + 1 : index)
            if (index + 1 === itemsRef.current.length) {
                const newValue = showNewForm ? -1 : 0
                setActiveItemIndex(newValue)
                activeItemIndexRef.current = newValue
            } else {
                setActiveItemIndex(index + 1)
                activeItemIndexRef.current = index + 1
            }
        }
    }

    const selectUp = () => {
        if (itemsRef.current.length >= 1) {
            const index = activeItemIndexRef.current
            closeNewForm()
            scrollToFocusItem(index === -1 ? index + 1 : index, true)
            if (index - 1 === (showNewForm ? -2 : -1)) {
                setActiveItemIndex(itemsRef.current.length - 1)
                activeItemIndexRef.current = itemsRef.current.length - 1
            } else {
                setActiveItemIndex(index - 1)
                activeItemIndexRef.current = index - 1
            }
        }
    }

    const selectNewForm = () => {
        setActiveItemIndex(-1)
        activeItemIndexRef.current = -1
    }

    const closeNewForm = () => {
        if (showNewForm && activeItemIndexRef.current === -1) {
            newForm?.current?.close()
        }
    }

    const onLayoutContainer = data => {
        if (setMentionModalHeight) {
            setMentionModalHeight(data.nativeEvent.layout.height)
        }
    }

    const onLayout = data => {
        scrollRef.current.scrollTo({ y: 0, animated: false })
        offsets.current = { top: 0, bottom: data.nativeEvent.layout.height }
        scrollHeight.current = data.nativeEvent.layout.height
    }

    const scrollToFocusItem = (key, up = false) => {
        const item = itemsRef.current[key]
        if (!item) return

        const id = activeTab === MENTION_MODAL_CONTACTS_TAB ? item.uid : item.id

        if (up && key - 1 === (showNewForm ? -2 : -1)) {
            scrollRef?.current?.scrollTo({ y: itemsRef.current.length * 48, animated: false })
        } else if (!up && key + 1 === itemsRef.current.length) {
            scrollRef?.current?.scrollTo({ y: 0, animated: false })
        } else {
            const space = up ? 96 : 144
            const ref = itemsComponentsRefs.current[id]
            if (!ref?.measure) return

            ref.measure((fx, fy, width, height, px, py) => {
                if (up && fy - space < offsets.current.top) {
                    scrollRef?.current?.scrollTo({ y: fy - space, animated: false })
                } else if (up && fy > offsets.current.bottom) {
                    scrollRef?.current?.scrollTo({ y: fy + 48 - scrollHeight.current, animated: false })
                } else if (!up && fy + space > offsets.current.bottom) {
                    scrollRef?.current?.scrollTo({ y: fy + space - scrollHeight.current, animated: false })
                } else if (!up && fy + 48 < offsets.current.top) {
                    scrollRef?.current?.scrollTo({ y: fy + 48, animated: false })
                }
            })
        }
    }

    const changeTab = tab => {
        if (activeTab !== tab) {
            itemsComponentsRefs.current = {}
            activeItemIndexRef.current = -1
            setActiveTab(tab)
            itemsRef.current = itemsByTab[tab]
            setActiveItemIndex(-1)
            keepFocus()
            setShowSpinner(true)
        }
    }

    const getMentions = async indexPrefix => {
        const { parentTemplateId, userIds } = ProjectHelper.getProjectById(projectId)

        const isGuide = !!parentTemplateId
        const algoliaIndex = algoliaClient.initIndex(indexPrefix)

        let filters = ''

        if (indexPrefix === TASKS_INDEX_NAME_PREFIX) {
            filters = isGuide
                ? `projectId:${projectId} AND userId:${loggedUser.uid} AND (isPrivate:false OR isPublicFor:${loggedUser.uid})`
                : `projectId:${projectId} AND (isPrivate:false OR isPublicFor:${loggedUser.uid})`
        } else if (indexPrefix === NOTES_INDEX_NAME_PREFIX) {
            // Search notes across all projects the user has access to
            filters = `(isPrivate:false OR isPublicFor:${loggedUser.uid})`
        } else if (indexPrefix === GOALS_INDEX_NAME_PREFIX) {
            filters = isGuide
                ? `projectId:${projectId} AND ownerId:${loggedUser.uid} AND (isPublicFor:${FEED_PUBLIC_FOR_ALL} OR isPublicFor:${loggedUser.uid})`
                : `projectId:${projectId} AND (isPublicFor:${FEED_PUBLIC_FOR_ALL} OR isPublicFor:${loggedUser.uid})`
        } else if (indexPrefix === CONTACTS_INDEX_NAME_PREFIX) {
            // Search contacts across all projects the user has access to
            filters = `(isPrivate:false OR isPublicFor:${loggedUser.uid})`
        } else if (indexPrefix === CHATS_INDEX_NAME_PREFIX) {
            filters = `projectId:${projectId} AND (isPublicFor:${FEED_PUBLIC_FOR_ALL} OR isPublicFor:${loggedUser.uid})`
        }

        const results = await algoliaIndex.search(mentionText, { filters: filters })

        let items = results.hits

        if (indexPrefix === CONTACTS_INDEX_NAME_PREFIX) {
            // Filter out contacts from projects the user doesn't have access to
            const { loggedUserProjectsMap } = store.getState()
            items = items.filter(item => {
                // Keep assistants from GLOBAL_PROJECT_ID or from projects user has access to
                if (item.isAssistant) {
                    if (item.projectId === GLOBAL_PROJECT_ID) return true
                    if (loggedUserProjectsMap[item.projectId]) return true
                    return false
                }
                // Keep contacts from projects the user has access to
                return loggedUserProjectsMap[item.projectId]
            })

            // Sort: current project contacts first, then others
            items.sort((a, b) => {
                const aInCurrentProject = a.projectId === projectId
                const bInCurrentProject = b.projectId === projectId
                if (aInCurrentProject && !bInCurrentProject) return -1
                if (!aInCurrentProject && bInCurrentProject) return 1
                return 0
            })
        }

        if (indexPrefix === NOTES_INDEX_NAME_PREFIX) {
            // Filter out notes from projects the user doesn't have access to
            const { loggedUserProjectsMap } = store.getState()
            items = items.filter(item => loggedUserProjectsMap[item.projectId])

            // Sort: current project notes first, then others
            items.sort((a, b) => {
                const aInCurrentProject = a.projectId === projectId
                const bInCurrentProject = b.projectId === projectId
                if (aInCurrentProject && !bInCurrentProject) return -1
                if (!aInCurrentProject && bInCurrentProject) return 1
                return 0
            })
        }

        return items
    }

    const updateResults = async (algoliaIndexNamePrefix, searchTab) => {
        const items = await getMentions(algoliaIndexNamePrefix)

        setItemsByTab(state => {
            return { ...state, [searchTab]: items }
        })
        if (activeTab === searchTab) {
            itemsRef.current = items
            setActiveItemIndex(getInitValue(items))
            activeItemIndexRef.current = getInitValue(items)
        }

        setShowSpinner(false)
    }

    const updateTasksWithPreConfigTasks = async () => {
        // Fetch regular tasks from Algolia
        const regularTasks = await getMentions(TASKS_INDEX_NAME_PREFIX)

        // Fetch pre-configured tasks from Firestore
        let preConfigTasks = []
        try {
            preConfigTasks = await getPreConfigTasksForProject(projectId)

            // Filter pre-configured tasks based on search text
            if (mentionText) {
                const lowerSearch = mentionText.toLowerCase()
                preConfigTasks = preConfigTasks.filter(task => task.name?.toLowerCase().includes(lowerSearch))
            }
        } catch (error) {
            console.error('Error fetching pre-configured tasks:', error)
        }

        // Merge: pre-configured tasks first, then regular tasks
        const mergedItems = [...preConfigTasks, ...regularTasks]

        setItemsByTab(state => {
            return { ...state, [MENTION_MODAL_TASKS_TAB]: mergedItems }
        })
        if (activeTab === MENTION_MODAL_TASKS_TAB) {
            itemsRef.current = mergedItems
            setActiveItemIndex(getInitValue(mergedItems))
            activeItemIndexRef.current = getInitValue(mergedItems)
        }

        setShowSpinner(false)
    }

    const search = () => {
        updateResults(CONTACTS_INDEX_NAME_PREFIX, MENTION_MODAL_CONTACTS_TAB)
        updateTasksWithPreConfigTasks()
        updateResults(NOTES_INDEX_NAME_PREFIX, MENTION_MODAL_NOTES_TAB)
        updateResults(CHATS_INDEX_NAME_PREFIX, MENTION_MODAL_TOPICS_TAB)
        updateResults(GOALS_INDEX_NAME_PREFIX, MENTION_MODAL_GOALS_TAB)
    }

    useTextChange(mentionText, search, 700)

    useEffect(() => {
        document.addEventListener('keydown', onKeyDown)
        return () => {
            document.removeEventListener('keydown', onKeyDown)
        }
    }, [mentionModalStack, showNewForm, activeTab])

    useEffect(() => {
        const mentionModalId = Backend.getId()
        modalId.current = mentionModalId
        dispatch([storeInMentionModalStack(mentionModalId), blockBackgroundTabShortcut()])
        return () => dispatch([removeFromMentionModalStack(mentionModalId), unblockBackgroundTabShortcut()])
    }, [])

    useEffect(() => {
        storeModal(MENTION_MODAL_ID)
        return () => {
            setTimeout(() => {
                removeModal(MENTION_MODAL_ID)
            })
        }
    }, [])

    return (
        <View
            onLayout={onLayoutContainer}
            style={[localStyles.container, applyPopoverWidth(), { maxHeight: maxHeight }]}
        >
            {!inMentionsEditionTag && (
                <Header
                    activeTab={activeTab}
                    changeTab={changeTab}
                    showHints={mentionModalStack[0] === modalId.current}
                    tasksAmount={itemsByTab[MENTION_MODAL_TASKS_TAB].length}
                    goalsAmount={itemsByTab[MENTION_MODAL_GOALS_TAB].length}
                    notesAmount={itemsByTab[MENTION_MODAL_NOTES_TAB].length}
                    contactsAmount={itemsByTab[MENTION_MODAL_CONTACTS_TAB].length}
                    chatsAmount={itemsByTab[MENTION_MODAL_TOPICS_TAB].length}
                />
            )}

            <CustomScrollView
                ref={scrollRef}
                showsVerticalScrollIndicator={false}
                scrollOnLayout={onLayout}
                onScroll={({ nativeEvent }) => {
                    const y = nativeEvent.contentOffset.y
                    offsets.current = { top: y, bottom: y + scrollHeight.current }
                }}
                indicatorStyle={{ right: -6 }}
            >
                {showNewForm && (
                    <NewObjectsInMentions
                        key={`${activeTab}_${modalId.current}`}
                        ref={newForm}
                        projectId={projectId}
                        selectItemToMention={selectItemToMention}
                        activeTab={activeTab}
                        hover={activeItemIndex === -1}
                        selectNewForm={selectNewForm}
                        modalId={modalId.current}
                        mentionText={mentionText}
                    />
                )}

                {itemsByTab[activeTab].length > 0 ? (
                    <View>
                        {activeTab === MENTION_MODAL_CONTACTS_TAB ? (
                            <MentionsContactsGrouped
                                key={activeTab}
                                currentProjectId={projectId}
                                selectUserToMention={selectItemToMention}
                                contacts={itemsByTab[activeTab]}
                                activeUserIndex={activeItemIndex}
                                usersComponentsRefs={itemsComponentsRefs}
                            />
                        ) : activeTab === MENTION_MODAL_NOTES_TAB ? (
                            <MentionsItemsGrouped
                                key={activeTab}
                                currentProjectId={projectId}
                                selectItemToMention={selectItemToMention}
                                items={itemsByTab[activeTab]}
                                activeItemIndex={activeItemIndex}
                                itemsComponentsRefs={itemsComponentsRefs}
                                activeTab={activeTab}
                            />
                        ) : (
                            <MentionsItems
                                key={activeTab}
                                selectItemToMention={selectItemToMention}
                                items={itemsByTab[activeTab]}
                                activeItemIndex={activeItemIndex}
                                itemsComponentsRefs={itemsComponentsRefs}
                                projectId={projectId}
                                activeTab={activeTab}
                            />
                        )}
                    </View>
                ) : (
                    <EmptyMatch
                        showSpinner={showSpinner}
                        text="There are not results to show in this tab. Check other tabs to find more."
                    />
                )}
            </CustomScrollView>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        backgroundColor: colors.Secondary400,
        borderRadius: 4,
        shadowColor: 'rgba(78, 93, 120, 0.56)',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 1,
        shadowRadius: 16,
        elevation: 3,
        paddingHorizontal: 8,
        paddingTop: 8,
        paddingBottom: 16,
        maxHeight: 424,
    },
})
