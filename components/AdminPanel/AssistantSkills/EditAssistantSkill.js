import React, { useState } from 'react'
import { StyleSheet, View, Text, TextInput, TouchableOpacity } from 'react-native'

import styles, { colors } from '../../styles/global'
import Button from '../../UIControls/Button'
import CheckBox from '../../CheckBox'
import { translate } from '../../../i18n/TranslationService'
import {
    getNewDefaultAssistantSkill,
    isValidSkillName,
    isVmOnlySkill,
    getSkillRuntimeLabelKey,
    MAX_SKILL_DESCRIPTION_LENGTH,
} from './assistantSkillsHelper'
import {
    deleteAssistantSkill,
    updateAssistantSkill,
    uploadNewAssistantSkill,
} from '../../../utils/backends/AssistantSkills/assistantSkillsFirestore'

export default function EditAssistantSkill({ adding, skill, onClose }) {
    const [tmpSkill, setTmpSkill] = useState(() => (adding ? getNewDefaultAssistantSkill() : { ...skill }))
    const [confirmingDelete, setConfirmingDelete] = useState(false)

    const setField = (field, value) => {
        setTmpSkill(currentSkill => ({ ...currentSkill, [field]: value }))
    }

    const nameIsValid = isValidSkillName(tmpSkill.name?.trim())
    const canSave =
        nameIsValid &&
        !!tmpSkill.displayName?.trim() &&
        !!tmpSkill.description?.trim() &&
        tmpSkill.description.length <= MAX_SKILL_DESCRIPTION_LENGTH

    const save = async () => {
        if (!canSave) return
        const skillToSave = {
            ...tmpSkill,
            name: tmpSkill.name.trim(),
            displayName: tmpSkill.displayName.trim(),
            description: tmpSkill.description.trim(),
        }
        if (adding) {
            await uploadNewAssistantSkill(skillToSave)
        } else {
            skillToSave.version = (Number(skill.version) || 1) + 1
            await updateAssistantSkill(skillToSave)
        }
        onClose()
    }

    const removeSkill = async () => {
        await deleteAssistantSkill(skill.uid)
        onClose()
    }

    const isImported = tmpSkill.source?.type === 'import'

    return (
        <View style={localStyles.container}>
            <Text style={[styles.subtitle1, { color: colors.Text01, marginBottom: 12 }]}>
                {translate(adding ? 'Add skill' : 'Edit skill')}
            </Text>
            {isImported && (
                <Text style={[styles.caption2, { color: colors.Text03, marginBottom: 8 }]}>
                    {`${translate('Imported from')}: ${tmpSkill.source?.repoUrl || ''} @ ${(
                        tmpSkill.source?.sha || ''
                    ).slice(0, 7)}`}
                </Text>
            )}

            <Text style={localStyles.label}>{translate('Display name')}</Text>
            <TextInput
                value={tmpSkill.displayName}
                onChangeText={value => setField('displayName', value)}
                style={localStyles.input}
                placeholder={translate('Display name')}
            />

            <Text style={localStyles.label}>{`${translate('Skill name')} (a-z, 0-9, -)`}</Text>
            <TextInput
                value={tmpSkill.name}
                onChangeText={value => setField('name', value.toLowerCase())}
                style={[localStyles.input, !nameIsValid && !!tmpSkill.name && localStyles.inputError]}
                placeholder={'my-skill-name'}
                autoCapitalize={'none'}
                autoCorrect={false}
            />

            <Text style={localStyles.label}>{translate('Skill description hint')}</Text>
            <TextInput
                value={tmpSkill.description}
                onChangeText={value => setField('description', value)}
                style={[localStyles.input, localStyles.multilineSmall]}
                placeholder={translate('Skill description hint')}
                multiline={true}
            />

            <Text style={localStyles.label}>{`${translate('Skill instructions')} (Markdown)`}</Text>
            <TextInput
                value={tmpSkill.body}
                onChangeText={value => setField('body', value)}
                style={[localStyles.input, localStyles.multilineLarge]}
                placeholder={translate('Skill instructions')}
                multiline={true}
            />

            <TouchableOpacity style={localStyles.enabledRow} onPress={() => setField('enabled', !tmpSkill.enabled)}>
                <CheckBox checked={tmpSkill.enabled !== false} />
                <Text style={[styles.body2, { color: colors.Text01, marginLeft: 8 }]}>{translate('Enabled')}</Text>
                <View style={localStyles.runtimeBadge}>
                    <Text style={[styles.caption2, { color: colors.Text02 }]}>
                        {translate(getSkillRuntimeLabelKey(tmpSkill))}
                    </Text>
                </View>
            </TouchableOpacity>
            {isVmOnlySkill(tmpSkill) && (
                <Text style={[styles.caption2, { color: colors.Text03, marginBottom: 8 }]}>
                    {translate('VM only skill hint')}
                </Text>
            )}

            <View style={localStyles.actions}>
                {!adding && (
                    <Button
                        type={'ghost'}
                        icon={'trash-2'}
                        title={translate(confirmingDelete ? 'Confirm delete' : 'Delete')}
                        onPress={() => (confirmingDelete ? removeSkill() : setConfirmingDelete(true))}
                        buttonStyle={localStyles.deleteButton}
                    />
                )}
                <View style={localStyles.actionsRight}>
                    <Button type={'ghost'} title={translate('Cancel')} onPress={onClose} />
                    <Button
                        type={'primary'}
                        title={translate('Save')}
                        onPress={save}
                        disabled={!canSave}
                        buttonStyle={{ marginLeft: 8 }}
                    />
                </View>
            </View>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        borderWidth: 1,
        borderColor: colors.Grey200,
        borderRadius: 4,
        padding: 16,
        marginBottom: 16,
        backgroundColor: '#ffffff',
    },
    label: {
        ...styles.caption2,
        color: colors.Text03,
        marginBottom: 4,
        marginTop: 8,
    },
    input: {
        ...styles.body1,
        fontWeight: 400,
        color: colors.Text01,
        borderWidth: 1,
        borderRadius: 4,
        borderColor: colors.Gray400,
        paddingHorizontal: 12,
        paddingVertical: 8,
    },
    inputError: {
        borderColor: colors.Red200,
    },
    multilineSmall: {
        minHeight: 60,
        textAlignVertical: 'top',
    },
    multilineLarge: {
        minHeight: 240,
        textAlignVertical: 'top',
        fontFamily: 'monospace',
    },
    enabledRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginTop: 16,
        marginBottom: 8,
    },
    runtimeBadge: {
        borderWidth: 1,
        borderColor: colors.Grey300,
        borderRadius: 12,
        paddingHorizontal: 8,
        paddingVertical: 2,
        marginLeft: 12,
    },
    actions: {
        flexDirection: 'row',
        alignItems: 'center',
        marginTop: 16,
    },
    deleteButton: {
        marginRight: 'auto',
    },
    actionsRight: {
        flexDirection: 'row',
        marginLeft: 'auto',
    },
})
