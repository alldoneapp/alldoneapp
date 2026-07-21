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
    MODEL_GPT5_6_LUNA,
    MODEL_GPT5_6_SOL,
    MODEL_GPT5_6_TERRA,
} from '../../../AdminPanel/Assistants/assistantsHelper'

const HEARTBEAT_MODELS = [
    {
        key: MODEL_GPT5_6_SOL,
        name: 'Sol',
        description: 'Most capable',
    },
    {
        key: MODEL_GPT5_6_TERRA,
        name: 'Terra',
        description: 'Balanced cost and capability',
    },
    {
        key: MODEL_GPT5_6_LUNA,
        name: 'Luna',
        description: 'Efficient for high-volume work',
    },
]

export default function HeartbeatModelProperty({ disabled, projectId, assistant }) {
    const mobile = useSelector(state => state.smallScreen)
    const [open, setOpen] = useState(false)
    const currentModel = assistant.heartbeatModel || assistant.model || MODEL_GPT5_6_SOL
    const currentOption = HEARTBEAT_MODELS.find(option => option.key === currentModel)

    const onSelectModel = model => {
        updateAssistantHeartbeatSettings(projectId, assistant, { heartbeatModel: model })
        setOpen(false)
    }

    return (
        <View style={localStyles.settingRow}>
            <View style={[localStyles.settingRowSection, localStyles.settingRowLeft]}>
                <Icon name={'cpu'} size={24} color={colors.Text03} style={{ marginHorizontal: 8 }} />
                <Text style={[styles.subtitle2, { color: colors.Text03 }]} numberOfLines={1}>
                    {translate('Heartbeat model')}
                </Text>
            </View>
            <View style={[localStyles.settingRowSection, localStyles.settingRowRight]}>
                <Text style={[styles.body1, { marginRight: 8 }]} numberOfLines={1}>
                    {currentOption?.name || currentModel}
                </Text>
                <Popover
                    content={
                        <View style={localStyles.popover}>
                            <Text style={[styles.title7, localStyles.title]}>{translate('Heartbeat model')}</Text>
                            <Text style={[styles.body2, localStyles.helpText]}>
                                {translate('Choose the model used only for heartbeat executions.')}
                            </Text>
                            {HEARTBEAT_MODELS.map(option => {
                                const selected = option.key === currentModel
                                return (
                                    <TouchableOpacity
                                        key={option.key}
                                        style={[localStyles.option, selected && localStyles.optionActive]}
                                        onPress={() => onSelectModel(option.key)}
                                    >
                                        <Text
                                            style={[
                                                styles.subtitle2,
                                                localStyles.optionName,
                                                selected && localStyles.optionNameActive,
                                            ]}
                                        >
                                            {option.name}
                                        </Text>
                                        <Text style={[styles.body2, localStyles.optionDescription]}>
                                            {translate(option.description)}
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
        shadowColor: 'rgba(78, 93, 120, 0.56)',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 1,
        shadowRadius: 16,
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
    optionDescription: {
        color: colors.Text03,
        marginTop: 2,
    },
})
