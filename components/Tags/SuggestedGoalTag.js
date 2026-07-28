import React, { useEffect, useState } from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import Popover from 'react-tiny-popover'
import { useSelector } from 'react-redux'
import v4 from 'uuid/v4'

import styles, { colors } from '../styles/global'
import Icon from '../Icon'
import Button from '../UIControls/Button'
import TaskParentGoalModal from '../UIComponents/FloatModals/TaskParentGoalModal/TaskParentGoalModal'
import { translate } from '../../i18n/TranslationService'
import { shrinkTagText } from '../../functions/Utils/parseTextUtils'
import { applyPopoverWidth } from '../../utils/HelperFunctions'
import { unwatch } from '../../utils/backends/firestore'
import { watchGoal } from '../../utils/backends/Goals/goalsFirestore'
import {
    acceptTaskGoalSuggestion,
    dismissTaskGoalSuggestion,
    setTaskParentGoal,
    setTaskProjectWithGoal,
} from '../../utils/backends/Tasks/tasksFirestore'
import ProjectHelper from '../SettingsView/ProjectsSettings/ProjectHelper'

export default function SuggestedGoalTag({ projectId, task, containerStyle, disabled, propertyButton = false }) {
    const smallScreen = useSelector(state => state.smallScreenNavigation)
    const [goal, setGoal] = useState(null)
    const [open, setOpen] = useState(false)
    const [choosingAnother, setChoosingAnother] = useState(false)
    const goalId = task.goalSuggestion?.goalId

    useEffect(() => {
        if (!goalId) return
        const watcherKey = v4()
        watchGoal(projectId, goalId, watcherKey, setGoal)
        return () => unwatch(watcherKey)
    }, [goalId, projectId])

    const close = () => {
        setOpen(false)
        setChoosingAnother(false)
    }

    const accept = async () => {
        if (!goal) return
        close()
        await acceptTaskGoalSuggestion(projectId, task, goal)
    }

    const dismiss = async () => {
        close()
        await dismissTaskGoalSuggestion(projectId, task)
    }

    const chooseGoal = async (selectedGoal, goalProjectId) => {
        if (!selectedGoal) return
        const effectiveProjectId = goalProjectId || selectedGoal.projectId || projectId
        close()

        if (effectiveProjectId !== projectId) {
            const currentProject = ProjectHelper.getProjectById(projectId)
            const newProject = ProjectHelper.getProjectById(effectiveProjectId)
            if (currentProject && newProject) {
                await setTaskProjectWithGoal(currentProject, newProject, task, selectedGoal)
            }
        } else {
            await setTaskParentGoal(projectId, task.id, task, selectedGoal)
        }
    }

    const goalName = goal?.extendedName || goal?.name || translate('Loading')
    const content = choosingAnother ? (
        <TaskParentGoalModal
            activeGoal={null}
            setActiveGoal={chooseGoal}
            projectId={projectId}
            closeModal={close}
            ownerId={task.userId}
        />
    ) : (
        <View style={[localStyles.popover, applyPopoverWidth()]}>
            <View style={localStyles.heading}>
                <Icon name="target" size={20} color={colors.UtilityGreen300} />
                <View style={localStyles.headingText}>
                    <Text style={localStyles.eyebrow}>{translate('Suggested goal')}</Text>
                    <Text style={localStyles.goalName}>{goalName}</Text>
                </View>
            </View>
            {!!task.goalSuggestion?.reason && <Text style={localStyles.reason}>{task.goalSuggestion.reason}</Text>}
            <Button
                title={translate('Add to goal')}
                icon="target"
                onPress={accept}
                disabled={!goal || disabled}
                buttonStyle={localStyles.primaryButton}
            />
            <View style={localStyles.secondaryActions}>
                <Button
                    title={translate('Choose another')}
                    type="text"
                    onPress={() => setChoosingAnother(true)}
                    disabled={disabled}
                    buttonStyle={localStyles.secondaryButton}
                />
                <Button
                    title={translate('Not relevant')}
                    type="text"
                    onPress={dismiss}
                    disabled={disabled}
                    buttonStyle={localStyles.secondaryButton}
                />
            </View>
        </View>
    )

    return (
        <Popover
            content={content}
            isOpen={open}
            position={['bottom', 'left', 'right', 'top']}
            padding={4}
            align="end"
            onClickOutside={close}
            contentLocation={smallScreen ? null : undefined}
        >
            <TouchableOpacity
                disabled={disabled}
                onPress={() => setOpen(true)}
                style={[propertyButton ? localStyles.propertyButton : localStyles.tag, containerStyle]}
            >
                <Icon name="target" size={propertyButton ? 18 : 14} color={colors.UtilityGreen300} />
                <Text style={propertyButton ? localStyles.propertyText : localStyles.tagText}>
                    {propertyButton
                        ? shrinkTagText(goalName, 13)
                        : `${translate('Suggested')}: ${shrinkTagText(goalName, 8)}`}
                </Text>
            </TouchableOpacity>
        </Popover>
    )
}

const localStyles = StyleSheet.create({
    tag: {
        height: 24,
        paddingHorizontal: 8,
        borderRadius: 12,
        borderWidth: 1,
        borderStyle: 'dashed',
        borderColor: colors.UtilityGreen300,
        backgroundColor: colors.UtilityGreen100,
        flexDirection: 'row',
        alignItems: 'center',
    },
    tagText: {
        ...styles.subtitle2,
        color: colors.UtilityGreen300,
        marginLeft: 4,
    },
    propertyButton: {
        minHeight: 40,
        paddingHorizontal: 12,
        borderRadius: 4,
        borderWidth: 1,
        borderStyle: 'dashed',
        borderColor: colors.UtilityGreen300,
        backgroundColor: colors.UtilityGreen100,
        flexDirection: 'row',
        alignItems: 'center',
    },
    propertyText: {
        ...styles.subtitle2,
        color: colors.UtilityGreen300,
        marginLeft: 8,
    },
    popover: {
        width: 320,
        padding: 16,
        borderRadius: 4,
        backgroundColor: colors.Secondary400,
        shadowColor: '#000000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.2,
        shadowRadius: 8,
    },
    heading: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    headingText: {
        flex: 1,
        marginLeft: 8,
    },
    eyebrow: {
        ...styles.caption1,
        color: colors.Text03,
    },
    goalName: {
        ...styles.subtitle1,
        color: colors.Text01,
        marginTop: 2,
    },
    reason: {
        ...styles.body2,
        color: colors.Text02,
        marginTop: 12,
        marginBottom: 12,
    },
    primaryButton: {
        marginTop: 12,
    },
    secondaryActions: {
        flexDirection: 'row',
        marginTop: 4,
    },
    secondaryButton: {
        marginRight: 8,
    },
})
