import React, { useState } from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import Popover from 'react-tiny-popover'
import { useSelector } from 'react-redux'

import styles, { colors } from '../../../styles/global'
import Icon from '../../../Icon'
import Button from '../../../UIControls/Button'
import { updateAssistantHeartbeatSettings } from '../../../../utils/backends/Assistants/assistantsFirestore'
import { translate } from '../../../../i18n/TranslationService'
import {
    getAssistantReasoningEffortLabelKey,
    SELECTABLE_ASSISTANT_REASONING_EFFORTS,
} from '../../../../functions/Assistant/selectableAssistantReasoningEfforts'
import { getEffectiveHeartbeatReasoningEffort } from '../../../../functions/Assistant/heartbeatSettingsHelper'

export default function HeartbeatReasoningEffortProperty({ disabled, projectId, assistant }) {
    const mobile = useSelector(state => state.smallScreen)
    const [open, setOpen] = useState(false)
    const currentEffort = getEffectiveHeartbeatReasoningEffort(assistant)

    const onSelectEffort = reasoningEffort => {
        updateAssistantHeartbeatSettings(projectId, assistant, {
            heartbeatReasoningEffort: reasoningEffort,
        })
        setOpen(false)
    }

    return (
        <View style={localStyles.settingRow}>
            <View style={[localStyles.settingRowSection, localStyles.settingRowLeft]}>
                <Icon name={'activity'} size={24} color={colors.Text03} style={{ marginHorizontal: 8 }} />
                <Text style={[styles.subtitle2, { color: colors.Text03 }]} numberOfLines={1}>
                    {translate('Heartbeat reasoning effort')}
                </Text>
            </View>
            <View style={[localStyles.settingRowSection, localStyles.settingRowRight]}>
                <Text style={[styles.body1, { marginRight: 8 }]} numberOfLines={1}>
                    {translate(getAssistantReasoningEffortLabelKey(currentEffort))}
                </Text>
                <Popover
                    content={
                        <View style={localStyles.popover}>
                            <Text style={[styles.title7, localStyles.title]}>
                                {translate('Heartbeat reasoning effort')}
                            </Text>
                            <Text style={[styles.body2, localStyles.helpText]}>
                                {translate('Choose how much reasoning heartbeat executions should use.')}
                            </Text>
                            {SELECTABLE_ASSISTANT_REASONING_EFFORTS.map(option => {
                                const selected = option.value === currentEffort
                                return (
                                    <TouchableOpacity
                                        key={option.value || 'model-default'}
                                        style={[localStyles.option, selected && localStyles.optionActive]}
                                        onPress={() => onSelectEffort(option.value)}
                                    >
                                        <Text
                                            style={[
                                                styles.subtitle2,
                                                localStyles.optionName,
                                                selected && localStyles.optionNameActive,
                                            ]}
                                        >
                                            {translate(option.labelKey)}
                                        </Text>
                                    </TouchableOpacity>
                                )
                            })}
                        </View>
                    }
                    onClickOutside={() => setOpen(false)}
                    isOpen={open}
                    position={['bottom', 'left', 'right', 'top']}
                    padding={4}
                    align={'end'}
                    contentLocation={mobile ? null : undefined}
                >
                    <Button icon={'edit-2'} type={'ghost'} onPress={() => setOpen(true)} disabled={disabled} />
                </Popover>
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
    popover: {
        width: 320,
        backgroundColor: colors.Secondary400,
        borderRadius: 4,
        padding: 16,
        boxShadow: '0px 4px 16px rgba(78,93,120,0.56)',
        elevation: 3,
    },
    title: {
        color: '#ffffff',
    },
    helpText: {
        color: colors.Text03,
        marginTop: 4,
        marginBottom: 12,
    },
    option: {
        borderWidth: 1,
        borderColor: colors.Grey400,
        backgroundColor: colors.Secondary300,
        borderRadius: 4,
        padding: 10,
        marginTop: 8,
    },
    optionActive: {
        borderColor: colors.Primary500,
    },
    optionName: {
        color: '#ffffff',
    },
    optionNameActive: {
        color: colors.Primary500,
    },
})
