import React, { useState, useEffect } from 'react'
import { StyleSheet, TouchableOpacity, View, Text } from 'react-native'
import { useSelector, useDispatch } from 'react-redux'
import moment from 'moment'

import styles, { colors } from '../styles/global'
import SocialText from '../UIControls/SocialText/SocialText'
import MilestoneStatistics from './MilestoneStatistics'
import TasksHelper from '../TaskListView/Utils/TasksHelper'
import MilestoneCapacityButton from './MilestoneCapacityButton'
import MilestoneCapacityView from './MilestoneCapacityView'
import {
    calculateAutomaticCapacity,
    checkIfAnyGoalsInMilestoneHasCapacity,
    getGoalsAndAssigneesId,
    getMilestoneAssigneeCapacityDays,
} from './GoalsHelper'
import MilestoneDoneDateTag from './MilestoneDoneDateTag'
import MilestoneMoreButton from '../UIComponents/FloatModals/MorePopupsOfObjectItems/Milestones/MilestoneMoreButton'
import { setActiveDragGoalMode } from '../../redux/actions'

export default function MilestonePresentation({
    onPress,
    milestone,
    projectId,
    goals,
    firstMilestoneId,
    previousMilestoneDate,
    isActiveMilestone,
    loggedUserCanUpdateObject,
    hideMoreButton,
}) {
    const dispatch = useDispatch()
    const usersInProject = useSelector(state => state.projectUsers[projectId])
    const loggedUser = useSelector(state => state.loggedUser)
    const [automaticCapacity, setAutomaticCapacity] = useState(0)
    const [milestoneCapacity, setMilestoneCapacity] = useState([])
    const [milestoneHasAssigneesWithCapacity, setMilestoneHasAssigneesWithCapacity] = useState(false)
    const [showCapacityView, setShowCapacityView] = useState(false)
    const [capacityButtonBackgroundColor, setCapacityButtonBackgroundColor] = useState('#09D693')
    const { extendedName, date: timestamp, assigneesCapacityDates, doneDate: doneDateTimestamp } = milestone
    const date = moment(timestamp)
    const doneDate = moment(doneDateTimestamp)
    const showVerticalEllipsis = TasksHelper.showWrappedTaskEllipsis(
        `social_tags_${projectId}_${milestone.id}`,
        `social_text_${projectId}_${milestone.id}`
    )

    const toggleShowCapacityView = () => {
        setShowCapacityView(showCapacityView => !showCapacityView)
    }

    const updateMilestoneAssignees = () => {
        const goalsByAssigneeId = getGoalsAndAssigneesId(goals, !milestone.done)
        const milestoneCapacity = []
        let milestoneHasAssigneesWithCapacity = false
        let atLeasteOneAssigneWith05OrLess = false
        let atLeasteOneAssigneWithLessThan0 = false

        usersInProject.forEach(assignee => {
            if (!milestone.done) {
                const milestoneAssigneeCapacityDays = getMilestoneAssigneeCapacityDays(
                    goalsByAssigneeId,
                    assigneesCapacityDates,
                    automaticCapacity,
                    assignee.uid
                )

                if (milestoneAssigneeCapacityDays < 0) {
                    atLeasteOneAssigneWithLessThan0 = true
                } else if (milestoneAssigneeCapacityDays <= 0.5) {
                    atLeasteOneAssigneWith05OrLess = true
                }

                if (checkIfAnyGoalsInMilestoneHasCapacity(goalsByAssigneeId, assignee.uid))
                    milestoneHasAssigneesWithCapacity = true
                milestoneCapacity.push(milestoneAssigneeCapacityDays)
            }
        })

        if (!milestone.done) {
            let capacityButtonBackgroundColor = '#09D693'
            if (atLeasteOneAssigneWithLessThan0) {
                capacityButtonBackgroundColor = colors.Red200
            } else if (atLeasteOneAssigneWith05OrLess) {
                capacityButtonBackgroundColor = colors.UtilityYellow200
            }

            setCapacityButtonBackgroundColor(capacityButtonBackgroundColor)
            setMilestoneHasAssigneesWithCapacity(milestoneHasAssigneesWithCapacity)
            setMilestoneCapacity(milestoneCapacity)
        }
    }

    useEffect(() => {
        updateMilestoneAssignees()
    }, [goals, automaticCapacity, milestone, projectId, usersInProject])

    useEffect(() => {
        if (!milestone.done) {
            setAutomaticCapacity(calculateAutomaticCapacity(timestamp))
            const intervale = setInterval(() => {
                setAutomaticCapacity(calculateAutomaticCapacity(timestamp))
            }, 60000)
            return () => {
                clearInterval(intervale)
            }
        }
    }, [milestone])

    useEffect(() => {
        return () => {
            dispatch(setActiveDragGoalMode(false))
        }
    }, [])

    return (
        <View
            style={[
                localStyles.container,
                { backgroundColor: milestone.hasStar.toLowerCase() === '#ffffff' ? colors.Grey100 : milestone.hasStar },
            ]}
        >
            <TouchableOpacity
                onPress={onPress}
                style={localStyles.containerHeader}
                disabled={loggedUser.isAnonymous || !loggedUserCanUpdateObject}
            >
                <View style={localStyles.content}>
                    <View style={localStyles.titleArea}>
                        <View
                            style={localStyles.descriptionContainer}
                            pointerEvents={!loggedUserCanUpdateObject ? 'none' : 'auto'}
                        >
                            <SocialText
                                elementId={`social_text_${projectId}_${milestone.id}`}
                                style={[styles.subtitle1, localStyles.descriptionText, { color: colors.Text02 }]}
                                numberOfLines={3}
                                wrapText={true}
                                projectId={projectId}
                                bgColor={'#ffffff'}
                                milestoneDate={date}
                                isActiveMilestone={isActiveMilestone}
                                milestone={milestone}
                            >
                                {extendedName}
                            </SocialText>
                        </View>
                        <View style={localStyles.dotsArea} nativeID={`social_tags_${projectId}_${milestone.id}`}>
                            {showVerticalEllipsis && (
                                <Text
                                    style={[
                                        styles.body1,
                                        {
                                            alignSelf: 'baseline',
                                            color: colors.Text01,
                                        },
                                    ]}
                                >
                                    ...
                                </Text>
                            )}
                        </View>
                    </View>
                    <View
                        style={
                            loggedUser.isAnonymous || !loggedUserCanUpdateObject
                                ? localStyles.tagsAreaAnonymous
                                : localStyles.tagsArea
                        }
                    >
                        {milestone.done && <MilestoneDoneDateTag date={doneDate} />}
                        {milestoneHasAssigneesWithCapacity && !milestone.done && (
                            <MilestoneCapacityButton
                                showCapacityView={showCapacityView}
                                toggleShowCapacityView={toggleShowCapacityView}
                                capacityButtonBackgroundColor={capacityButtonBackgroundColor}
                            />
                        )}
                    </View>
                </View>
                <MilestoneStatistics
                    projectId={projectId}
                    previousMilestoneTimestamp={previousMilestoneDate}
                    milestoneTimestamp={timestamp}
                    inDone={milestone.done}
                />
            </TouchableOpacity>

            {!hideMoreButton && !loggedUser.isAnonymous && loggedUserCanUpdateObject && (
                <View style={localStyles.moreButtonContainer}>
                    <MilestoneMoreButton
                        projectId={projectId}
                        milestone={milestone}
                        firstMilestoneId={firstMilestoneId}
                        goals={goals}
                    />
                </View>
            )}

            {milestoneHasAssigneesWithCapacity && showCapacityView && !milestone.done && (
                <MilestoneCapacityView
                    projectId={projectId}
                    automaticCapacity={automaticCapacity}
                    assigneesCapacityDates={assigneesCapacityDates}
                    milestoneId={milestone.id}
                    milestoneAssignees={usersInProject}
                    milestoneCapacity={milestoneCapacity}
                    disableTagsActions={loggedUser.isAnonymous || !loggedUserCanUpdateObject}
                />
            )}
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        backgroundColor: colors.Grey100,
        borderRadius: 4,
    },
    containerHeader: {
        minHeight: 64,
        paddingTop: 8,
        paddingBottom: 2,
    },
    content: {
        minHeight: 30,
        flexDirection: 'row',
        flex: 1,
        marginBottom: 2,
        justifyContent: 'space-between',
    },
    titleArea: {
        flexDirection: 'row',
        flex: 1,
    },
    tagsArea: {
        flexDirection: 'row',
        marginLeft: 8,
        marginRight: 32,
    },
    tagsAreaAnonymous: {
        flexDirection: 'row',
        marginLeft: 8,
    },
    dotsArea: {
        position: 'absolute',
        right: 8,
        bottom: 4,
        flexDirection: 'row',
        alignItems: 'center',
        marginLeft: 8,
    },
    descriptionText: {
        display: 'flex',
        alignItems: 'flex-start',
        maxHeight: 90,
    },
    descriptionContainer: {
        flexGrow: 1,
        flex: 1,
        marginLeft: 8,
    },
    moreButtonContainer: {
        position: 'absolute',
        right: 4,
        top: 4,
    },
})
