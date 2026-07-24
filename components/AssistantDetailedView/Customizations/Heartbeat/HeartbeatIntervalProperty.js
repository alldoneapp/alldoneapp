import React, { useState } from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import Popover from 'react-tiny-popover'
import { useSelector } from 'react-redux'

import styles, { colors } from '../../../styles/global'
import Icon from '../../../Icon'
import Button from '../../../UIControls/Button'
import { updateAssistantHeartbeatSettings } from '../../../../utils/backends/Assistants/assistantsFirestore'
import { translate } from '../../../../i18n/TranslationService'
import { formatHeartbeatInterval, getHeartbeatIntervalMs, getHeartbeatIntervalOptions } from './heartbeatIntervalHelper'

export default function HeartbeatIntervalProperty({ disabled, projectId, assistant }) {
    const mobile = useSelector(state => state.smallScreen)
    const [open, setOpen] = useState(false)

    const currentInterval = getHeartbeatIntervalMs(assistant.heartbeatIntervalMs)
    const intervalOptions = getHeartbeatIntervalOptions()

    const onSelectInterval = intervalMs => {
        updateAssistantHeartbeatSettings(projectId, assistant, { heartbeatIntervalMs: intervalMs })
        setOpen(false)
    }

    return (
        <View style={localStyles.settingRow}>
            <View style={[localStyles.settingRowSection, localStyles.settingRowLeft]}>
                <Icon name={'timer'} size={24} color={colors.Text03} style={{ marginHorizontal: 8 }} />
                <Text style={[styles.subtitle2, { color: colors.Text03 }]} numberOfLines={1}>
                    {translate('Heartbeat interval')}
                </Text>
            </View>
            <View style={[localStyles.settingRowSection, localStyles.settingRowRight]}>
                <Text style={[styles.body1, { marginRight: 8 }]} numberOfLines={1}>
                    {formatHeartbeatInterval(currentInterval)}
                </Text>
                <Popover
                    content={
                        <View style={localStyles.popover}>
                            <View style={localStyles.header}>
                                <Text style={[styles.title7, { color: '#ffffff' }]}>
                                    {translate('Heartbeat interval')}
                                </Text>
                                <Text style={[styles.body2, { color: colors.Text03 }]}>
                                    {translate(
                                        'How often the heartbeat prompt can execute. Choose between 5 minutes and 1 hour in 5-minute steps.'
                                    )}
                                </Text>
                            </View>
                            <View style={localStyles.optionsGrid}>
                                {intervalOptions.map(intervalMs => {
                                    const selected = intervalMs === currentInterval
                                    return (
                                        <TouchableOpacity
                                            key={intervalMs}
                                            style={[
                                                localStyles.optionButton,
                                                selected && localStyles.optionButtonActive,
                                            ]}
                                            onPress={() => onSelectInterval(intervalMs)}
                                        >
                                            <Text
                                                style={[
                                                    styles.subtitle2,
                                                    localStyles.optionText,
                                                    selected && localStyles.optionTextActive,
                                                ]}
                                            >
                                                {formatHeartbeatInterval(intervalMs)}
                                            </Text>
                                        </TouchableOpacity>
                                    )
                                })}
                            </View>
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
        shadowColor: 'rgba(78, 93, 120, 0.56)',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 1,
        shadowRadius: 16,
        elevation: 3,
    },
    header: {
        marginBottom: 16,
    },
    optionsGrid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        marginHorizontal: -4,
        marginBottom: -8,
    },
    optionButton: {
        width: '33.33%',
        paddingHorizontal: 4,
        marginBottom: 8,
        borderRadius: 4,
        borderWidth: 1,
        borderColor: colors.Grey400,
        backgroundColor: colors.Secondary300,
        paddingVertical: 8,
        paddingHorizontal: 10,
    },
    optionButtonActive: {
        borderColor: colors.Primary500,
    },
    optionText: {
        color: '#ffffff',
        textAlign: 'center',
    },
    optionTextActive: {
        color: colors.Primary500,
    },
})
