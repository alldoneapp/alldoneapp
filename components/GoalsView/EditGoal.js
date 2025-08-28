import React, { useState, useEffect } from 'react'
import { StyleSheet, View } from 'react-native'
import { cloneDeep, isEqual } from 'lodash'
import Hotkeys from 'react-hot-keys'
import { useSelector, useDispatch } from 'react-redux'

import Button from '../UIControls/Button'
import Icon from '../Icon'
import store from '../../redux/store'
import {
    setGoalInEditionMilestoneId,
    setTmpInputTextGoal,
    setActiveEditMode,
    unsetActiveEditMode,
    setSelectedNavItem,
} from '../../redux/actions'
import { colors } from '../styles/global'
import Backend from '../../utils/BackendBridge'
import CustomTextInput3 from '../Feeds/CommentsTextInput/CustomTextInput3'
import { GOAL_THEME } from '../Feeds/CommentsTextInput/textInputHelper'
import { CAPACITY_NONE, getNewDefaultGoal, getOwnerId } from './GoalsHelper'
import CancelButton from './EditGoalsComponents/CancelButton'
import DoneButton from './EditGoalsComponents/DoneButton'
import AssigneesWrapper from './EditGoalsComponents/AssigneesWrapper'
import DateRangeWrapper from './EditGoalsComponents/DateRangeWrapper'
import UnlockWrapper from './EditGoalsComponents/UnlockWrapper'
import NavigationService from '../../utils/NavigationService'
import { execShortcutFn } from '../UIComponents/ShortcutCheatSheet/HelperFunctions'
import CreateCommentWrapper from './EditGoalsComponents/CreateCommentWrapper'
import GoalMoreButton from '../UIComponents/FloatModals/MorePopupsOfEditModals/Goals/GoalMoreButton'
import { FEED_GOAL_OBJECT_TYPE } from '../Feeds/Utils/FeedsConstants'
import GoalProgressWrapper from './GoalProgressWrapper'
import ReminderWrapper from './EditGoalsComponents/ReminderWrapper'
import GoalCopyLinkButton from './EditGoalsComponents/GoalCopyLinkButton'
import CreateTaskButton from './EditGoalsComponents/CreateTaskButton'
import { translate } from '../../i18n/TranslationService'
import PrivacyButton from '../UIComponents/FloatModals/PrivacyModal/PrivacyButton'
import ProjectHelper from '../SettingsView/ProjectsSettings/ProjectHelper'
import { DV_TAB_GOAL_PROPERTIES } from '../../utils/TabNavigationConstants'
import { ALL_GOALS_ID } from '../AllSections/allSectionHelper'
import { objectIsLockedForUser } from '../Guides/guidesHelper'
import { updateNoteTitleWithoutFeed } from '../../utils/backends/Notes/notesFirestore'
import { updateChatTitleWithoutFeeds } from '../../utils/backends/Chats/chatsFirestore'
import GoalIndicator from '../TaskListView/GoalIndicator'

export default function EditGoal({
    projectId,
    adding,
    goal,
    milestoneDate,
    onCancelAction,
    milestoneId,
    style,
    inParentGoal,
    isEmptyGoal,
    parentGoaltasks,
    areObservedTask,
    inDoneMilestone,
    refKey,
    showingTasks,
    toggleTasksList,
}) {
    const dispatch = useDispatch()
    const smallScreen = useSelector(state => state.smallScreen)
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)
    const showFloatPopup = useSelector(state => state.showFloatPopup)
    const isMiddleScreen = useSelector(state => state.isMiddleScreen)
    const addTaskSectionToOpenData = useSelector(state => state.addTaskSectionToOpenData)
    const showGlobalSearchPopup = useSelector(state => state.showGlobalSearchPopup)
    const loggedUser = useSelector(state => state.loggedUser)
    const currentUserId = useSelector(state =>
        state.currentUser.uid === ALL_GOALS_ID ? loggedUser.uid : state.currentUser.uid
    )

    const [tmpGoal, setTmpGoal] = useState(() => {
        let tmpGoal
        if (adding) {
            tmpGoal = getNewDefaultGoal(milestoneDate)
            tmpGoal.ownerId = getOwnerId(projectId, tmpGoal.assigneesIds[0])
            tmpGoal.extendedName = store.getState().tmpInputTextGoal
        } else {
            tmpGoal = cloneDeep(goal)
        }
        return tmpGoal
    })

    const setName = extendedName => {
        setTmpGoal(tmpGoal => {
            return { ...tmpGoal, extendedName }
        })
        if (adding) dispatch(setTmpInputTextGoal(extendedName))
    }

    const actionDoneButton = () => {
        goalHasValidChanges() ? (adding ? createGoal({ ...tmpGoal }) : updateGoal({ ...tmpGoal })) : onCancelAction()
    }

    const goalHasValidChanges = () => {
        const cleanedName = tmpGoal.extendedName.trim()
        return adding ? cleanedName !== '' : cleanedName !== '' && cleanedName !== goal.extendedName.trim()
    }

    const createGoal = async newGoal => {
        setTimeout(() => {
            onCancelAction()
        })
        const goal = await Backend.uploadNewGoal(projectId, newGoal, milestoneDate, true, false)
        dispatch(setTmpInputTextGoal(''))

        return goal
    }

    const updateGoal = (updatedGoal, avoidFollow) => {
        Backend.updateGoal(projectId, goal, updatedGoal, avoidFollow)
        if (tmpGoal.extendedName !== goal.extendedName) {
            updateChatTitleWithoutFeeds(projectId, goal.id, tmpGoal.extendedName)
            if (goal.noteId) {
                updateNoteTitleWithoutFeed(projectId, goal.noteId, tmpGoal.extendedName)
            }
        }
        setTimeout(() => {
            onCancelAction()
        })
    }

    const updateCurrentChanges = () => {
        goalHasValidChanges() ? updateGoal({ ...tmpGoal }) : onCancelAction()
    }

    const updateProgress = (progress, addedComment) => {
        if (tmpGoal.progress !== progress) {
            updateGoal({ ...tmpGoal, progress })
        } else if (addedComment) {
            updateCurrentChanges()
        }
    }

    const updateReminder = date => {
        if (tmpGoal.assigneesReminderDate[currentUserId] !== date) {
            updateGoal({
                ...tmpGoal,
                assigneesReminderDate: { ...tmpGoal.assigneesReminderDate, [currentUserId]: date },
            })
        }
    }

    const updateDateRange = (date, rangeEdgePropertyName) => {
        if (tmpGoal[rangeEdgePropertyName] !== date) {
            const finalGoal = { ...tmpGoal, [rangeEdgePropertyName]: date }
            adding ? createGoal(finalGoal) : updateGoal(finalGoal)
        }
    }

    const updateAssignees = (assigneesIds, assigneesCapacity) => {
        if (adding) {
            if (
                !isEqual([currentUserId], assigneesIds) ||
                !isEqual({ [currentUserId]: CAPACITY_NONE }, assigneesCapacity)
            ) {
                createGoal({
                    ...tmpGoal,
                    assigneesIds,
                    assigneesCapacity,
                    ownerId: getOwnerId(projectId, assigneesIds[0]),
                })
            }
        } else {
            if (
                !isEqual(tmpGoal.assigneesIds, assigneesIds) ||
                !isEqual(tmpGoal.assigneesCapacity, assigneesCapacity)
            ) {
                updateGoal({
                    ...tmpGoal,
                    assigneesIds,
                    assigneesCapacity,
                    ownerId: getOwnerId(projectId, assigneesIds[0]),
                })
            }
        }
    }

    const updateDescription = description => {
        const cleanedDescription = description.trim()
        if (tmpGoal.description.trim() !== cleanedDescription) {
            const finalGoal = { ...tmpGoal, description: cleanedDescription }
            adding ? createGoal(finalGoal) : updateGoal(finalGoal)
        }
    }

    const updatePrivacy = (isPrivate, isPublicFor) => {
        if (!isEqual(tmpGoal.isPublicFor, isPublicFor)) {
            const finalGoal = { ...tmpGoal, isPublicFor }
            adding ? createGoal(finalGoal) : updateGoal(finalGoal)
        }
    }

    const updateHighlight = color => {
        if (tmpGoal.hasStar !== color) {
            const finalGoal = { ...tmpGoal, hasStar: color }
            adding ? createGoal(finalGoal) : updateGoal(finalGoal)
        }
    }

    const updateFollowState = () => {
        goalHasValidChanges() ? updateGoal({ ...tmpGoal }, true) : onCancelAction()
    }

    const openDV = async () => {
        const goalId = (adding ? await createGoal({ ...tmpGoal }) : goal).id
        if (!adding) onCancelAction()
        NavigationService.navigate('GoalDetailedView', {
            goalId,
            projectId,
        })
        store.dispatch(setSelectedNavItem(DV_TAB_GOAL_PROPERTIES))
    }

    const enterKeyAction = () => {
        if (showFloatPopup === 0) actionDoneButton()
    }

    const onKeyDown = event => {
        const { key } = event
        if (key === 'Enter') {
            enterKeyAction()
        }
    }

    useEffect(() => {
        document.addEventListener('keydown', onKeyDown)
        return () => {
            return document.removeEventListener('keydown', onKeyDown)
        }
    })

    useEffect(() => {
        if (milestoneId) {
            dispatch([setGoalInEditionMilestoneId(milestoneId), setActiveEditMode()])
            return () => {
                dispatch([setGoalInEditionMilestoneId(''), unsetActiveEditMode()])
            }
        }
    }, [])

    useEffect(() => {
        if (showGlobalSearchPopup) onCancelAction()
    }, [showGlobalSearchPopup])

    useEffect(() => {
        if (addTaskSectionToOpenData) onCancelAction(true)
    }, [addTaskSectionToOpenData])

    const buttonItemStyle = { marginHorizontal: smallScreen ? 4 : 2 }
    const editingAParentGoal = inParentGoal || isEmptyGoal
    const disableButtons = !tmpGoal.extendedName.trim()
    const hasChanges = goalHasValidChanges()
    const editing = !adding
    const progressToShow = inDoneMilestone ? tmpGoal.progressByDoneMilestone[milestoneId].progress : tmpGoal.progress

    const isGuide = !!ProjectHelper.getProjectById(projectId).parentTemplateId
    const loggedUserIsGoalOwner = tmpGoal.ownerId === loggedUser.uid
    const loggedUserCanUpdateObject =
        loggedUserIsGoalOwner || !ProjectHelper.checkIfLoggedUserIsNormalUserInGuide(projectId)

    const isLocked =
        !adding && objectIsLockedForUser(projectId, loggedUser.unlockedKeysByGuides, goal.lockKey, goal.ownerId)

    const showContractExoandIndicator =
        editing && (inParentGoal || isEmptyGoal) && (isMiddleScreen || smallScreenNavigation)

    return (
        <View
            style={[
                localStyles.container,
                smallScreenNavigation ? localStyles.containerUnderBreakpoint : undefined,
                style,
            ]}
        >
            <View style={adding ? localStyles.inputContainerAdding : localStyles.inputContainer}>
                {showContractExoandIndicator && (
                    <GoalIndicator
                        inEditMode={true}
                        toggleTasksList={() => {
                            toggleTasksList()
                            onCancelAction()
                        }}
                        showingTasks={showingTasks}
                        inside={true}
                    />
                )}
                {adding ? (
                    <Icon
                        style={[localStyles.icon, smallScreenNavigation && localStyles.iconMobile]}
                        name={'plus-square'}
                        size={24}
                        color={colors.Primary100}
                    />
                ) : (
                    <GoalProgressWrapper
                        inDoneMilestone={inDoneMilestone}
                        goal={tmpGoal}
                        progress={progressToShow}
                        projectId={projectId}
                        style={
                            smallScreenNavigation
                                ? { marginLeft: showContractExoandIndicator ? 32 : -8 }
                                : showContractExoandIndicator
                                ? { marginLeft: 32 }
                                : null
                        }
                        updateProgress={updateProgress}
                        disabled={isLocked || loggedUser.isAnonymous || !loggedUserCanUpdateObject}
                        dynamicProgress={tmpGoal.dynamicProgress}
                    />
                )}
                <CustomTextInput3
                    placeholder={translate(adding ? 'Type to add new goal' : 'Write the title of the goal')}
                    onChangeText={setName}
                    autoFocus={true}
                    projectId={projectId}
                    containerStyle={[localStyles.textInputContainer, adding && localStyles.textInputContainerAdding]}
                    initialTextExtended={tmpGoal.extendedName}
                    styleTheme={GOAL_THEME}
                    disabledEdition={isLocked || loggedUser.isAnonymous || !loggedUserCanUpdateObject}
                    forceTriggerEnterActionForBreakLines={enterKeyAction}
                />
            </View>
            <View style={localStyles.buttonContainer}>
                <View style={[localStyles.buttonSection]}>
                    {isLocked && !loggedUser.isAnonymous && (
                        <UnlockWrapper
                            projectId={projectId}
                            lockKey={goal.lockKey}
                            goalId={goal.id}
                            ownerId={goal.ownerId}
                        />
                    )}
                    {!isLocked && (
                        <View style={smallScreen ? undefined : { marginRight: 32 }}>
                            <Hotkeys
                                keyName={'alt+O'}
                                disabled={adding && !hasChanges}
                                onKeyDown={(sht, event) => execShortcutFn(this.openBtnRef, openDV, event)}
                                filter={e => true}
                            >
                                <Button
                                    ref={ref => (this.openBtnRef = ref)}
                                    title={smallScreen ? null : translate('Open nav')}
                                    type={'secondary'}
                                    noBorder={smallScreen}
                                    icon={'maximize-2'}
                                    buttonStyle={buttonItemStyle}
                                    onPress={openDV}
                                    disabled={adding && !hasChanges}
                                    shortcutText={'O'}
                                />
                            </Hotkeys>
                        </View>
                    )}

                    {!isLocked && !loggedUser.isAnonymous && (
                        <>
                            {editing && (
                                <CreateCommentWrapper
                                    updateCurrentChanges={updateCurrentChanges}
                                    projectId={projectId}
                                    goalId={tmpGoal.id}
                                    disabled={disableButtons}
                                    extendedName={tmpGoal.name}
                                    assistantId={tmpGoal.assistantId}
                                />
                            )}
                            {editing && inDoneMilestone && (
                                <GoalCopyLinkButton
                                    closeModal={onCancelAction}
                                    projectId={projectId}
                                    goalId={tmpGoal.id}
                                    disabled={disableButtons}
                                />
                            )}
                            {editing && !editingAParentGoal && loggedUserCanUpdateObject && (
                                <CreateTaskButton
                                    updateCurrentChanges={updateCurrentChanges}
                                    disabled={disableButtons}
                                    projectId={projectId}
                                    goalId={tmpGoal.id}
                                    isPublicFor={tmpGoal.isPublicFor}
                                />
                            )}

                            {editingAParentGoal && loggedUserCanUpdateObject && (
                                <ReminderWrapper
                                    projectId={projectId}
                                    extendedName={tmpGoal.extendedName}
                                    parentGoaltasks={parentGoaltasks}
                                    areObservedTask={areObservedTask}
                                    inParentGoal={inParentGoal}
                                    updateReminder={updateReminder}
                                    goal={tmpGoal}
                                    isEmptyGoal={isEmptyGoal}
                                />
                            )}
                            {adding && (
                                <DateRangeWrapper
                                    projectId={projectId}
                                    updateDateRange={updateDateRange}
                                    goal={tmpGoal}
                                    disabled={disableButtons}
                                />
                            )}
                            {!inDoneMilestone && loggedUserCanUpdateObject && (
                                <AssigneesWrapper
                                    goal={tmpGoal}
                                    updateAssignees={updateAssignees}
                                    projectId={projectId}
                                    disabled={disableButtons || isGuide}
                                />
                            )}
                            {adding && (
                                <PrivacyButton
                                    projectId={projectId}
                                    object={tmpGoal}
                                    objectType={FEED_GOAL_OBJECT_TYPE}
                                    disabled={disableButtons}
                                    savePrivacyBeforeSaveObject={updatePrivacy}
                                    inEditComponent={true}
                                    style={{ marginHorizontal: smallScreen ? 4 : 2 }}
                                    shortcutText={'P'}
                                />
                            )}

                            {loggedUserCanUpdateObject && (
                                <GoalMoreButton
                                    adding={adding}
                                    projectId={projectId}
                                    goal={tmpGoal}
                                    buttonStyle={buttonItemStyle}
                                    closeParent={onCancelAction}
                                    disabled={disableButtons}
                                    updateDescription={updateDescription}
                                    updatePrivacy={updatePrivacy}
                                    updateHighlight={updateHighlight}
                                    updateFollowState={updateFollowState}
                                    updateDateRange={updateDateRange}
                                    refKey={refKey}
                                    inDoneMilestone={inDoneMilestone}
                                />
                            )}
                        </>
                    )}
                </View>
                <View style={[localStyles.buttonSection, localStyles.buttonSectionRight]}>
                    <CancelButton onCancelAction={onCancelAction} />
                    <DoneButton
                        needUpdate={hasChanges}
                        adding={adding}
                        actionDoneButton={actionDoneButton}
                        disabled={loggedUser.isAnonymous}
                    />
                </View>
            </View>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#ffffff',
        borderWidth: 1,
        borderStyle: 'solid',
        borderColor: colors.Grey200,
        borderRadius: 4,
        shadowColor: 'rgba(0,0,0,0.08)',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 1,
        shadowRadius: 8,
        elevation: 3,
        marginLeft: -16,
        marginRight: -16,
        marginBottom: 16,
    },
    containerUnderBreakpoint: {
        marginLeft: -8,
        marginRight: -8,
    },
    buttonContainer: {
        flex: 1,
        flexDirection: 'row',
        backgroundColor: colors.Grey100,
        borderTopWidth: 1,
        borderStyle: 'solid',
        borderTopColor: colors.Gray300,
        paddingVertical: 7,
        paddingHorizontal: 9,
    },
    buttonSection: {
        flexDirection: 'row',
        flexGrow: 1,
    },
    buttonSectionRight: {
        justifyContent: 'flex-end',
    },
    inputContainerAdding: {
        paddingHorizontal: 16,
        overflow: 'hidden',
        flexDirection: 'row',
    },
    inputContainer: {
        paddingLeft: 19,
        paddingRight: 16,
        paddingTop: 3,
        overflow: 'hidden',
        flexDirection: 'row',
    },
    icon: {
        marginLeft: 3,
        marginTop: 7,
    },
    iconMobile: {
        marginLeft: -5,
    },
    textInputContainerAdding: {
        marginLeft: 12,
        marginTop: 2,
        minHeight: 57,
    },
    textInputContainer: {
        borderTopLeftRadius: 4,
        borderTopRightRadius: 4,
        minHeight: 44.5,
        marginTop: 3.5,
        marginBottom: 8,
        marginLeft: 7,
    },
})
