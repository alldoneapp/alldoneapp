import React, { useState } from 'react'
import { StyleSheet, View, Text, TouchableOpacity } from 'react-native'

import { colors } from '../../../styles/global'
import { applyPopoverWidth } from '../../../../utils/HelperFunctions'
import ModalHeader from '../ModalHeader'
import CustomScrollView from '../../../UIControls/CustomScrollView'
import CheckBox from '../../../CheckBox'
import Button from '../../../UIControls/Button'
import { translate } from '../../../../i18n/TranslationService'
import { getSkillRuntimeLabelKey } from '../../../AdminPanel/AssistantSkills/assistantSkillsHelper'

export default function AssistantSkillsModal({ skills, enabledSkillIds, onApply, closeModal }) {
    const [selectedSkills, setSelectedSkills] = useState(() => new Set(enabledSkillIds))

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
                        return (
                            <TouchableOpacity
                                key={skill.uid}
                                style={localStyles.option}
                                onPress={() => toggleSkill(skill.uid)}
                            >
                                <CheckBox checked={checked} />
                                <View style={localStyles.optionText}>
                                    <Text style={localStyles.optionLabel} numberOfLines={1}>
                                        {skill.displayName || skill.name}
                                        <Text style={localStyles.optionRuntime}>
                                            {`  ${translate(getSkillRuntimeLabelKey(skill))}`}
                                        </Text>
                                    </Text>
                                    <Text style={localStyles.optionDescription} numberOfLines={2}>
                                        {skill.description}
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
    optionText: {
        marginLeft: 12,
        flexShrink: 1,
    },
    optionLabel: {
        color: '#FFFFFF',
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
