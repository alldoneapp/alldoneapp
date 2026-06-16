import React, { useState } from 'react'
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native'
import Popover from 'react-tiny-popover'
import { useSelector } from 'react-redux'
import moment from 'moment-timezone'

import Icon from '../../../Icon'
import styles, { colors } from '../../../styles/global'
import Button from '../../../UIControls/Button'
import Switch from '../../../UIControls/Switch'
import { translate } from '../../../../i18n/TranslationService'
import { applyPopoverWidth } from '../../../../utils/HelperFunctions'
import Backend from '../../../../utils/BackendBridge'
import { getDateFormat } from '../../../UIComponents/FloatModals/DateFormatPickerModal'
import {
    GOAL_MILESTONES_CADENCE_BIWEEKLY,
    GOAL_MILESTONES_CADENCE_MONTHLY,
    GOAL_MILESTONES_CADENCE_QUARTERLY,
    GOAL_MILESTONES_CADENCE_WEEKLY,
    GOAL_MILESTONES_MODE_LINEAR,
    GOAL_MILESTONES_MODE_MANUAL,
    getCurrentTimezone,
    normalizeGoalMilestonesConfig,
} from '../../../../utils/GoalMilestonesHelper'

const MIN_FUTURE_MILESTONES = 1
const MAX_FUTURE_MILESTONES = 12

const CADENCE_OPTIONS = [
    { key: GOAL_MILESTONES_CADENCE_WEEKLY, title: 'Weekly' },
    { key: GOAL_MILESTONES_CADENCE_BIWEEKLY, title: 'Bi-weekly' },
    { key: GOAL_MILESTONES_CADENCE_MONTHLY, title: 'Monthly' },
    { key: GOAL_MILESTONES_CADENCE_QUARTERLY, title: 'Quarterly' },
]

function GoalMilestonesModal({ projectId, goalMilestonesConfig, closePopover }) {
    const currentConfig = normalizeGoalMilestonesConfig(goalMilestonesConfig, getCurrentTimezone())
    const [linearMode, setLinearMode] = useState(currentConfig.mode === GOAL_MILESTONES_MODE_LINEAR)
    // Default newly enabled automatic milestones to a monthly cadence; keep the saved cadence for
    // projects that already have automatic milestones turned on.
    const [cadence, setCadence] = useState(
        currentConfig.mode === GOAL_MILESTONES_MODE_LINEAR ? currentConfig.cadence : GOAL_MILESTONES_CADENCE_MONTHLY
    )
    const [timezone, setTimezone] = useState(currentConfig.timezone)
    const [futureMilestones, setFutureMilestones] = useState(currentConfig.futureMilestonesToCreate)
    const [startDateText, setStartDateText] = useState(
        moment.tz(currentConfig.cadenceStartDate, currentConfig.timezone).format(getDateFormat())
    )

    const timezoneIsValid = !!moment.tz.zone(timezone)
    const parsedStartDate = timezoneIsValid ? moment.tz(startDateText, getDateFormat(), true, timezone) : null
    const dateIsValid = !!parsedStartDate && parsedStartDate.isValid()
    const canSave = timezoneIsValid && dateIsValid

    const decreaseFutureMilestones = () => setFutureMilestones(value => Math.max(MIN_FUTURE_MILESTONES, value - 1))
    const increaseFutureMilestones = () => setFutureMilestones(value => Math.min(MAX_FUTURE_MILESTONES, value + 1))

    const save = () => {
        if (!canSave) return

        Backend.setProjectGoalMilestonesConfig(projectId, {
            mode: linearMode ? GOAL_MILESTONES_MODE_LINEAR : GOAL_MILESTONES_MODE_MANUAL,
            cadence,
            timezone,
            cadenceStartDate: parsedStartDate.startOf('day').hour(12).minute(0).second(0).millisecond(0).valueOf(),
            futureMilestonesToCreate: futureMilestones,
        })
        closePopover()
    }

    const resetStartDate = () => {
        setStartDateText(
            moment.tz(Date.now(), timezoneIsValid ? timezone : getCurrentTimezone()).format(getDateFormat())
        )
    }

    return (
        <View style={[localStyles.modal, applyPopoverWidth()]}>
            <Text style={localStyles.modalTitle}>{translate('Goal milestones')}</Text>
            <View style={localStyles.modalRow}>
                <Text style={localStyles.modalLabel}>{translate('Automatic milestones')}</Text>
                <Switch
                    active={linearMode}
                    activeSwitch={() => setLinearMode(true)}
                    deactiveSwitch={() => setLinearMode(false)}
                />
            </View>

            <Text style={localStyles.sectionLabel}>{translate('Cadence')}</Text>
            <View style={localStyles.optionGrid}>
                {CADENCE_OPTIONS.map(option => {
                    const selected = cadence === option.key
                    return (
                        <TouchableOpacity
                            key={option.key}
                            style={[localStyles.optionButton, selected && localStyles.selectedOptionButton]}
                            onPress={() => setCadence(option.key)}
                            disabled={!linearMode}
                        >
                            <Text style={[localStyles.optionText, selected && localStyles.selectedOptionText]}>
                                {translate(option.title)}
                            </Text>
                        </TouchableOpacity>
                    )
                })}
            </View>

            <View style={localStyles.inputSection}>
                <Text style={localStyles.modalLabel}>{translate('Project timezone')}</Text>
                <TextInput
                    style={[localStyles.input, !timezoneIsValid && localStyles.invalidInput]}
                    value={timezone}
                    onChangeText={setTimezone}
                    editable={linearMode}
                    accessible={false}
                />
            </View>
            <View style={localStyles.inputSection}>
                <View style={localStyles.inputHeader}>
                    <Text style={localStyles.modalLabel}>{translate('Cadence start date')}</Text>
                    <Button
                        title={translate('Today')}
                        type={'text'}
                        icon="calendar"
                        onPress={resetStartDate}
                        disabled={!linearMode}
                        buttonStyle={localStyles.todayButton}
                    />
                </View>
                <TextInput
                    style={[localStyles.input, !dateIsValid && localStyles.invalidInput]}
                    value={startDateText}
                    onChangeText={setStartDateText}
                    editable={linearMode}
                    accessible={false}
                />
            </View>

            <View style={[localStyles.inputSection, localStyles.stepperRow]}>
                <Text style={localStyles.modalLabel}>{translate('Future milestones to show')}</Text>
                <View style={localStyles.stepper}>
                    <TouchableOpacity
                        style={[
                            localStyles.stepperButton,
                            (!linearMode || futureMilestones <= MIN_FUTURE_MILESTONES) &&
                                localStyles.stepperButtonDisabled,
                        ]}
                        onPress={decreaseFutureMilestones}
                        disabled={!linearMode || futureMilestones <= MIN_FUTURE_MILESTONES}
                    >
                        <Icon name="minus" size={16} color={linearMode ? '#ffffff' : colors.Text03} />
                    </TouchableOpacity>
                    <Text style={localStyles.stepperValue}>{futureMilestones}</Text>
                    <TouchableOpacity
                        style={[
                            localStyles.stepperButton,
                            (!linearMode || futureMilestones >= MAX_FUTURE_MILESTONES) &&
                                localStyles.stepperButtonDisabled,
                        ]}
                        onPress={increaseFutureMilestones}
                        disabled={!linearMode || futureMilestones >= MAX_FUTURE_MILESTONES}
                    >
                        <Icon name="plus" size={16} color={linearMode ? '#ffffff' : colors.Text03} />
                    </TouchableOpacity>
                </View>
            </View>

            <View style={localStyles.buttons}>
                <Button title={translate('Save')} onPress={save} disabled={!canSave} buttonStyle={localStyles.save} />
            </View>
        </View>
    )
}

export default function GoalMilestones({ projectId, disabled, goalMilestonesConfig }) {
    const smallScreen = useSelector(state => state.smallScreen)
    const [open, setOpen] = useState(false)
    const config = normalizeGoalMilestonesConfig(goalMilestonesConfig, getCurrentTimezone())
    const cadenceTitle = CADENCE_OPTIONS.find(option => option.key === config.cadence)?.title || 'Weekly'
    const title = config.mode === GOAL_MILESTONES_MODE_LINEAR ? translate(cadenceTitle) : translate('Manual')

    return (
        <View style={localStyles.container}>
            <View style={{ marginRight: 8 }}>
                <Icon name="milestone-2" size={24} color={colors.Text03} />
            </View>
            <Text style={[styles.subtitle2, { color: colors.Text03 }]}>{translate('Goal milestones')}</Text>
            <View style={localStyles.buttonContainer}>
                <Popover
                    content={
                        <GoalMilestonesModal
                            projectId={projectId}
                            goalMilestonesConfig={goalMilestonesConfig}
                            closePopover={() => setOpen(false)}
                        />
                    }
                    onClickOutside={() => setOpen(false)}
                    isOpen={open}
                    position={['bottom', 'left', 'right', 'top']}
                    padding={4}
                    align={'end'}
                    contentLocation={smallScreen ? null : undefined}
                >
                    <Button
                        title={title}
                        type={'ghost'}
                        icon="edit-2"
                        onPress={() => setOpen(true)}
                        disabled={disabled}
                    />
                </Popover>
            </View>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flex: 1,
        flexDirection: 'row',
        maxHeight: 56,
        minHeight: 56,
        height: 56,
        paddingLeft: 8,
        paddingVertical: 8,
        alignItems: 'center',
    },
    buttonContainer: {
        marginLeft: 'auto',
    },
    modal: {
        width: 320,
        padding: 16,
        borderRadius: 4,
        backgroundColor: colors.Secondary400,
        shadowColor: 'rgba(78, 93, 120, 0.56)',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 1,
        shadowRadius: 16,
        elevation: 3,
    },
    modalTitle: {
        ...styles.title7,
        color: '#ffffff',
        marginBottom: 16,
    },
    modalRow: {
        minHeight: 48,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    modalLabel: {
        ...styles.subtitle2,
        color: colors.Text03,
    },
    sectionLabel: {
        ...styles.subtitle2,
        color: colors.Text03,
        marginTop: 8,
        marginBottom: 8,
    },
    optionGrid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        marginHorizontal: -4,
    },
    optionButton: {
        minHeight: 36,
        paddingHorizontal: 10,
        borderRadius: 4,
        justifyContent: 'center',
        margin: 4,
        backgroundColor: colors.Secondary300,
    },
    selectedOptionButton: {
        backgroundColor: colors.Primary300,
    },
    optionText: {
        ...styles.subtitle2,
        color: colors.Text03,
    },
    selectedOptionText: {
        color: '#ffffff',
    },
    inputSection: {
        marginTop: 12,
    },
    stepperRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    stepper: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    stepperButton: {
        width: 32,
        height: 32,
        borderRadius: 4,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: colors.Secondary300,
    },
    stepperButtonDisabled: {
        opacity: 0.5,
    },
    stepperValue: {
        ...styles.subtitle1,
        color: '#ffffff',
        minWidth: 32,
        textAlign: 'center',
    },
    inputHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    input: {
        ...styles.body1,
        height: 40,
        paddingHorizontal: 8,
        marginTop: 8,
        borderRadius: 4,
        color: '#ffffff',
        backgroundColor: colors.Secondary300,
        outlineStyle: 'none',
    },
    invalidInput: {
        borderWidth: 1,
        borderColor: colors.UtilityRed200,
    },
    todayButton: {
        height: 32,
    },
    buttons: {
        marginTop: 16,
        alignItems: 'flex-end',
    },
    save: {
        alignSelf: 'flex-end',
    },
})
