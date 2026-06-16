import React, { useState } from 'react'
import { StyleSheet, Text, TouchableOpacity } from 'react-native'
import { useDispatch, useSelector } from 'react-redux'
import Popover from 'react-tiny-popover'

import ProjectHelper from '../SettingsView/ProjectsSettings/ProjectHelper'
import styles, { colors } from '../styles/global'
import { translate } from '../../i18n/TranslationService'
import { hideFloatPopup, showFloatPopup } from '../../redux/actions'
import ScheduleModeModal from '../UIComponents/FloatModals/ScheduleModeModal/ScheduleModeModal'
import {
    GOAL_MILESTONES_MODE_LINEAR,
    GOAL_SCHEDULE_MODE_DYNAMIC,
    normalizeGoalMilestonesConfig,
    normalizeGoalScheduleMode,
} from '../../utils/GoalMilestonesHelper'

export default function GoalScheduleModeTag({ projectId, goal, style, disabled }) {
    const dispatch = useDispatch()
    const smallScreen = useSelector(state => state.smallScreen)
    const [visiblePopover, setVisiblePopover] = useState(false)

    const project = ProjectHelper.getProjectById(projectId)
    const config = normalizeGoalMilestonesConfig(project?.goalMilestonesConfig)
    if (config.mode !== GOAL_MILESTONES_MODE_LINEAR) return null

    const scheduleMode = normalizeGoalScheduleMode(goal.scheduleMode)
    const isDynamic = scheduleMode === GOAL_SCHEDULE_MODE_DYNAMIC

    const showPopover = () => {
        setVisiblePopover(true)
        dispatch(showFloatPopup())
    }

    const hidePopover = () => {
        setVisiblePopover(false)
        dispatch(hideFloatPopup())
    }

    return (
        <Popover
            content={<ScheduleModeModal projectId={projectId} goal={goal} closePopover={hidePopover} />}
            onClickOutside={hidePopover}
            isOpen={visiblePopover}
            position={['bottom', 'top', 'left', 'right']}
            padding={4}
            align={'start'}
            contentLocation={smallScreen ? null : undefined}
        >
            <TouchableOpacity
                style={[
                    localStyles.container,
                    isDynamic ? localStyles.dynamicContainer : localStyles.fixedContainer,
                    style,
                ]}
                onPress={showPopover}
                disabled={disabled}
            >
                <Text style={[localStyles.text, isDynamic ? localStyles.dynamicText : localStyles.fixedText]}>
                    {translate(isDynamic ? 'Dynamic' : 'Fixed')}
                </Text>
            </TouchableOpacity>
        </Popover>
    )
}

const localStyles = StyleSheet.create({
    container: {
        height: 24,
        borderRadius: 12,
        paddingHorizontal: 8,
        alignItems: 'center',
        justifyContent: 'center',
        marginLeft: 8,
    },
    dynamicContainer: {
        backgroundColor: colors.UtilityViolet100,
    },
    fixedContainer: {
        backgroundColor: colors.Grey300,
    },
    text: {
        ...styles.subtitle2,
    },
    dynamicText: {
        color: colors.UtilityViolet300,
    },
    fixedText: {
        color: colors.Text03,
    },
})
