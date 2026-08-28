import React, { useRef, useState } from 'react'
import { ActivityIndicator, StyleSheet, View, Text, TextInput, TouchableOpacity } from 'react-native'

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
    SKILL_SOURCE_UPLOAD,
} from './assistantSkillsHelper'
import {
    deleteAssistantSkill,
    getNewAssistantSkillId,
    updateAssistantSkill,
    uploadAssistantSkillBundleFile,
    uploadNewAssistantSkill,
} from '../../../utils/backends/AssistantSkills/assistantSkillsFirestore'
import SkillSourceInput from './SkillSourceInput'
import { GLOBAL_SKILL_CATALOG_ID as GLOBAL_PROJECT_ID } from '../../../utils/AssistantSkills/skillCatalog'
import { bytesToBase64 } from './skillDraftFromSource'

export default function EditAssistantSkill({ adding, skill, onClose, projectId = GLOBAL_PROJECT_ID }) {
    const [tmpSkill, setTmpSkill] = useState(() => (adding ? getNewDefaultAssistantSkill() : { ...skill }))
    const [confirmingDelete, setConfirmingDelete] = useState(false)
    // Bundle files carry their bytes only in memory until Save is pressed, so
    // reviewing a zip and then cancelling — or loading a different file over it
    // — writes nothing to Storage at all. (A Save that fails partway does leave
    // what it managed to upload; `bundleUploadRef` below is what stops a retry
    // from orphaning a second copy.)
    const [pendingBundleFiles, setPendingBundleFiles] = useState([])
    const [saving, setSaving] = useState(false)
    const [parsingSource, setParsingSource] = useState(false)
    const [uploadProgress, setUploadProgress] = useState(null)
    const [saveError, setSaveError] = useState('')
    // Survives a failed Save so a retry reuses the same skill id and keeps the
    // files that already made it to Storage. Re-allocating per attempt left a
    // full copy of the bundle orphaned under a dead id on every retry.
    const bundleUploadRef = useRef(null)

    const setField = (field, value) => {
        setTmpSkill(currentSkill => ({ ...currentSkill, [field]: value }))
    }

    const applyDraft = (draft, sourceMeta) => {
        const bundleFiles = Array.isArray(draft.files) ? draft.files : []
        setPendingBundleFiles(bundleFiles)
        // A second source starts a new bundle, so anything already uploaded for
        // the previous one is abandoned rather than mixed into it.
        bundleUploadRef.current = null
        setSaveError('')
        setTmpSkill(currentSkill => ({
            ...currentSkill,
            // Every field comes from the draft, including the empty ones. The
            // tempting `draft.name || currentSkill.name` leaves a half-applied
            // form when a second source is loaded over a first: load a zip, then
            // a bare markdown file with no frontmatter, and the name and
            // description would still be the zip's while the body and bundle are
            // the markdown's — a savable skill nobody described.
            name: draft.name,
            displayName: draft.displayName,
            description: draft.description,
            body: draft.body,
            // Kept without `storagePath` until the upload happens on Save; the
            // runtime badge only needs to know a bundle is present.
            files: bundleFiles.map(({ relativePath, size }) => ({ relativePath, size })),
            source: sourceMeta ? { ...sourceMeta, importedAt: Date.now() } : currentSkill.source,
        }))
    }

    const trimmedName = tmpSkill.name?.trim() || ''
    const nameIsValid = isValidSkillName(trimmedName)
    const descriptionIsTooLong = (tmpSkill.description?.length || 0) > MAX_SKILL_DESCRIPTION_LENGTH
    const canSave =
        nameIsValid && !!tmpSkill.displayName?.trim() && !!tmpSkill.description?.trim() && !descriptionIsTooLong

    // Resumable: the id is allocated once per bundle and each file's stored
    // result is remembered, so a Save that fails halfway (or a document write
    // that fails after every upload succeeded) re-uploads only what is missing
    // instead of orphaning a whole copy under a fresh id.
    const uploadPendingBundle = async () => {
        if (!bundleUploadRef.current) {
            bundleUploadRef.current = { skillId: getNewAssistantSkillId(), uploadedByPath: {} }
        }
        const { skillId, uploadedByPath } = bundleUploadRef.current

        for (let index = 0; index < pendingBundleFiles.length; index++) {
            const file = pendingBundleFiles[index]
            if (uploadedByPath[file.relativePath]) continue
            setUploadProgress({ current: index + 1, total: pendingBundleFiles.length })
            const stored = await uploadAssistantSkillBundleFile(
                skillId,
                1,
                file.relativePath,
                bytesToBase64(file.bytes),
                projectId
            )
            uploadedByPath[file.relativePath] = {
                relativePath: stored.relativePath,
                storagePath: stored.storagePath,
                size: stored.size,
            }
        }
        return { skillId, files: pendingBundleFiles.map(file => uploadedByPath[file.relativePath]) }
    }

    const save = async () => {
        // `parsingSource` blocks Save while a file is still being read: without
        // it, pressing Save mid-parse saves the PREVIOUS draft and unmounts the
        // form, and the file the admin just picked is silently discarded.
        if (!canSave || saving || parsingSource) return
        setSaving(true)
        setSaveError('')
        try {
            const skillToSave = {
                ...tmpSkill,
                name: trimmedName,
                displayName: tmpSkill.displayName.trim(),
                description: tmpSkill.description.trim(),
            }
            if (adding) {
                if (pendingBundleFiles.length > 0) {
                    // The id is allocated first because it is part of every
                    // bundled file's storage path.
                    const { skillId, files } = await uploadPendingBundle()
                    skillToSave.uid = skillId
                    skillToSave.version = 1
                    skillToSave.files = files
                }
                await uploadNewAssistantSkill(skillToSave, projectId)
            } else {
                skillToSave.version = (Number(skill.version) || 1) + 1
                await updateAssistantSkill(skillToSave, projectId)
            }
            onClose()
        } catch (error) {
            // Save used to be unguarded, so a failed write closed nothing and
            // said nothing. Keep the form open with the admin's input intact.
            setSaveError(`${translate('Saving skill failed')}: ${error?.message || error}`)
        } finally {
            setSaving(false)
            setUploadProgress(null)
        }
    }

    const removeSkill = async () => {
        try {
            await deleteAssistantSkill(skill.uid, projectId)
            onClose()
        } catch (error) {
            setSaveError(`${translate('Saving skill failed')}: ${error?.message || error}`)
        }
    }

    const isImported = tmpSkill.source?.type === 'import'
    const sourceFileName = tmpSkill.source?.type === SKILL_SOURCE_UPLOAD ? tmpSkill.source?.fileName : ''

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
            {!!sourceFileName && (
                <Text style={[styles.caption2, { color: colors.Text03, marginBottom: 8 }]}>
                    {`${translate('Imported from')}: ${sourceFileName}`}
                </Text>
            )}

            {adding && <SkillSourceInput onApplyDraft={applyDraft} onBusyChange={setParsingSource} disabled={saving} />}

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
            {!nameIsValid && !!tmpSkill.name && (
                <Text style={localStyles.fieldError} testID={'skill-name-error'}>
                    {translate('Skill name invalid hint')}
                </Text>
            )}

            <Text style={localStyles.label}>{translate('Skill description hint')}</Text>
            <TextInput
                value={tmpSkill.description}
                onChangeText={value => setField('description', value)}
                style={[localStyles.input, localStyles.multilineSmall, descriptionIsTooLong && localStyles.inputError]}
                placeholder={translate('Skill description hint')}
                multiline={true}
            />
            {descriptionIsTooLong && (
                <Text style={localStyles.fieldError} testID={'skill-description-error'}>
                    {translate('Skill description too long', { limit: MAX_SKILL_DESCRIPTION_LENGTH })}
                </Text>
            )}

            <Text style={localStyles.label}>{`${translate('Skill instructions')} (Markdown)`}</Text>
            <TextInput
                value={tmpSkill.body}
                onChangeText={value => setField('body', value)}
                style={[localStyles.input, localStyles.multilineLarge]}
                placeholder={translate('Skill instructions')}
                multiline={true}
            />

            {pendingBundleFiles.length > 0 && (
                <View style={localStyles.bundleSection} testID={'skill-bundle-summary'}>
                    <Text style={[styles.caption2, { color: colors.Text02 }]}>
                        {`${pendingBundleFiles.length} ${translate('bundled files')}: ${pendingBundleFiles
                            .map(file => file.relativePath)
                            .join(', ')}`}
                    </Text>
                </View>
            )}

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

            {!!saveError && (
                <Text style={localStyles.fieldError} testID={'skill-save-error'}>
                    {saveError}
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
                        disabled={saving}
                    />
                )}
                <View style={localStyles.actionsRight}>
                    {saving && (
                        <View style={localStyles.savingIndicator}>
                            <ActivityIndicator color={colors.Primary300} size="small" />
                            {!!uploadProgress && (
                                <Text style={[styles.caption2, { color: colors.Text02, marginLeft: 8 }]}>
                                    {translate('Uploading bundled file %{current} of %{total}', uploadProgress)}
                                </Text>
                            )}
                        </View>
                    )}
                    <Button type={'ghost'} title={translate('Cancel')} onPress={onClose} disabled={saving} />
                    <Button
                        type={'primary'}
                        title={translate('Save')}
                        onPress={save}
                        disabled={!canSave || saving || parsingSource}
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
    fieldError: {
        ...styles.caption2,
        color: colors.Red200,
        marginTop: 4,
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
    bundleSection: {
        marginTop: 10,
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
        alignItems: 'center',
        marginLeft: 'auto',
    },
    savingIndicator: {
        flexDirection: 'row',
        alignItems: 'center',
        marginRight: 12,
    },
})
