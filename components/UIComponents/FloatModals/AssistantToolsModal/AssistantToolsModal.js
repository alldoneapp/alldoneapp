import React, { useState } from 'react'
import { StyleSheet, View, Text, TouchableOpacity } from 'react-native'

import { colors } from '../../../styles/global'
import { applyPopoverWidth } from '../../../../utils/HelperFunctions'
import ModalHeader from '../ModalHeader'
import CustomScrollView from '../../../UIControls/CustomScrollView'
import CheckBox from '../../../CheckBox'
import Button from '../../../UIControls/Button'
import { translate } from '../../../../i18n/TranslationService'
import { TOOL_OPTIONS, TOOL_LABEL_BY_KEY } from '../../../AssistantDetailedView/Customizations/ToolsAccess/toolOptions'

export default function AssistantToolsModal({ allowedTools, onApply, closeModal }) {
    const [selectedTools, setSelectedTools] = useState(() => new Set(allowedTools))

    const toggleTool = key => {
        setSelectedTools(prev => {
            const next = new Set(prev)
            if (next.has(key)) {
                next.delete(key)
            } else {
                next.add(key)
            }
            return next
        })
    }

    const handleSave = () => {
        onApply(Array.from(selectedTools))
        closeModal()
    }

    const handleCancel = () => {
        closeModal()
    }

    const selectedArray = Array.from(selectedTools)
    const noneSelected = selectedArray.length === 0
    const allSelected = selectedArray.length === TOOL_OPTIONS.length

    const selectionSummary = noneSelected
        ? translate('No tools enabled')
        : allSelected
        ? translate('All tools enabled')
        : selectedArray.map(key => translate(TOOL_LABEL_BY_KEY[key] || key)).join(', ')

    return (
        <View style={localStyles.wrapper}>
            <View style={[localStyles.container, applyPopoverWidth()]}>
                <CustomScrollView style={localStyles.scroll} showsVerticalScrollIndicator={false}>
                    <ModalHeader
                        closeModal={closeModal}
                        title={translate('Allowed tools')}
                        description={translate('Select which tools the assistant can use')}
                    />
                    <Text style={localStyles.summary} numberOfLines={2}>
                        {selectionSummary}
                    </Text>
                    {TOOL_OPTIONS.map(option => {
                        const checked = selectedTools.has(option.key)
                        return (
                            <TouchableOpacity
                                key={option.key}
                                style={localStyles.option}
                                onPress={() => toggleTool(option.key)}
                            >
                                <CheckBox checked={checked} />
                                <Text style={localStyles.optionLabel}>{translate(option.labelKey)}</Text>
                            </TouchableOpacity>
                        )
                    })}
                </CustomScrollView>
                <View style={localStyles.actions}>
                    <Button
                        type="ghost"
                        onPress={handleCancel}
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
        width: 320,
        maxWidth: 360,
    },
    scroll: {
        maxHeight: 280,
    },
    option: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 8,
    },
    optionLabel: {
        marginLeft: 12,
        color: '#FFFFFF',
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
