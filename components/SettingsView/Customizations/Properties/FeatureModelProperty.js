import React, { useState } from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { useSelector } from 'react-redux'

import AppPopover from '../../../UIComponents/ModalShell/AppPopover'
import styles, { colors } from '../../../styles/global'
import Icon from '../../../Icon'
import Button from '../../../UIControls/Button'
import AssistantModelGoldRate from '../../../UIComponents/AssistantModelGoldRate'
import { setUserFeatureModelPreference } from '../../../../utils/backends/Users/usersFirestore'
import { translate } from '../../../../i18n/TranslationService'
import { SELECTABLE_ASSISTANT_MODELS } from '../../../../functions/Assistant/selectableAssistantModels'
import {
    FEATURE_MODEL_FEATURES,
    getFeatureModelOptionInfo,
    isValidFeatureModelChoice,
} from '../../../../functions/Assistant/featureModelPreferences'

/**
 * One Settings row for a one-shot AI feature's model (structure mirrors
 * InboundEmailModelProperty): current value + popover with "Use default (X)" and the selectable
 * product models the feature supports. Options a feature cannot run (e.g. OpenRouter models for
 * the Responses-API-only goal routing) are filtered by the same shared validation the server
 * resolves with, so the picker can never offer a choice the backend would ignore.
 */
export default function FeatureModelProperty({ userId, featureKey, label, helpText, iconName }) {
    const mobile = useSelector(state => state.smallScreen)
    const storedValue = useSelector(state => state.loggedUser.featureModelPreferences?.[featureKey] || '')
    const [open, setOpen] = useState(false)

    const feature = FEATURE_MODEL_FEATURES[featureKey]
    const defaultInfo = getFeatureModelOptionInfo(feature.defaultModelKey)
    const defaultLabel = `${translate('Use default')} (${defaultInfo?.name || feature.defaultModelKey})`
    const selectedModel = isValidFeatureModelChoice(featureKey, storedValue) ? storedValue : ''
    const currentLabel = selectedModel ? getFeatureModelOptionInfo(selectedModel)?.name || selectedModel : defaultLabel

    const onSelectModel = model => {
        setUserFeatureModelPreference(userId, featureKey, model)
        setOpen(false)
    }

    const options = [
        {
            model: '',
            name: defaultLabel,
            descriptionKey: 'Use the recommended model for this feature.',
            tokensPerGold: defaultInfo?.tokensPerGold,
        },
        ...SELECTABLE_ASSISTANT_MODELS.filter(option => isValidFeatureModelChoice(featureKey, option.model)),
    ]

    return (
        <View style={localStyles.settingRow}>
            <View style={[localStyles.settingRowSection, localStyles.settingRowLeft]}>
                <Icon name={iconName} size={24} color={colors.Text03} style={{ marginHorizontal: 8 }} />
                <Text style={[styles.subtitle2, { color: colors.Text03 }]} numberOfLines={1}>
                    {translate(label)}
                </Text>
            </View>
            <View style={[localStyles.settingRowSection, localStyles.settingRowRight]}>
                <Text style={[styles.body1, localStyles.currentValue]} numberOfLines={1}>
                    {currentLabel}
                </Text>
                <AppPopover
                    content={
                        <View style={localStyles.popover}>
                            <Text style={[styles.title7, localStyles.title]}>{translate(label)}</Text>
                            <Text style={[styles.body2, localStyles.helpText]}>{translate(helpText)}</Text>
                            {options.map(option => {
                                const selected = option.model === selectedModel
                                return (
                                    <TouchableOpacity
                                        key={option.model || 'default'}
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
                                        <AssistantModelGoldRate tokensPerGold={option.tokensPerGold} />
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
                    <Button icon={'edit-2'} type={'ghost'} onPress={() => setOpen(true)} />
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
    optionDescription: {
        color: colors.Text03,
        marginTop: 2,
    },
})
