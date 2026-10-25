import React, { useEffect, useState } from 'react'
import { Dimensions, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import AppPopover from '../UIComponents/ModalShell/AppPopover'
import { useSelector } from 'react-redux'
import v4 from 'uuid/v4'

import styles, { colors } from '../styles/global'
import Icon from '../Icon'
import Button from '../UIControls/Button'
import SocialText from '../UIControls/SocialText/SocialText'
import PopupDismissSurface from '../UIComponents/PopupDismissSurface'
import TaskParentGoalModal from '../UIComponents/FloatModals/TaskParentGoalModal/TaskParentGoalModal'
import { translate } from '../../i18n/TranslationService'
import { shrinkTagText } from '../../functions/Utils/parseTextUtils'
import { unwatch } from '../../utils/backends/firestore'
import { watchGoal } from '../../utils/backends/Goals/goalsFirestore'
import {
    acceptTaskGoalSuggestion,
    dismissTaskGoalSuggestion,
    setTaskParentGoal,
    setTaskProjectWithGoal,
} from '../../utils/backends/Tasks/tasksFirestore'
import ProjectHelper from '../SettingsView/ProjectsSettings/ProjectHelper'
import { getSuggestedGoalPopoverLayout } from './suggestedGoalPopoverHelper'

export default function SuggestedGoalTag({ projectId, task, containerStyle, disabled, propertyButton = false }) {
    const smallScreen = useSelector(state => state.smallScreenNavigation)
    const [goal, setGoal] = useState(null)
    const [open, setOpen] = useState(false)
    const [choosingAnother, setChoosingAnother] = useState(false)
    const [windowWidth, setWindowWidth] = useState(Dimensions.get('window').width)
    const goalId = task.goalSuggestion?.goalId

    useEffect(() => {
        if (!goalId) return
        const watcherKey = v4()
        watchGoal(projectId, goalId, watcherKey, setGoal)
        return () => unwatch(watcherKey)
    }, [goalId, projectId])

    useEffect(() => {
        const updateWindowWidth = ({ window }) => setWindowWidth(window.width)
        Dimensions.addEventListener('change', updateWindowWidth)
        return () => Dimensions.removeEventListener('change', updateWindowWidth)
    }, [])

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
    const popoverLayout = getSuggestedGoalPopoverLayout(windowWidth)
    const popupContent = choosingAnother ? (
        <TaskParentGoalModal
            activeGoal={null}
            setActiveGoal={chooseGoal}
            projectId={projectId}
            closeModal={close}
            ownerId={task.userId}
        />
    ) : (
        <View
            testID="suggested-goal-popover"
            style={[
                localStyles.popover,
                { width: popoverLayout.width },
                popoverLayout.stackActions && localStyles.compactPopover,
            ]}
        >
            <View style={localStyles.heading}>
                <View style={localStyles.iconContainer}>
                    <Icon name="target" size={18} color={colors.UtilityGreen300} />
                </View>
                <View style={localStyles.headingText}>
                    <Text style={localStyles.eyebrow}>{translate('Suggested goal')}</Text>
                    <SocialText
                        style={localStyles.goalName}
                        normalStyle={localStyles.goalNameText}
                        numberOfLines={4}
                        wrapText={true}
                        projectId={projectId}
                    >
                        {goalName}
                    </SocialText>
                </View>
            </View>
            {!!task.goalSuggestion?.reason && (
                <View style={localStyles.reasonContainer}>
                    <Text style={localStyles.reason} numberOfLines={5} ellipsizeMode="tail">
                        {task.goalSuggestion.reason}
                    </Text>
                </View>
            )}
            <Button
                title={translate('Add to goal')}
                icon="target"
                onPress={accept}
                disabled={!goal || disabled}
                buttonStyle={localStyles.primaryButton}
            />
            <View
                style={[
                    localStyles.secondaryActions,
                    popoverLayout.stackActions && localStyles.stackedSecondaryActions,
                ]}
            >
                <Button
                    title={translate('Choose another')}
                    type="text"
                    onPress={() => setChoosingAnother(true)}
                    disabled={disabled}
                    titleStyle={localStyles.secondaryButtonText}
                    buttonStyle={[
                        localStyles.secondaryButton,
                        popoverLayout.stackActions
                            ? localStyles.stackedSecondaryButtonFirst
                            : localStyles.secondaryButtonFirst,
                    ]}
                />
                <Button
                    title={translate('Not relevant')}
                    type="text"
                    onPress={dismiss}
                    disabled={disabled}
                    buttonStyle={localStyles.secondaryButton}
                    titleStyle={localStyles.secondaryButtonText}
                />
            </View>
        </View>
    )
    const content = <PopupDismissSurface onDismiss={close}>{popupContent}</PopupDismissSurface>

    return (
        <AppPopover
            content={content}
            isOpen={open}
            position={['bottom', 'left', 'right', 'top']}
            padding={4}
            align="end"
            onClickOutside={Platform.OS === 'web' ? undefined : close}
            contentLocation={smallScreen ? null : undefined}
        >
            <TouchableOpacity
                testID="suggested-goal-trigger"
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
        </AppPopover>
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
        padding: 20,
        borderRadius: 4,
        backgroundColor: colors.Secondary400,
        boxShadow: '0px 4px 16px rgba(78,93,120,0.56)',
        elevation: 3,
    },
    compactPopover: {
        padding: 16,
    },
    heading: {
        flexDirection: 'row',
        alignItems: 'flex-start',
    },
    iconContainer: {
        width: 32,
        height: 32,
        borderRadius: 16,
        backgroundColor: colors.UtilityGreen100,
        alignItems: 'center',
        justifyContent: 'center',
    },
    headingText: {
        flex: 1,
        minWidth: 0,
        marginLeft: 12,
    },
    eyebrow: {
        ...styles.caption1,
        color: colors.Text04,
    },
    goalName: {
        ...styles.subtitle1,
        ...Platform.select({ web: { wordBreak: 'break-word' }, default: {} }),
        color: '#FFFFFF',
        marginTop: 4,
        flexShrink: 1,
    },
    goalNameText: {
        color: '#FFFFFF',
        whiteSpace: 'normal',
    },
    reasonContainer: {
        marginTop: 16,
        padding: 12,
        borderRadius: 4,
        backgroundColor: colors.Secondary300,
    },
    reason: {
        ...styles.body2,
        ...Platform.select({ web: { wordBreak: 'break-word' }, default: {} }),
        color: colors.Text04,
        flexShrink: 1,
    },
    primaryButton: {
        alignSelf: 'stretch',
        width: '100%',
        marginTop: 16,
    },
    secondaryActions: {
        flexDirection: 'row',
        alignItems: 'stretch',
        marginTop: 8,
    },
    stackedSecondaryActions: {
        flexDirection: 'column',
    },
    secondaryButton: {
        flex: 1,
        alignSelf: 'stretch',
    },
    secondaryButtonFirst: {
        marginRight: 8,
    },
    stackedSecondaryButtonFirst: {
        marginBottom: 4,
    },
    secondaryButtonText: {
        color: colors.UtilityBlue125,
    },
})
