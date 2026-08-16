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
        rowLabel: 'Chance after you write in either daily chat today',
        modalTitle: 'Heartbeat chance after writing today',
        modalSubtitle:
            'Applied each heartbeat interval after you write any message that local day in the in-app Heartbeat chat or WhatsApp daily chat. A message sent before any heartbeat counts. (%{interval})',
    },
    noReply: {
        field: 'heartbeatChanceNoReplyPercent',
        rowLabel: 'Chance before you write in either daily chat today',
        modalTitle: 'Heartbeat chance before writing today',
        modalSubtitle:
            'Applied each heartbeat interval until you write a message that local day in the in-app Heartbeat chat or WhatsApp daily chat. (%{interval})',
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
