import React, { useMemo, useState } from 'react'
import { StyleSheet, View, Text, TouchableOpacity } from 'react-native'

import { colors } from '../../../styles/global'
import { applyPopoverWidth } from '../../../../utils/HelperFunctions'
import ModalHeader from '../ModalHeader'
import CustomScrollView from '../../../UIControls/CustomScrollView'
import CheckBox from '../../../CheckBox'
import Button from '../../../UIControls/Button'
import { translate } from '../../../../i18n/TranslationService'

const normalizeKey = value => String(value || '').trim()

const buildSelectionSet = (assistant, availableTargets) => {
    if (!Array.isArray(assistant?.allowedDelegationTargetKeys)) {
        return new Set(availableTargets.map(target => target.targetKey))
    }

    const selected = new Set(assistant.allowedDelegationTargetKeys.map(normalizeKey).filter(Boolean))
    const normalizedSet = new Set()

    availableTargets.forEach(target => {
        if (selected.has(target.targetKey) || selected.has(target.uid)) {
            normalizedSet.add(target.targetKey)
        }
    })

    return normalizedSet
}

export default function AssistantDelegationTargetsModal({ assistant, availableTargets, onApply, closeModal }) {
    const [selectedTargets, setSelectedTargets] = useState(() => buildSelectionSet(assistant, availableTargets))

    const toggleTarget = targetKey => {
        setSelectedTargets(prev => {
            const next = new Set(prev)
            if (next.has(targetKey)) {
                next.delete(targetKey)
            } else {
                next.add(targetKey)
            }
            return next
        })
    }

    const handleSave = () => {
        const selectedTargetKeys = Array.from(selectedTargets)
        const useDefaultAll = selectedTargetKeys.length === availableTargets.length
        onApply({ selectedTargetKeys, useDefaultAll })
        closeModal()
    }

    const selectionSummary = useMemo(() => {
        if (!availableTargets.length) return translate('No assistants available for delegation')
        if (selectedTargets.size === 0) return translate('No assistants enabled for delegation')
        if (selectedTargets.size === availableTargets.length) return translate('All assistants enabled for delegation')

        return availableTargets
            .filter(target => selectedTargets.has(target.targetKey))
            .map(target => target.displayName)
            .join(', ')
    }, [availableTargets, selectedTargets])

    return (
        <View style={localStyles.wrapper}>
            <View style={[localStyles.container, applyPopoverWidth()]}>
                <CustomScrollView style={localStyles.scroll} showsVerticalScrollIndicator={false}>
                    <ModalHeader
                        closeModal={closeModal}
                        title={translate('Delegation targets')}
                        description={translate('Select which assistants this assistant can delegate to')}
                    />
                    <Text style={localStyles.summary} numberOfLines={2}>
                        {selectionSummary}
                    </Text>
                    {availableTargets.map(target => {
                        const checked = selectedTargets.has(target.targetKey)
                        return (
                            <TouchableOpacity
                                key={target.targetKey}
                                style={localStyles.option}
                                onPress={() => toggleTarget(target.targetKey)}
                            >
                                <CheckBox checked={checked} />
                                <View style={localStyles.optionTextContainer}>
                                    <Text style={localStyles.optionLabel}>{target.displayName}</Text>
                                    <Text style={localStyles.optionDescription} numberOfLines={2}>
                                        {target.description || translate('No delegation description configured')}
                                    </Text>
                                </View>
                            </TouchableOpacity>
                        )
                    })}
                </CustomScrollView>
                <View style={localStyles.actions}>
                    <Button
                        type="ghost"
                        onPress={closeModal}
                        title={translate('Cancel')}
                        buttonStyle={localStyles.actionButton}
                    />
                    <Button
                        type="primary"
                        onPress={handleSave}
                        title={translate('Save')}
                        buttonStyle={[localStyles.actionButton, localStyles.saveButton]}
                    />
                </View>
            </View>
        </View>
    )
}

const localStyles = StyleSheet.create({
    wrapper: {
        flexDirection: 'column',
    },
    container: {
        flexDirection: 'column',
        borderRadius: 4,
        backgroundColor: colors.Secondary400,
        shadowColor: 'rgba(78, 93, 120, 0.56)',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 1,
        shadowRadius: 16,
        elevation: 3,
        padding: 16,
        width: 360,
        maxWidth: 420,
    },
    scroll: {
        maxHeight: 360,
    },
    option: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        paddingVertical: 8,
    },
    optionTextContainer: {
        marginLeft: 12,
        flexShrink: 1,
    },
    optionLabel: {
        color: '#FFFFFF',
        fontWeight: '600',
    },
    optionDescription: {
        color: colors.Text03,
        marginTop: 2,
    },
    actions: {
        flexDirection: 'row',
        justifyContent: 'flex-end',
        marginTop: 12,
    },
    actionButton: {
        minWidth: 96,
        marginLeft: 0,
    },
    saveButton: {
        marginLeft: 8,
    },
    summary: {
        color: colors.Text03,
        marginBottom: 12,
    },
})
