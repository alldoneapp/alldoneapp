import React, { useEffect, useRef, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import algoliasearch from 'algoliasearch'
import { useDispatch, useSelector } from 'react-redux'
import v4 from 'uuid/v4'

import { colors } from '../../../styles/global'
import { MENTION_MODAL_GOALS_TAB } from '../../../Feeds/CommentsTextInput/textInputHelper'
import { TASK_PARENT_GOAL_MODAL_ID, removeModal, storeModal } from '../../../ModalsManager/modalsManager'
import CustomScrollView from '../../../UIControls/CustomScrollView'
import { applyPopoverWidth, MODAL_MAX_HEIGHT_GAP } from '../../../../utils/HelperFunctions'
import Backend from '../../../../utils/BackendBridge'
import MentionsItems from '../../../Feeds/CommentsTextInput/MentionsModal/MentionsItems'
import EmptyMatch from '../../../Feeds/CommentsTextInput/MentionsModal/EmptyMatch'
import useWindowSize from '../../../../utils/useWindowSize'
import NewObjectsInMentions from '../../../NewObjectsInMentions/NewObjectsInMentions'
import SearchForm from '../../../GlobalSearchAlgolia/Form/SearchForm'
import {
    storeInMentionModalStack,
    removeFromMentionModalStack,
    showFloatPopup,
    hideFloatPopup,
    setSelectedGoalDataInTasksListWhenAddTask,
    toggleDismissibleActive,
} from '../../../../redux/actions'
import ActiveGoal from './ActiveGoal'
import { GOALS_INDEX_NAME_PREFIX } from '../../../GlobalSearchAlgolia/searchHelper'
import ModalHeader from '../ModalHeader'
import { translate } from '../../../../i18n/TranslationService'
import TabsHeader, { CURRENT_MILESTONE, ALL_MILESTONES } from './TabsHeader'
import { BACKLOG_DATE_NUMERIC } from '../../../TaskListView/Utils/TasksHelper'
import { FEED_PUBLIC_FOR_ALL } from '../../../Feeds/Utils/FeedsConstants'
import { DYNAMIC_PERCENT, getOwnerId } from '../../../GoalsView/GoalsHelper'
import { ALL_GOALS_ID } from '../../../AllSections/allSectionHelper'

export default function TaskParentGoalModal({
    activeGoal,
    delalyPrivacyModalClose,
    setActiveGoal,
    notDelayClose,
    projectId,
    closeModal,
    ownerId,
    fromAddTaskSection,
    dateFormated,
}) {
    const dispatch = useDispatch()
    const loggedUserId = useSelector(state => state.loggedUser.uid)
    const currentUserId = useSelector(state => state.currentUser.uid)
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)
    const selectedGoalDataFromRedux = useSelector(state => state.selectedGoalDataInTasksListWhenAddTask)
    const selectedGoalFromRedux = selectedGoalDataFromRedux?.goal

    // When in fromAddTaskSection mode, use Redux state for activeGoal
    const effectiveActiveGoal = fromAddTaskSection ? selectedGoalFromRedux : activeGoal
    const [flag, setFlag] = useState(false)
    const [activeMilestoneDate, setActiveMilestoneDate] = useState(null)
    const [currentMilestoneGoals, setCurrentMilestoneGoals] = useState([])
    const [allMilestonesGoals, setAllMilestonesGoals] = useState([])

    const [endedFirstSearch, setEndedFirstSearch] = useState(false)
    const [activeTab, setActiveTab] = useState(CURRENT_MILESTONE)
    const [filterText, setFilterText] = useState('')
    const [algoliaClient, setAlgoliaClient] = useState(() => {
        const { ALGOLIA_APP_ID, ALGOLIA_SEARCH_ONLY_API_KEY } = Backend.getAlgoliaSearchOnlyKeys()
        const client = algoliasearch(ALGOLIA_APP_ID, ALGOLIA_SEARCH_ONLY_API_KEY)
        return client
    })

    const getIfGoalsAreInCurrentMilestone = goal => {
        const { startingMilestoneDate, completionMilestoneDate, progress, dynamicProgress } = goal
        return (
            completionMilestoneDate >= activeMilestoneDate &&
            startingMilestoneDate <= activeMilestoneDate &&
            (activeMilestoneDate !== BACKLOG_DATE_NUMERIC ||
                (progress !== 100 && (progress !== DYNAMIC_PERCENT || dynamicProgress !== 100)))
        )
    }

    const items = activeTab === CURRENT_MILESTONE ? currentMilestoneGoals : allMilestonesGoals
    const loadedActiveGoalAndMilestones = effectiveActiveGoal && activeMilestoneDate
    const isActiveGoalInCurrentMilestoneTab =
        loadedActiveGoalAndMilestones && getIfGoalsAreInCurrentMilestone(effectiveActiveGoal)
    const isActiveGoalInAllMilestonesTab =
        loadedActiveGoalAndMilestones && !getIfGoalsAreInCurrentMilestone(effectiveActiveGoal)
    const isActiveGoalInActiveTab =
        (activeTab === CURRENT_MILESTONE && isActiveGoalInCurrentMilestoneTab) ||
        (activeTab === ALL_MILESTONES && isActiveGoalInAllMilestonesTab)

    const ADD_GOALS_FORM_INDEX = isActiveGoalInActiveTab ? -2 : -1
    const ACTIVE_GOAL_ITEM_INDEX = -1

    const activedActiveGoalTab = useRef(false)
    const modalId = useRef(null)
    const itemsRef = useRef([])
    const goalsRef = useRef([])
    const itemsComponentsRefs = useRef({})
    const scrollHeight = useRef(0)
    const scrollRef = useRef()
    const offsets = useRef({ top: 0, bottom: 0 })
    const newForm = useRef(null)
    const activeItemIndexRef = useRef(ADD_GOALS_FORM_INDEX)
    const searchInputRef = useRef(null)
    const activeGoalRef = useRef(null)

    const [width, height] = useWindowSize()
    const tmpHeight = height - MODAL_MAX_HEIGHT_GAP
    const finalHeight = tmpHeight < 548 ? tmpHeight : 548

    const onKeyDown = event => {
        const { key } = event
        if (key === 'Enter') {
            event?.preventDefault?.()
            event?.stopPropagation?.()
            if (activeItemIndexRef.current === ADD_GOALS_FORM_INDEX) {
                const formIsOpen = newForm.current.isOpen()
                if (!formIsOpen) newForm.current.open()
            } else if (activeItemIndexRef.current === ACTIVE_GOAL_ITEM_INDEX) {
                selectGoal(null, activeTab, projectId, false)
            } else {
                selectGoal(itemsRef.current[activeItemIndexRef.current], activeTab, projectId, false)
            }
        } else if (key === 'ArrowDown') {
            event?.preventDefault?.()
            event?.stopPropagation?.()
            selectDown()
        } else if (key === 'ArrowUp') {
            event?.preventDefault?.()
            event?.stopPropagation?.()
            selectUp()
        } else if (key === 'Escape') {
            if (newForm.current.isOpen()) {
                event?.preventDefault?.()
                event?.stopPropagation?.()
                closeNewForm()
            }
        }
    }

    const scrollToFocusItem = currentIndex => {
        const textHeight = smallScreenNavigation ? 134 : 112
        const headerHeight = 64 + textHeight

        if (currentIndex === ADD_GOALS_FORM_INDEX) {
            if (offsets.current.top > headerHeight) scrollRef.current.scrollTo({ y: headerHeight, animated: false })
        } else if (currentIndex === ACTIVE_GOAL_ITEM_INDEX) {
            activeGoalRef.current.measure((fx, fy, width, height) => {
                if (offsets.current.top > headerHeight + fy) {
                    scrollRef.current.scrollTo({ y: headerHeight + fy + 40, animated: false })
                } else if (headerHeight + 40 + fy + height > offsets.current.bottom) {
                    const scrollArea = offsets.current.bottom - offsets.current.top
                    scrollRef.current.scrollTo({ y: headerHeight + 40 + fy + height - scrollArea, animated: false })
                }
            })
        } else {
            if (isActiveGoalInActiveTab) {
                activeGoalRef.current.measure((agFx, agFy, agWidth, agHeight) => {
                    const id = itemsRef.current[currentIndex].id
                    itemsComponentsRefs.current[id].measure((fx, fy, width, height) => {
                        if (offsets.current.top > headerHeight + agHeight + fy) {
                            scrollRef.current.scrollTo({ y: headerHeight + agHeight + fy + 40, animated: false })
                        } else if (headerHeight + agHeight + 40 + fy + height > offsets.current.bottom) {
                            const scrollArea = offsets.current.bottom - offsets.current.top
                            scrollRef.current.scrollTo({
                                y: headerHeight + agHeight + 40 + fy + height - scrollArea,
                                animated: false,
                            })
                        }
                    })
                })
            } else {
                const id = itemsRef.current[currentIndex].id
                itemsComponentsRefs.current[id].measure((fx, fy, width, height) => {
                    if (offsets.current.top > headerHeight + fy) {
                        scrollRef.current.scrollTo({ y: headerHeight + fy + 40, animated: false })
                    } else if (headerHeight + 40 + fy + height > offsets.current.bottom) {
                        const scrollArea = offsets.current.bottom - offsets.current.top
                        scrollRef.current.scrollTo({ y: headerHeight + 40 + fy + height - scrollArea, animated: false })
                    }
                })
            }
        }
    }

    const selectDown = () => {
        if (itemsRef.current.length >= 1) {
            const currentIndex = activeItemIndexRef.current
            closeNewForm()
            const nextIndex = currentIndex + 1
            activeItemIndexRef.current = nextIndex === itemsRef.current.length ? ADD_GOALS_FORM_INDEX : nextIndex
            scrollToFocusItem(activeItemIndexRef.current)
            setFlag(flag => !flag)
        }
    }

    const selectUp = () => {
        if (itemsRef.current.length >= 1) {
            const currentIndex = activeItemIndexRef.current
            closeNewForm()
            const nextIndex = currentIndex - 1
            activeItemIndexRef.current = currentIndex === ADD_GOALS_FORM_INDEX ? itemsRef.current.length - 1 : nextIndex
            scrollToFocusItem(activeItemIndexRef.current)
            setFlag(flag => !flag)
        }
    }

    const selectNewForm = () => {
        activeItemIndexRef.current = ADD_GOALS_FORM_INDEX
    }

    const closeNewForm = () => {
        if (activeItemIndexRef.current === ADD_GOALS_FORM_INDEX) {
            newForm.current.close()
        }
    }

    const onLayout = data => {
        scrollRef.current.scrollTo({ y: 0, animated: false })
        offsets.current = { top: 0, bottom: data.nativeEvent.layout.height }
        scrollHeight.current = data.nativeEvent.layout.height
    }

    const clearFilter = () => {
        setFilterText('')
    }

    const filterGoalsByCurrentMilestone = goals => {
        const currentMilestoneGoals = []
        const allMilestonesGoals = []
        goals.forEach(goal => {
            getIfGoalsAreInCurrentMilestone(goal) ? currentMilestoneGoals.push(goal) : allMilestonesGoals.push(goal)
        })

        itemsRef.current = activeTab === CURRENT_MILESTONE ? currentMilestoneGoals : allMilestonesGoals
        activeItemIndexRef.current = itemsRef.current.length === 0 ? ADD_GOALS_FORM_INDEX : 0
        setCurrentMilestoneGoals(currentMilestoneGoals)
        setAllMilestonesGoals(allMilestonesGoals)
    }

    const updateResults = async () => {
        const ownerUserId = getOwnerId(
            projectId,
            ownerId ? ownerId : currentUserId === ALL_GOALS_ID ? loggedUserId : currentUserId
        )
        const algoliaIndex = algoliaClient.initIndex(GOALS_INDEX_NAME_PREFIX)
        const filters = activeGoal
            ? `projectId:${projectId} AND NOT id:${activeGoal.id} AND ownerId:${ownerUserId} AND (isPublicFor:${FEED_PUBLIC_FOR_ALL} OR isPublicFor:${loggedUserId})`
            : `projectId:${projectId} AND ownerId:${ownerUserId} AND (isPublicFor:${FEED_PUBLIC_FOR_ALL} OR isPublicFor:${loggedUserId})`
        const results = await algoliaIndex.search(filterText, { filters })
        const hits = results.hits

        if (activeMilestoneDate) {
            filterGoalsByCurrentMilestone(hits)
        }
        goalsRef.current = hits
        setEndedFirstSearch(true)
        setFlag(flag => !flag)
    }

    useEffect(() => {
        closeNewForm()
        itemsRef.current = activeTab === CURRENT_MILESTONE ? currentMilestoneGoals : allMilestonesGoals
        activeItemIndexRef.current = itemsRef.current.length === 0 ? ADD_GOALS_FORM_INDEX : 0
        setFlag(flag => !flag)
    }, [activeTab])

    const dismissClickThroughEditModes = () => {
        // Dismiss any task edit modes that may have been triggered by click-through
        // Use setTimeout to ensure this runs after any accidental edit mode activation
        setTimeout(() => {
            dispatch(toggleDismissibleActive(false))
        }, 50)
    }

    const selectGoal = (goal, tabIndex, projectId, isNewGoal) => {
        dismissClickThroughEditModes()

        // Check if we're clicking on the same goal that's already selected
        // We need to check both the effective active goal and the prop active goal
        // to handle all different modal contexts
        const currentlySelectedGoal = effectiveActiveGoal || activeGoal
        if (currentlySelectedGoal && goal && currentlySelectedGoal.id === goal.id) {
            unselectGoal()
            return
        }

        if (fromAddTaskSection) {
            const goalData = { projectId, goal, dateFormated, isNewGoal }
            console.log('Dispatching setSelectedGoalDataInTasksListWhenAddTask with:', goalData)
            dispatch(setSelectedGoalDataInTasksListWhenAddTask(goalData))
            closeModal()
        } else if (notDelayClose) {
            setActiveGoal(goal)
            closeModal()
        } else {
            setTimeout(() => {
                setActiveGoal(goal)
                closeModal()
            })
        }
    }

    const unselectGoal = () => {
        dismissClickThroughEditModes()

        if (fromAddTaskSection) {
            dispatch(setSelectedGoalDataInTasksListWhenAddTask({ projectId, goal: null, dateFormated }))
        } else {
            setActiveGoal(null)
        }
        closeModal()
    }

    const updateActiveMilestone = milestone => {
        setActiveMilestoneDate(milestone ? milestone.date : BACKLOG_DATE_NUMERIC)
    }

    useEffect(() => {
        if (!activedActiveGoalTab.current && activeMilestoneDate && effectiveActiveGoal) {
            if (activeTab === CURRENT_MILESTONE) {
                if (isActiveGoalInAllMilestonesTab) setActiveTab(ALL_MILESTONES)
            } else {
                if (isActiveGoalInCurrentMilestoneTab) setActiveTab(CURRENT_MILESTONE)
            }
            activedActiveGoalTab.current = true
        }
    }, [activeMilestoneDate, effectiveActiveGoal])

    useEffect(() => {
        if (activeMilestoneDate) {
            filterGoalsByCurrentMilestone(goalsRef.current)
        }
    }, [activeMilestoneDate, goalsRef.current.length])

    useEffect(() => {
        const watcherKey = v4()
        const ownerUserId = getOwnerId(
            projectId,
            ownerId ? ownerId : currentUserId === ALL_GOALS_ID ? loggedUserId : currentUserId
        )
        Backend.watchActiveMilestone(projectId, watcherKey, updateActiveMilestone, ownerUserId)
        return () => {
            Backend.unwatch(watcherKey)
        }
    }, [])

    useEffect(() => {
        updateResults()
    }, [filterText])

    useEffect(() => {
        storeModal(TASK_PARENT_GOAL_MODAL_ID)
        return () => {
            removeModal(TASK_PARENT_GOAL_MODAL_ID)
        }
    }, [])

    useEffect(() => {
        const mentionModalId = Backend.getId()
        modalId.current = mentionModalId
        dispatch([showFloatPopup(), storeInMentionModalStack(mentionModalId)])
        return () => {
            dispatch([hideFloatPopup(), removeFromMentionModalStack(mentionModalId)])
        }
    }, [])

    useEffect(() => {
        document.addEventListener('keydown', onKeyDown, true)
        return () => {
            document.removeEventListener('keydown', onKeyDown, true)
        }
    })

    const stopPropagation = e => {
        e?.stopPropagation?.()
    }

    const claimResponder = () => true

    return (
        <View
            style={[localStyles.container, applyPopoverWidth(), { maxHeight: finalHeight }]}
            onClick={stopPropagation}
            onMouseDown={stopPropagation}
            onTouchStart={stopPropagation}
            onTouchEnd={stopPropagation}
            onStartShouldSetResponder={claimResponder}
            onMoveShouldSetResponder={claimResponder}
            onResponderTerminationRequest={() => false}
        >
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
                <ModalHeader
                    closeModal={closeModal}
                    title={translate('Choose the goal to link this task')}
                    description={translate('Choose the goal to link this task description')}
                    containerStyle={localStyles.header}
                    disabledEscape={newForm.current?.isOpen()}
                />

                <SearchForm
                    searchInputRef={searchInputRef}
                    onPressButton={clearFilter}
                    localText={filterText}
                    setLocalText={setFilterText}
                    containerStyle={localStyles.textFilter}
                    placeholder={`${translate('Filter')}...`}
                    buttonIcon="x"
                />
                <View style={{ paddingHorizontal: 8 }}>
                    <TabsHeader
                        setActiveTab={setActiveTab}
                        activeTab={activeTab}
                        currentMilestoneGoalsAmount={
                            isActiveGoalInCurrentMilestoneTab
                                ? currentMilestoneGoals.length + 1
                                : currentMilestoneGoals.length
                        }
                        allMilestonesGoalsAmount={
                            isActiveGoalInAllMilestonesTab ? allMilestonesGoals.length + 1 : allMilestonesGoals.length
                        }
                    />
                </View>
                <NewObjectsInMentions
                    ref={newForm}
                    projectId={projectId}
                    selectItemToMention={selectGoal}
                    activeTab={MENTION_MODAL_GOALS_TAB}
                    hover={activeItemIndexRef.current === ADD_GOALS_FORM_INDEX}
                    selectNewForm={selectNewForm}
                    modalId={modalId.current}
                    mentionText={filterText}
                    delalyPrivacyModalClose={delalyPrivacyModalClose}
                />
                {isActiveGoalInActiveTab && (
                    <ActiveGoal
                        unselectGoal={unselectGoal}
                        projectId={projectId}
                        activeGoal={effectiveActiveGoal}
                        activeGoalRef={activeGoalRef}
                        hover={activeItemIndexRef.current === ACTIVE_GOAL_ITEM_INDEX}
                    />
                )}
                {items.length > 0 ? (
                    <MentionsItems
                        selectItemToMention={selectGoal}
                        items={items}
                        activeItemIndex={activeItemIndexRef.current}
                        itemsComponentsRefs={itemsComponentsRefs}
                        projectId={projectId}
                        activeTab={MENTION_MODAL_GOALS_TAB}
                        currentlyAssignedGoal={effectiveActiveGoal}
                    />
                ) : (
                    <EmptyMatch
                        sppinerContainerStyle={localStyles.sppinerContainer}
                        showSpinner={!endedFirstSearch || !activeMilestoneDate}
                        text={translate('There are not results to show')}
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
    header: {
        marginHorizontal: 8,
        marginTop: 8,
    },
    sppinerContainer: {
        paddingBottom: 36.5,
    },
    textFilter: {
        paddingHorizontal: 8,
    },
})
