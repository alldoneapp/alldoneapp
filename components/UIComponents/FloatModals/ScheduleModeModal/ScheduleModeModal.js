import React, { useEffect } from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { useSelector } from 'react-redux'
import Hotkeys from 'react-hot-keys'

import styles, { colors } from '../../../styles/global'
import { applyPopoverWidth } from '../../../../utils/HelperFunctions'
import { translate } from '../../../../i18n/TranslationService'
import ModalHeader from '../ModalHeader'
import Line from '../GoalMilestoneModal/Line'
import Shortcut, { SHORTCUT_LIGHT } from '../../../UIControls/Shortcut'
import Icon from '../../../Icon'
import Backend from '../../../../utils/BackendBridge'
import { GOAL_SCHEDULE_MODE_MODAL_ID, removeModal, storeModal } from '../../../ModalsManager/modalsManager'
import {
    GOAL_SCHEDULE_MODE_DYNAMIC,
    GOAL_SCHEDULE_MODE_FIXED,
    normalizeGoalScheduleMode,
} from '../../../../utils/GoalMilestonesHelper'

const OPTIONS = [
    {
        mode: GOAL_SCHEDULE_MODE_DYNAMIC,
        title: 'Dynamic',
        description: 'The goal moves automatically to the current linear milestone',
        shortcutKey: '1',
    },
    {
        mode: GOAL_SCHEDULE_MODE_FIXED,
        title: 'Fixed',
        description: 'The goal stays on the milestone date you set',
        shortcutKey: '2',
    },
]

export default function ScheduleModeModal({ projectId, goal, closePopover }) {
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)
    const currentMode = normalizeGoalScheduleMode(goal.scheduleMode)

    const selectMode = mode => {
        if (mode !== currentMode) {
            Backend.updateGoalScheduleMode(projectId, goal, mode)
        }
        closePopover()
    }

    const onKeyDown = event => {
        if (event.key === 'Escape') {
            closePopover()
            event.preventDefault()
            event.stopPropagation()
        }
    }

    useEffect(() => {
        document.addEventListener('keydown', onKeyDown)
        storeModal(GOAL_SCHEDULE_MODE_MODAL_ID)
        return () => {
            document.removeEventListener('keydown', onKeyDown)
            removeModal(GOAL_SCHEDULE_MODE_MODAL_ID)
        }
    }, [])

    return (
        <View style={[localStyles.container, applyPopoverWidth()]}>
            <View style={localStyles.section}>
                <ModalHeader
                    closeModal={closePopover}
                    title={translate('Schedule mode')}
                    description={translate('Choose how this goal follows your linear milestones')}
                />
            </View>

            <Line />

            <View style={localStyles.section}>
                {OPTIONS.map(option => {
                    const isSelected = option.mode === currentMode
                    return (
                        <TouchableOpacity
                            key={option.mode}
                            style={localStyles.option}
                            onPress={() => selectMode(option.mode)}
                        >
                            <Hotkeys
                                keyName={option.shortcutKey}
                                onKeyDown={() => selectMode(option.mode)}
                                filter={e => true}
                            >
                                <View style={localStyles.optionText}>
                                    <Text style={localStyles.optionTitle}>{translate(option.title)}</Text>
                                    <Text style={localStyles.optionDescription}>{translate(option.description)}</Text>
                                </View>
                                <View style={localStyles.optionRight}>
                                    {isSelected && (
                                        <Icon
                                            name="check"
                                            size={20}
                                            color={colors.Primary200}
                                            style={localStyles.check}
                                        />
                                    )}
                                    {!smallScreenNavigation && (
                                        <Shortcut text={option.shortcutKey} theme={SHORTCUT_LIGHT} />
                                    )}
                                </View>
                            </Hotkeys>
                        </TouchableOpacity>
                    )
                })}
            </View>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        backgroundColor: colors.Secondary400,
        paddingTop: 16,
        paddingBottom: 8,
        borderRadius: 4,
        shadowColor: 'rgba(78, 93, 120, 0.56)',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 1,
        shadowRadius: 16,
        elevation: 3,
    },
    section: {
        paddingLeft: 16,
        paddingRight: 16,
    },
    option: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingVertical: 10,
    },
    optionText: {
        flex: 1,
        marginRight: 8,
    },
    optionTitle: {
        ...styles.subtitle1,
        color: '#ffffff',
    },
    optionDescription: {
        ...styles.body2,
        color: colors.Text03,
        marginTop: 2,
    },
    optionRight: {
        flexShrink: 0,
        flexDirection: 'row',
        alignItems: 'center',
    },
    check: {
        marginRight: 8,
    },
})
