import React, { useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import AppPopover from '../../../UIComponents/ModalShell/AppPopover'
import { useSelector } from 'react-redux'

import styles, { colors } from '../../../styles/global'
import ChangeNumberTodayTasks from '../../../UIComponents/FloatModals/ChangeNumberTodayTasks'
import Button from '../../../UIControls/Button'
import Icon from '../../../Icon'
import { updateAssistantHeartbeatSettings } from '../../../../utils/backends/Assistants/assistantsFirestore'
import { translate } from '../../../../i18n/TranslationService'
import { formatHeartbeatInterval, getHeartbeatIntervalMs } from './heartbeatIntervalHelper'

const VARIANT_CONFIG = {
    replied: {
        field: 'heartbeatChancePercent',
        rowLabel: 'Chance after you reply to the latest heartbeat',
        modalTitle: 'Heartbeat chance after replying',
        modalSubtitle:
            'Applied after you reply to the latest visible heartbeat in the in-app Heartbeat chat or WhatsApp daily chat that local day. The next visible heartbeat resets the chance to the before-reply value. (%{interval})',
    },
    noReply: {
        field: 'heartbeatChanceNoReplyPercent',
        rowLabel: 'Chance until you reply to the latest heartbeat',
        modalTitle: 'Heartbeat chance before replying',
        modalSubtitle:
            'Applied before the first visible heartbeat that local day and after every new visible heartbeat until you reply in the in-app Heartbeat chat or WhatsApp daily chat. Messages sent before the latest heartbeat do not count. HEARTBEAT_OK does not reset the chance because it posts no message. (%{interval})',
    },
}

export default function HeartbeatChanceProperty({ disabled, projectId, assistant, variant = 'replied' }) {
    const mobile = useSelector(state => state.smallScreen)
    const mobileNav = useSelector(state => state.smallScreenNavigation)
    const defaultProjectId = useSelector(state => state.loggedUser.defaultProjectId)
    const [open, setOpen] = useState(false)

    const config = VARIANT_CONFIG[variant] || VARIANT_CONFIG.replied
    const isDefaultAssistantInDefaultProject = assistant.isDefault && projectId === defaultProjectId
    const chancePercent = assistant[config.field] ?? (isDefaultAssistantInDefaultProject ? 10 : 0)
    const intervalLabel = formatHeartbeatInterval(getHeartbeatIntervalMs(assistant.heartbeatIntervalMs))

    const changeData = percent => {
        const value = percent > 100 ? 100 : percent < 0 ? 0 : percent
        updateAssistantHeartbeatSettings(projectId, assistant, { [config.field]: value })
    }

    return (
        <View style={localStyles.settingRow}>
            <View style={[localStyles.settingRowSection, localStyles.settingRowLeft]}>
                <Icon name={'zap'} size={24} color={colors.Text03} style={{ marginHorizontal: 8 }} />
                {mobileNav ? (
                    <Text style={[styles.body1]} numberOfLines={1}>
                        {`${chancePercent}%`}
                    </Text>
                ) : (
                    <Text style={[styles.subtitle2, { color: colors.Text03 }]} numberOfLines={1}>
                        {translate(config.rowLabel)}
                    </Text>
                )}
            </View>
            <View style={[localStyles.settingRowSection, localStyles.settingRowRight]}>
                {!mobileNav && (
                    <Text style={[styles.body1, { marginRight: 8 }]} numberOfLines={1}>
                        {`${chancePercent}%`}
                    </Text>
                )}
                <AppPopover
                    content={
                        <ChangeNumberTodayTasks
                            customTitle={translate(config.modalTitle)}
                            customSubtitle={translate(config.modalSubtitle, { interval: intervalLabel })}
                            closePopover={() => setOpen(false)}
                            onSaveData={changeData}
                            currentValue={chancePercent}
                            hideUnlimitedButton={true}
                            allowZeroValue={true}
                            customPropertyName="Percent"
                        />
                    }
                    onClickOutside={() => setOpen(false)}
                    isOpen={open}
                    position={['bottom', 'left', 'right', 'top']}
                    padding={4}
                    align={'end'}
                    contentLocation={mobile ? null : undefined}
                >
                    <Button icon={'edit-2'} type={'ghost'} onPress={() => setOpen(true)} disabled={disabled} />
                </AppPopover>
            </View>
        </View>
    )
}

const localStyles = StyleSheet.create({
    settingRow: {
        height: 56,
        justifyContent: 'space-between',
        alignItems: 'center',
        flexDirection: 'row',
    },
    settingRowSection: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    settingRowLeft: {
        flex: 1,
        justifyContent: 'flex-start',
    },
    settingRowRight: {
        justifyContent: 'flex-end',
    },
})
