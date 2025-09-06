import React, { PureComponent } from 'react'
import { StyleSheet, TouchableOpacity, View, Animated } from 'react-native'
import Swipeable from 'react-native-gesture-handler/Swipeable'
import v4 from 'uuid/v4'
import moment from 'moment'

import styles, { colors } from '../styles/global'
import GoalProgressWrapper from './GoalProgressWrapper'
import SocialText from '../UIControls/SocialText/SocialText'
import GoalProgressBar from './GoalProgressBar'
import GoalDoneProgressBar from './GoalDoneProgressBar'
import GoalsSwipeBackground from './GoalsSwipeBackground'
import NavigationService from '../../utils/NavigationService'
import {
    hideFloatPopup,
    showFloatPopup,
    setGoalSwipeMilestoneModalOpen,
    showSwipeDueDatePopup,
    setSwipeDueDatePopupData,
    setSelectedNavItem,
} from '../../redux/actions'
import store from '../../redux/store'
import GoalSwipeDateRangeWrapper from './GoalSwipeDateRangeWrapper'
import Backend from '../../utils/BackendBridge'
import Icon from '../Icon'
import TaskSummarizeTags from '../Tags/TaskSummarizeTags'
import GoalItemTagsArea from './GoalItemTagsArea'
import { LINKED_OBJECT_TYPE_GOAL } from '../../utils/LinkingHelper'
import { BACKLOG_DATE_NUMERIC } from '../TaskListView/Utils/TasksHelper'
import { isEqual } from 'lodash'
import { FEED_PUBLIC_FOR_ALL } from '../Feeds/Utils/FeedsConstants'
import GoalItemAssigneesArea from './GoalItemAssigneesArea'
import { watchGoalLinkedOpenTasksAmount } from '../../utils/backends/firestore'
import ProjectHelper from '../SettingsView/ProjectsSettings/ProjectHelper'
import { PROJECT_COLOR_SYSTEM } from '../../Themes/Modern/ProjectColors'
import { DYNAMIC_PERCENT } from './GoalsHelper'
import { DV_TAB_GOAL_LINKED_TASKS } from '../../utils/TabNavigationConstants'
import { objectIsLockedForUser } from '../Guides/guidesHelper'

export default class GoalItemPresentation extends PureComponent {
    constructor(props) {
        super(props)
        const storeState = store.getState()
        this.timeouts = []
        this.state = {
            blockAction: false,
            panColor: new Animated.Value(0),
            openMilestoneModal: false,
            showTagsSummarizeArea: false,
            showTagsInNextLine: false,
            backlinksTasksCount: 0,
            backlinkTaskObject: null,
            backlinksNotesCount: 0,
            backlinkNoteObject: null,
            parentMilestonesData: { milestonesAmount: 1, milestonePosition: 1 },
            isAnonymous: storeState.loggedUser.isAnonymous,
            isMiddleScreen: storeState.isMiddleScreen,
            smallScreenNavigation: storeState.smallScreenNavigation,
            loggedUserId: storeState.loggedUser.uid,
            unlockedKeysByGuides: storeState.loggedUser.unlockedKeysByGuides,
            tasksAmount: 0,
        }
        this.itemSwipe = React.createRef()
        this.childrenTasksWatcherKey = v4()
        this.backlinksWatcherKey = v4()
    }

    setTasksAmount = tasksAmount => {
        this.setState({ tasksAmount })
    }

    componentDidMount() {
        this.unsubscribe = store.subscribe(this.updateState)
        const { projectId, goal, milestoneId, inParentGoal, isEmptyGoal } = this.props

        watchGoalLinkedOpenTasksAmount(projectId, goal.id, this.setTasksAmount, this.childrenTasksWatcherKey)

        Backend.watchBacklinksCount(
            projectId,
            {
                type: LINKED_OBJECT_TYPE_GOAL,
                idsField: 'linkedParentGoalsIds',
                id: goal.id,
            },
            (parentObjectType, parentsAmount, aloneParentObject) => {
                if (parentObjectType === 'tasks') {
                    this.setState({ backlinksTasksCount: parentsAmount, backlinkTaskObject: aloneParentObject })
                } else if (parentObjectType === 'notes') {
                    this.setState({ backlinksNotesCount: parentsAmount, backlinkNoteObject: aloneParentObject })
                }
            },
            this.backlinksWatcherKey
        )

        if (milestoneId && !inParentGoal && !isEmptyGoal) {
            const watcherKey = milestoneId + goal.id
            Backend.watchOpenMilestonesInDateRange(
                projectId,
                goal.startingMilestoneDate,
                goal.completionMilestoneDate,
                watcherKey,
                this.updateParentMilestonesData,
                goal.ownerId
            )
        }
    }

    componentDidUpdate(prevProps) {
        const { projectId, goal, milestoneId, inParentGoal, isEmptyGoal } = this.props
        const { extendedName, startingMilestoneDate, completionMilestoneDate, dateByDoneMilestone } = goal

        if (prevProps.goal.extendedName !== extendedName) {
            const timeoutId = setTimeout(() => {
                this.needRenderTagsInNextLine()
            })
            this.timeouts.push(timeoutId)
        }

        if (
            milestoneId &&
            !inParentGoal &&
            !isEmptyGoal &&
            (prevProps.goal.startingMilestoneDate !== startingMilestoneDate ||
                prevProps.goal.completionMilestoneDate !== completionMilestoneDate ||
                !isEqual(prevProps.goal.dateByDoneMilestone, dateByDoneMilestone))
        ) {
            const watcherKey = milestoneId + goal.id
            Backend.unwatch(watcherKey)
            Backend.watchOpenMilestonesInDateRange(
                projectId,
                startingMilestoneDate,
                completionMilestoneDate,
                watcherKey,
                this.updateParentMilestonesData,
                goal.ownerId
            )
        }
    }

    componentWillUnmount() {
        const { goal, milestoneId } = this.props
        const watcherKey = milestoneId + goal.id
        Backend.unwatch(watcherKey)
        Backend.unwatch(this.childrenTasksWatcherKey)
        Backend.unwatchBacklinksCount(goal.id, this.backlinksWatcherKey)
        this.unsubscribe()

        // Clear all timeouts to prevent state updates after unmount
        this.timeouts.forEach(timeoutId => clearTimeout(timeoutId))
        this.timeouts = []
    }

    updateState = () => {
        const storeState = store.getState()
        this.setState({
            isAnonymous: storeState.loggedUser.isAnonymous,
            isMiddleScreen: storeState.isMiddleScreen,
            smallScreenNavigation: storeState.smallScreenNavigation,
            unlockedKeysByGuides: storeState.loggedUser.unlockedKeysByGuides,
        })
    }

    updateParentMilestonesData = parentOpenMilestones => {
        const { goal, milestoneId } = this.props
        const { dateByDoneMilestone, completionMilestoneDate, parentDoneMilestoneIds, progress, dynamicProgress } = goal

        const inBacklog =
            completionMilestoneDate === BACKLOG_DATE_NUMERIC &&
            progress !== 100 &&
            (progress !== DYNAMIC_PERCENT || dynamicProgress !== 100)

        const milestonesAmount = parentOpenMilestones.length + (inBacklog ? 1 : 0) + parentDoneMilestoneIds.length

        let milestonePosition = milestonesAmount
        if (milestonesAmount > 1) {
            const doneMilestonesData = Object.entries(dateByDoneMilestone).map(entry => {
                return { id: entry[0], date: entry[1], done: true }
            })

            const openMilestonesData = parentOpenMilestones.map(milestone => {
                return { id: milestone.id, date: milestone.date, done: false }
            })

            const milestonesData = [...openMilestonesData, ...doneMilestonesData].sort((a, b) => {
                if (a.date === b.date) return a.done ? -1 : 1
                return a.date - b.date
            })

            for (let i = 0; i < milestonesData.length; i++) {
                const parentMilestone = milestonesData[i]
                if (parentMilestone.id === milestoneId) {
                    milestonePosition = i + 1
                    break
                }
            }
        }
        this.setState({ parentMilestonesData: { milestonesAmount, milestonePosition } })
    }

    closeMiletsoneModal = () => {
        this.setState({ openMilestoneModal: false })
        store.dispatch([hideFloatPopup(), setGoalSwipeMilestoneModalOpen(false)])
    }

    renderLeftSwipe = (progress, dragX) => {
        return <View style={{ width: 150 }} />
    }

    renderRightSwipe = (progress, dragX) => {
        return <View style={{ width: 150 }} />
    }

    onLeftSwipe = () => {
        const { projectId, goal } = this.props
        this.itemSwipe.current.close()
        NavigationService.navigate('GoalDetailedView', {
            goal,
            goalId: goal.id,
            projectId: projectId,
        })
        store.dispatch(setSelectedNavItem(DV_TAB_GOAL_LINKED_TASKS))
    }

    onRightSwipe = () => {
        this.itemSwipe.current.close()
        const timeoutId = setTimeout(() => {
            const { inParentGoal, isEmptyGoal, projectId, parentGoaltasks, goal, areObservedTask } = this.props
            const { currentUser } = store.getState()
            const isInTaskList = inParentGoal || isEmptyGoal
            if (isInTaskList) {
                const firstTask = isEmptyGoal
                    ? { dueDate: goal.assigneesReminderDate[currentUser.uid] }
                    : parentGoaltasks[0]

                store.dispatch([
                    showSwipeDueDatePopup(),
                    setSwipeDueDatePopupData({
                        projectId,
                        task: firstTask,
                        parentGoaltasks: isEmptyGoal ? [] : parentGoaltasks,
                        inParentGoal,
                        multipleTasks: !isEmptyGoal,
                        isEmptyGoal,
                        goal: goal,
                        isObservedTask: areObservedTask,
                    }),
                ])
            } else {
                this.setState({ openMilestoneModal: true })
                store.dispatch([showFloatPopup(), setGoalSwipeMilestoneModalOpen(true)])
            }
        })
        this.timeouts.push(timeoutId)
    }

    getTagsAmount = () => {
        const { currentUser } = store.getState()
        const { parentMilestonesData, tasksAmount } = this.state
        const { goal, inParentGoal, isEmptyGoal } = this.props
        const { inDoneMilestone, assigneesIds, description, isPublicFor, noteId } = goal

        const { backlinksCount } = this.getBacklinkData()

        const isInTaskList = inParentGoal || isEmptyGoal
        const milestoneDate =
            isInTaskList &&
            (goal.completionMilestoneDate === BACKLOG_DATE_NUMERIC ? 'Someday' : moment(goal.completionMilestoneDate))

        const reminderDate = moment(goal.assigneesReminderDate[currentUser.uid])
        const reminderDateIsToday = reminderDate.isSame(moment(), 'day')
        const showReminderDateTag = isInTaskList && !reminderDateIsToday

        let tagsAmount = 0

        if (showReminderDateTag) {
            tagsAmount++
        }

        if (milestoneDate) {
            tagsAmount++
        }

        if (tasksAmount > 0) {
            tagsAmount++
        }

        if (parentMilestonesData.milestonesAmount > 1) {
            tagsAmount++
        }

        if (noteId) {
            tagsAmount++
        }

        if (backlinksCount) {
            tagsAmount++
        }

        if (description) {
            tagsAmount++
        }

        if (goal.commentsData) {
            tagsAmount++
        }

        if (!inDoneMilestone) {
            tagsAmount += assigneesIds.length
        }

        if (inDoneMilestone && assigneesIds.length > 0) {
            tagsAmount++
        }

        if (!isPublicFor.includes(FEED_PUBLIC_FOR_ALL)) {
            tagsAmount++
        }

        return tagsAmount
    }

    toogleShowTagsSummarizeArea = () => {
        this.setState(state => {
            return { showTagsSummarizeArea: !state.showTagsSummarizeArea }
        })
    }

    needRenderTagsInNextLine = () => {
        const { showSummarizeTag } = this.getTagsData()
        if (showSummarizeTag) {
            this.setState({ showTagsInNextLine: false })
        } else {
            const { projectId, goal } = this.props

            const initialTag = document.getElementById(`initial_social_tag_${projectId}_${goal.id}`)
            const initialTagPos = initialTag?.getBoundingClientRect()
            const tags = document.getElementById(`social_tags_${projectId}_${goal.id}`)
            const tagsPos = tags?.getBoundingClientRect()
            const element = document.getElementById(`social_text_${projectId}_${goal.id}`)
            const elemPos = element?.getBoundingClientRect()
            const container = document.getElementById(`goal_container_${projectId}_${goal.id}`)
            const containerPos = container?.getBoundingClientRect()

            if (elemPos && containerPos && tagsPos && initialTagPos) {
                const lastLineWidth = elemPos.x - containerPos.x
                const tagsWidth = tagsPos.x + tagsPos.width - initialTagPos.x

                if (containerPos.width < lastLineWidth + tagsWidth || elemPos.bottom - containerPos.top > 80) {
                    this.setState({ showTagsInNextLine: true })
                } else {
                    this.setState({ showTagsInNextLine: false })
                }
            } else {
                this.setState({ showTagsInNextLine: false })
            }
        }
    }

    onLayoutContainers = () => {
        this.needRenderTagsInNextLine()
    }

    getTagsData = () => {
        const { goal } = this.props
        const { assigneesIds } = goal
        const { isMiddleScreen, smallScreenNavigation } = this.state
        const tagsAmount = this.getTagsAmount()
        const showSummarizeTag =
            (isMiddleScreen && tagsAmount - assigneesIds.length > 3) ||
            (smallScreenNavigation && tagsAmount - assigneesIds.length > 2)
        return { tagsAmount, showSummarizeTag }
    }

    getBacklinkData = () => {
        const { backlinksTasksCount, backlinkTaskObject, backlinksNotesCount, backlinkNoteObject } = this.state
        const backlinksCount = backlinksTasksCount + backlinksNotesCount
        const backlinkObject =
            backlinksCount === 1 ? (backlinksTasksCount === 1 ? backlinkTaskObject : backlinkNoteObject) : null
        return { backlinksCount, backlinkObject }
    }

    render() {
        const {
            blockAction,
            panColor,
            openMilestoneModal,
            showTagsSummarizeArea,
            showTagsInNextLine,
            isAnonymous,
            parentMilestonesData,
            tasksAmount,
            loggedUserId,
            unlockedKeysByGuides,
        } = this.state
        const {
            onPress,
            goal,
            projectId,
            activeDragGoalMode,
            isActiveOrganizeModeInTasks,
            inParentGoal,
            isEmptyGoal,
            inDoneMilestone,
            milestoneId,
            parentGoaltasks,
            areObservedTask,
        } = this.props
        const {
            extendedName,
            assigneesIds,
            progress,
            progressByDoneMilestone,
            assigneesCapacity,
            startingMilestoneDate,
            completionMilestoneDate,
            dynamicProgress,
        } = goal

        const isHighlight = goal.hasStar !== '#FFFFFF'
        const projectColor = ProjectHelper.getProjectColorById(projectId)
        const highLightColor = isHighlight ? goal.hasStar : PROJECT_COLOR_SYSTEM[projectColor].PROJECT_ITEM_ACTIVE

        const outputColors = [colors.UtilityYellow125, '#ffffff', colors.UtilityGreen125]
        const backColor = panColor.interpolate({
            inputRange: [-100, 0, 100],
            outputRange: outputColors,
            extrapolate: 'clamp',
        })
        const borderColor = panColor.interpolate({
            inputRange: [-100, 0, 100],
            outputRange: [colors.UtilityYellow125, highLightColor, colors.UtilityGreen125],
            extrapolate: 'clamp',
        })

        const { backlinksCount, backlinkObject } = this.getBacklinkData()

        const { tagsAmount, showSummarizeTag } = this.getTagsData()
        const isInTaskList = inParentGoal || isEmptyGoal

        const progressToShow =
            inDoneMilestone && progressByDoneMilestone[milestoneId].progress >= 0
                ? progressByDoneMilestone[milestoneId].progress
                : progress

        const loggedUserIsGoalOwner = goal.ownerId === loggedUserId
        const loggedUserCanUpdateObject =
            loggedUserIsGoalOwner || !ProjectHelper.checkIfLoggedUserIsNormalUserInGuide(projectId)

        const isLocked = objectIsLockedForUser(projectId, unlockedKeysByGuides, goal.lockKey, goal.ownerId)
        const amountTags = tagsAmount - assigneesIds.length

        return (
            <View style={localStyles.globalContainer}>
                <View style={localStyles.container}>
                    <GoalsSwipeBackground needToShowReminderButton={isInTaskList} />
                    <Swipeable
                        ref={this.itemSwipe}
                        rightThreshold={80}
                        leftThreshold={80}
                        enabled={!isLocked && !activeDragGoalMode && !isActiveOrganizeModeInTasks}
                        renderLeftActions={this.renderLeftSwipe}
                        renderRightActions={
                            !isAnonymous && loggedUserCanUpdateObject ? this.renderRightSwipe : undefined
                        }
                        onSwipeableLeftWillOpen={this.onLeftSwipe}
                        onSwipeableRightWillOpen={!isAnonymous && this.onRightSwipe}
                        overshootLeft={false}
                        overshootRight={false}
                        friction={2}
                        containerStyle={{ overflow: 'visible' }}
                        failOffsetY={[-5, 5]}
                        onSwipeableWillClose={() => {
                            this.setState({ blockAction: true })
                        }}
                        onSwipeableClose={() => {
                            this.setState({ blockAction: false })
                        }}
                    >
                        <Animated.View
                            onLayout={this.onLayoutContainers}
                            nativeID={`goal_container_${projectId}_${goal.id}`}
                            style={[
                                localStyles.border,
                                { backgroundColor: backColor },
                                activeDragGoalMode && { paddingRight: 28 },
                            ]}
                        >
                            <Animated.View
                                style={[
                                    localStyles.borderInside,
                                    { backgroundColor: backColor, borderColor: borderColor },
                                    isHighlight && localStyles.highlightBorder,
                                ]}
                            />
                        </Animated.View>
                        {inDoneMilestone ? (
                            <GoalDoneProgressBar
                                progressByDoneMilestone={progressByDoneMilestone}
                                milestoneId={milestoneId}
                                barColor={highLightColor}
                            />
                        ) : (
                            <GoalProgressBar
                                progress={progress}
                                barColor={highLightColor}
                                dynamicProgress={dynamicProgress}
                            />
                        )}

                        <View
                            style={localStyles.internalContainer}
                            pointerEvents={
                                isLocked || activeDragGoalMode || isActiveOrganizeModeInTasks ? 'none' : 'auto'
                            }
                        >
                            <GoalProgressWrapper
                                goal={goal}
                                progress={progressToShow}
                                projectId={projectId}
                                disabled={blockAction || isAnonymous || !loggedUserCanUpdateObject}
                                inDoneMilestone={inDoneMilestone}
                                dynamicProgress={dynamicProgress}
                            />
                            <TouchableOpacity
                                onPress={!blockAction ? onPress : undefined}
                                style={localStyles.content}
                                disabled={blockAction}
                            >
                                <View
                                    style={localStyles.descriptionContainer}
                                    pointerEvents={!loggedUserCanUpdateObject && !isLocked ? 'none' : 'auto'}
                                >
                                    <SocialText
                                        elementId={`social_text_${projectId}_${goal.id}`}
                                        style={[
                                            styles.body1,
                                            localStyles.descriptionText,
                                            { color: colors.Text01 },
                                            activeDragGoalMode && { paddingRight: 28 },
                                        ]}
                                        normalStyle={{ whiteSpace: 'normal' }}
                                        numberOfLines={3}
                                        wrapText={true}
                                        projectId={projectId}
                                        bgColor={'#ffffff'}
                                    >
                                        {extendedName}
                                    </SocialText>
                                </View>
                            </TouchableOpacity>
                            <View style={[localStyles.tagsArea, activeDragGoalMode && { paddingRight: 28 }]}>
                                {showSummarizeTag ? (
                                    <>
                                        {amountTags > 0 && (
                                            <TaskSummarizeTags
                                                amountTags={amountTags}
                                                onPress={this.toogleShowTagsSummarizeArea}
                                            />
                                        )}
                                        <View
                                            style={{
                                                alignItems: 'center',
                                                justifyContent: 'center',
                                                flexDirection: 'row',
                                            }}
                                        >
                                            <GoalItemAssigneesArea
                                                projectId={projectId}
                                                goal={goal}
                                                assigneesIds={assigneesIds}
                                                assigneesCapacity={assigneesCapacity}
                                                disableTagsActions={isAnonymous || !loggedUserCanUpdateObject}
                                                inDoneMilestone={inDoneMilestone}
                                            />
                                        </View>
                                    </>
                                ) : (
                                    <GoalItemTagsArea
                                        projectId={projectId}
                                        goal={goal}
                                        assigneesIds={assigneesIds}
                                        assigneesCapacity={assigneesCapacity}
                                        commentsData={goal.commentsData}
                                        onLayoutTagsContainer={this.onLayoutContainers}
                                        containerStyle={
                                            showTagsInNextLine
                                                ? activeDragGoalMode
                                                    ? [localStyles.tagsInNewLine, localStyles.tagsInNewLineWhenOrganize]
                                                    : localStyles.tagsInNewLine
                                                : null
                                        }
                                        disableTagsActions={isAnonymous}
                                        backlinksCount={backlinksCount}
                                        backlinkObject={backlinkObject}
                                        parentMilestonesData={parentMilestonesData}
                                        inDoneMilestone={inDoneMilestone}
                                        showAssignees={true}
                                        tasksAmount={tasksAmount}
                                        isEmptyGoal={isEmptyGoal}
                                        parentGoaltasks={parentGoaltasks}
                                        areObservedTask={areObservedTask}
                                        inParentGoal={inParentGoal}
                                        loggedUserCanUpdateObject={loggedUserCanUpdateObject}
                                    />
                                )}
                            </View>
                        </View>
                        {tagsAmount > 0 && !showSummarizeTag && showTagsInNextLine && (
                            <View style={{ height: 32, zIndex: -1 }} />
                        )}
                        {showSummarizeTag && showTagsSummarizeArea && (
                            <GoalItemTagsArea
                                projectId={projectId}
                                goal={goal}
                                assigneesIds={assigneesIds}
                                assigneesCapacity={assigneesCapacity}
                                commentsData={goal.commentsData}
                                containerStyle={localStyles.summrizeTagsArea}
                                tagStyle={localStyles.summrizeTag}
                                onLayoutTagsContainer={this.onLayoutContainers}
                                disableTagsActions={isAnonymous}
                                backlinksCount={backlinksCount}
                                backlinkObject={backlinkObject}
                                parentMilestonesData={parentMilestonesData}
                                inDoneMilestone={inDoneMilestone}
                                showAssignees={false}
                                tasksAmount={tasksAmount}
                                isEmptyGoal={isEmptyGoal}
                                parentGoaltasks={parentGoaltasks}
                                areObservedTask={areObservedTask}
                                inParentGoal={inParentGoal}
                                loggedUserCanUpdateObject={loggedUserCanUpdateObject}
                            />
                        )}
                    </Swipeable>
                    <GoalSwipeDateRangeWrapper
                        goal={goal}
                        projectId={projectId}
                        closeMiletsoneModal={this.closeMiletsoneModal}
                        startingMilestoneDate={startingMilestoneDate}
                        completionMilestoneDate={completionMilestoneDate}
                        openMilestoneModal={openMilestoneModal}
                    />
                </View>
                {activeDragGoalMode && (
                    <View style={localStyles.sixDots}>
                        <Icon name="six-dots-vertical" size={24} color={colors.Text03} />
                    </View>
                )}
            </View>
        )
    }
}

const localStyles = StyleSheet.create({
    globalContainer: {
        paddingVertical: 4,
    },
    container: {
        minHeight: 40,
    },
    descriptionContainer: {
        paddingVertical: 1,
        flexGrow: 1,
        flex: 1,
    },
    descriptionText: {
        display: 'flex',
        alignItems: 'flex-start',
        maxHeight: 90,
        marginLeft: 7,
    },
    internalContainer: {
        minHeight: 40,
        paddingLeft: 4,
        paddingRight: 8,
        flexDirection: 'row',
        flex: 1,
    },
    content: {
        minHeight: 40,
        flexDirection: 'row',
        paddingVertical: 4,
        flex: 1,
    },
    name: {
        ...styles.subtitle1,
        color: colors.Text01,
    },
    tagsArea: {
        position: 'absolute',
        right: 8,
        bottom: 8,
        flexDirection: 'row',
        alignItems: 'center',
        marginLeft: 8,
    },
    highlightBorder: {
        borderWidth: 2,
    },
    border: {
        position: 'absolute',
        left: 0,
        top: 0,
        minHeight: 40,
        width: '100%',
        height: '100%',
    },
    borderInside: {
        height: '100%',
        minHeight: 40,
        borderRadius: 4,
        borderColor: colors.Grey300,
        borderWidth: 1,
    },
    sixDots: {
        position: 'absolute',
        right: 0,
        top: 12,
    },
    summrizeTagsArea: {
        flexWrap: 'wrap',
        justifyContent: 'flex-end',
        marginRight: 8,
    },
    summrizeTag: {
        marginBottom: 8,
    },
    tagsInNewLine: {
        position: 'absolute',
        justifyContent: 'flex-end',
        top: 8,
        right: 0,
    },
    tagsInNewLineWhenOrganize: {
        right: 28,
    },
})
