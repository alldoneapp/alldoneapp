import React, { useState } from 'react'
import { StyleSheet, View, Text, TouchableOpacity } from 'react-native'

import { colors } from '../../../styles/global'
import { applyPopoverWidth } from '../../../../utils/HelperFunctions'
import ModalHeader from '../ModalHeader'
import CustomScrollView from '../../../UIControls/CustomScrollView'
import CheckBox from '../../../CheckBox'
import Button from '../../../UIControls/Button'
import { translate } from '../../../../i18n/TranslationService'
import Icon from '../../../Icon'
import {
    getSkillPersonalOverlayLabel,
    getSkillRuntimeLabelKey,
    isTaskPrioritizationSkill,
} from '../../../AdminPanel/AssistantSkills/assistantSkillsHelper'
import TaskPriorityLearningOverlayModal from '../TaskPriorityLearningOverlayModal/TaskPriorityLearningOverlayModal'

export default function AssistantSkillsModal({ skills, enabledSkillIds, onApply, closeModal }) {
    const [selectedSkills, setSelectedSkills] = useState(() => new Set(enabledSkillIds))
    const [overlaySkill, setOverlaySkill] = useState(null)

    const toggleSkill = skillId => {
        setSelectedSkills(prev => {
            const next = new Set(prev)
            if (next.has(skillId)) {
                next.delete(skillId)
            } else {
                next.add(skillId)
            }
            return next
        })
    }

    const handleSave = () => {
        onApply(Array.from(selectedSkills))
        closeModal()
    }

    if (overlaySkill) {
        return (
            <TaskPriorityLearningOverlayModal
                skill={overlaySkill}
                closeModal={() => setOverlaySkill(null)}
            />
        )
    }

    return (
        <View style={localStyles.wrapper}>
            <View style={[localStyles.container, applyPopoverWidth()]}>
                <CustomScrollView style={localStyles.scroll} showsVerticalScrollIndicator={false}>
                    <ModalHeader
                        closeModal={closeModal}
                        title={translate('Enabled skills')}
                        description={translate('Select which skills the assistant can use')}
                    />
                    {skills.length === 0 && (
                        <Text style={localStyles.emptyText}>{translate('No skills in the catalog yet')}</Text>
                    )}
                    {skills.map(skill => {
                        const checked = selectedSkills.has(skill.uid)
                        const overlayLabel = getSkillPersonalOverlayLabel(skill)
                        const canEditOverlay = isTaskPrioritizationSkill(skill)
                        return (
                            <View key={skill.uid} style={localStyles.option}>
                                <TouchableOpacity style={localStyles.optionToggle} onPress={() => toggleSkill(skill.uid)}>
                                    <CheckBox checked={checked} />
                                    <View style={localStyles.optionText}>
                                        <View style={localStyles.optionLabelRow}>
                                            <Text style={localStyles.optionLabel} numberOfLines={1}>
                                                {skill.displayName || skill.name}
                                            </Text>
                                            {!!overlayLabel && (
                                                <View style={localStyles.overlayBadge}>
                                                    <Text style={localStyles.overlayBadgeText}>
                                                        {translate(overlayLabel)}
                                                    </Text>
                                                </View>
                                            )}
                                        </View>
                                        <Text style={localStyles.optionRuntime}>
                                            {translate(getSkillRuntimeLabelKey(skill))}
                                        </Text>
                                        <Text style={localStyles.optionDescription} numberOfLines={2}>
                                            {skill.description}
                                        </Text>
                                    </View>
                                </TouchableOpacity>
                                {canEditOverlay && (
                                    <TouchableOpacity
                                        style={localStyles.overlayButton}
                                        onPress={() => setOverlaySkill(skill)}
                                        accessible={false}
                                    >
                                        <Icon name="settings" size={18} color={colors.Text03} />
                                    </TouchableOpacity>
                                )}
                            </View>
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
        width: 320,
        maxWidth: 360,
    },
    scroll: {
        maxHeight: 320,
    },
    option: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        paddingVertical: 8,
    },
    optionToggle: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        flex: 1,
    },
    optionText: {
        marginLeft: 12,
        flexShrink: 1,
        flex: 1,
    },
    optionLabelRow: {
        flexDirection: 'row',
        alignItems: 'center',
        flexWrap: 'wrap',
    },
    optionLabel: {
        color: '#FFFFFF',
        marginRight: 6,
    },
    optionRuntime: {
        color: colors.Text03,
        fontSize: 12,
    },
    optionDescription: {
        color: colors.Text03,
        fontSize: 12,
    },
    emptyText: {
        color: colors.Text03,
        marginBottom: 8,
    },
    overlayBadge: {
        borderRadius: 4,
        backgroundColor: colors.UtilityGreen100,
        paddingHorizontal: 6,
        paddingVertical: 2,
    },
    overlayBadgeText: {
        color: colors.UtilityGreen300,
        fontSize: 11,
    },
    overlayButton: {
        width: 32,
        height: 32,
        alignItems: 'center',
        justifyContent: 'center',
        marginLeft: 8,
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
})
