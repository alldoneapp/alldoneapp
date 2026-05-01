import React, { useState } from 'react'
import { StyleSheet, Text, TextInput, View } from 'react-native'
import Popover from 'react-tiny-popover'
import { useSelector } from 'react-redux'
import moment from 'moment'

import Icon from '../../../Icon'
import styles, { colors } from '../../../styles/global'
import Button from '../../../UIControls/Button'
import Switch from '../../../UIControls/Switch'
import { translate } from '../../../../i18n/TranslationService'
import { applyPopoverWidth } from '../../../../utils/HelperFunctions'
import { setProjectDayRateTimeLog } from '../../../../utils/backends/Projects/projectsFirestore'
import ProjectHelper from '../../../SettingsView/ProjectsSettings/ProjectHelper'
import {
    DEFAULT_DAY_RATE_TARGET_MINUTES,
    DEFAULT_DAY_RATE_TRIGGER_TASKS,
    normalizeDayRateTimeLogConfig,
    reconcileProjectDayRateTimeLogsBackfill,
} from '../../../../utils/DayRateTimeLogHelper'

function DayRateLoggingModal({ projectId, dayRateTimeLog, closePopover }) {
    const loggedUserId = useSelector(state => state.loggedUser.uid)
    const config = normalizeDayRateTimeLogConfig(dayRateTimeLog)
    const [enabled, setEnabled] = useState(config.enabled)
    const [hours, setHours] = useState(String(config.targetMinutes / 60))
    const [triggerTasks, setTriggerTasks] = useState(String(config.triggerTasks))
    const [backfilling, setBackfilling] = useState(false)

    const save = () => {
        const parsedHours = parseFloat(hours)
        const parsedTriggerTasks = parseInt(triggerTasks, 10)
        const nextConfig = {
            enabled,
            targetMinutes:
                Number.isFinite(parsedHours) && parsedHours > 0
                    ? Math.round(parsedHours * 60)
                    : DEFAULT_DAY_RATE_TARGET_MINUTES,
            triggerTasks:
                Number.isFinite(parsedTriggerTasks) && parsedTriggerTasks > 0
                    ? parsedTriggerTasks
                    : DEFAULT_DAY_RATE_TRIGGER_TASKS,
            backfilledUntilByUser: dayRateTimeLog?.backfilledUntilByUser || {},
        }

        setProjectDayRateTimeLog(projectId, nextConfig)
        closePopover()
    }

    const backfillFromProjectStart = async () => {
        const project = ProjectHelper.getProjectById(projectId)
        if (!project || backfilling) return

        setBackfilling(true)
        try {
            await reconcileProjectDayRateTimeLogsBackfill(
                project,
                loggedUserId,
                project.projectStartDate || project.created,
                moment().subtract(1, 'day').endOf('day').valueOf(),
                { forceFromProjectStart: true }
            )
            closePopover()
        } catch (error) {
            console.log(error)
            setBackfilling(false)
        }
    }

    return (
        <View style={[localStyles.modal, applyPopoverWidth()]}>
            <Text style={localStyles.modalTitle}>{translate('Day-rate logging')}</Text>
            <View style={localStyles.modalRow}>
                <Text style={localStyles.modalLabel}>{translate('Enabled')}</Text>
                <Switch
                    active={enabled}
                    activeSwitch={() => setEnabled(true)}
                    deactiveSwitch={() => setEnabled(false)}
                />
            </View>
            <View style={localStyles.modalRow}>
                <Text style={localStyles.modalLabel}>{translate('Hours per day')}</Text>
                <TextInput
                    style={localStyles.input}
                    value={hours}
                    onChangeText={setHours}
                    keyboardType={'numeric'}
                    accessible={false}
                />
            </View>
            <View style={localStyles.modalRow}>
                <Text style={localStyles.modalLabel}>{translate('Task trigger')}</Text>
                <TextInput
                    style={localStyles.input}
                    value={triggerTasks}
                    onChangeText={setTriggerTasks}
                    keyboardType={'numeric'}
                    accessible={false}
                />
            </View>
            <View style={localStyles.buttons}>
                <Button
                    title={translate(backfilling ? 'Backfilling...' : 'Backfill from project start')}
                    type={'ghost'}
                    icon="rotate-cw"
                    onPress={backfillFromProjectStart}
                    disabled={!config.enabled || backfilling}
                    buttonStyle={localStyles.backfillButton}
                />
                <Button title={translate('Save')} onPress={save} buttonStyle={localStyles.saveButton} />
            </View>
        </View>
    )
}

export default function DayRateLogging({ projectId, disabled, dayRateTimeLog }) {
    const smallScreen = useSelector(state => state.smallScreen)
    const [open, setOpen] = useState(false)
    const config = normalizeDayRateTimeLogConfig(dayRateTimeLog)
    const title = config.enabled ? `${config.targetMinutes / 60}h / ${config.triggerTasks}` : translate('Off')

    return (
        <View style={localStyles.container}>
            <View style={{ marginRight: 8 }}>
                <Icon name="clock" size={24} color={colors.Text03} />
            </View>
            <Text style={[styles.subtitle2, { color: colors.Text03 }]}>{translate('Day-rate logging')}</Text>
            <View style={localStyles.buttonContainer}>
                <Popover
                    content={
                        <DayRateLoggingModal
                            projectId={projectId}
                            dayRateTimeLog={dayRateTimeLog}
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
        width: 305,
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
    input: {
        ...styles.body1,
        width: 80,
        height: 40,
        paddingHorizontal: 8,
        borderRadius: 4,
        color: '#ffffff',
        backgroundColor: colors.Secondary300,
        textAlign: 'right',
        outlineStyle: 'none',
    },
    saveButton: {
        alignSelf: 'flex-end',
        marginTop: 8,
    },
    buttons: {
        marginTop: 16,
        alignItems: 'flex-end',
    },
    backfillButton: {
        alignSelf: 'flex-start',
    },
})
