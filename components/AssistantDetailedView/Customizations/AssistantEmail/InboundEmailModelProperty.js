import React, { useState } from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import Popover from 'react-tiny-popover'
import { useSelector } from 'react-redux'

import styles, { colors } from '../../../styles/global'
import Icon from '../../../Icon'
import Button from '../../../UIControls/Button'
import { updateAssistantEmailModel } from '../../../../utils/backends/Assistants/assistantsFirestore'
import { translate } from '../../../../i18n/TranslationService'
import { SELECTABLE_ASSISTANT_MODELS } from '../../../../functions/Assistant/selectableAssistantModels'

export default function InboundEmailModelProperty({ disabled, projectId, assistant }) {
    const mobile = useSelector(state => state.smallScreen)
    const [open, setOpen] = useState(false)
    const inheritedModel = assistant.model || SELECTABLE_ASSISTANT_MODELS[0].model
    const selectedModel = typeof assistant.emailModel === 'string' ? assistant.emailModel : ''
    const effectiveOption = SELECTABLE_ASSISTANT_MODELS.find(
        option => option.model === (selectedModel || inheritedModel)
    )
    const currentLabel = selectedModel
        ? effectiveOption?.name || selectedModel
        : `${translate('Inherit assistant model')} (${effectiveOption?.name || inheritedModel})`

    const onSelectModel = model => {
        updateAssistantEmailModel(projectId, assistant, model)
        setOpen(false)
    }

    const options = [
        {
            model: '',
            name: translate('Inherit assistant model'),
            descriptionKey: 'Use the normal assistant model for inbound email.',
        },
        ...SELECTABLE_ASSISTANT_MODELS,
    ]

    return (
        <View style={localStyles.settingRow}>
            <View style={[localStyles.settingRowSection, localStyles.settingRowLeft]}>
                <Icon name={'cpu'} size={24} color={colors.Text03} style={{ marginHorizontal: 8 }} />
                <Text style={[styles.subtitle2, { color: colors.Text03 }]} numberOfLines={1}>
                    {translate('Inbound email model')}
                </Text>
            </View>
            <View style={[localStyles.settingRowSection, localStyles.settingRowRight]}>
                <Text style={[styles.body1, localStyles.currentValue]} numberOfLines={1}>
                    {currentLabel}
                </Text>
                <Popover
                    content={
                        <View style={localStyles.popover}>
                            <Text style={[styles.title7, localStyles.title]}>{translate('Inbound email model')}</Text>
                            <Text style={[styles.body2, localStyles.helpText]}>
                                {translate('Choose the model used to process messages sent to Anna by email.')}
                            </Text>
                            {options.map(option => {
                                const selected = option.model === selectedModel
                                return (
                                    <TouchableOpacity
                                        key={option.model || 'inherit'}
                                        style={[localStyles.option, selected && localStyles.optionActive]}
                                        onPress={() => onSelectModel(option.model)}
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
                                            {translate(option.descriptionKey)}
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
        maxWidth: '65%',
    },
    currentValue: {
        marginRight: 8,
        flexShrink: 1,
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
