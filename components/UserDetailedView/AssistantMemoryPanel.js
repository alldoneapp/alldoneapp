import React, { useEffect, useState } from 'react'
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native'

import styles, { colors } from '../styles/global'
import { translate } from '../../i18n/TranslationService'
import Switch from '../UIControls/Switch'
import { getAssistantMemory, updateAssistantMemory } from '../../utils/backends/firestore'

// security audit 2026-11 (NV-20): what the assistant remembers about a user used to be written
// into this very profile note, which every project member can edit - so a teammate could plant
// instructions into somebody else's assistant. The memory now lives in a server-only store and is
// shown here, above the note, through a callable: the owner sees and edits it and decides whether
// project members may see it; a member sees it read-only, and only when the owner shared it. The
// note itself is never read back as memory.
export default function AssistantMemoryPanel({ projectId, userId, loggedUserId }) {
    const [memory, setMemory] = useState(null)
    const [error, setError] = useState('')
    const [expanded, setExpanded] = useState(false)
    const [editing, setEditing] = useState(false)
    const [draft, setDraft] = useState('')
    const [saving, setSaving] = useState(false)

    useEffect(() => {
        let mounted = true
        setMemory(null)
        setError('')
        setEditing(false)
        if (!projectId || !userId || !loggedUserId) return undefined
        getAssistantMemory(projectId, userId)
            .then(result => {
                if (mounted) setMemory(result || null)
            })
            .catch(() => {
                // Only the owner is told about a failed load; for anybody else "not shared" and
                // "could not load" look the same, which is the point.
                if (mounted && userId === loggedUserId) setError(translate('Could not load the assistant memory.'))
            })
        return () => {
            mounted = false
        }
    }, [projectId, userId, loggedUserId])

    const save = async changes => {
        setSaving(true)
        setError('')
        try {
            const result = await updateAssistantMemory(projectId, changes)
            setMemory(result || null)
            setEditing(false)
        } catch (saveError) {
            setError(translate('Could not save the assistant memory.'))
        } finally {
            setSaving(false)
        }
    }

    if (error && !memory) {
        return (
            <View style={localStyles.container} testID="assistant-memory-panel">
                <Text style={localStyles.error}>{error}</Text>
            </View>
        )
    }
    if (!memory || !memory.visible) return null

    const { isOwner, content, shareWithProjectMembers } = memory
    const hasContent = !!String(content || '').trim()

    return (
        <View style={localStyles.container} testID="assistant-memory-panel">
            <View style={localStyles.header}>
                <View style={localStyles.headerText}>
                    <Text style={[styles.subtitle1, { color: colors.Text01 }]}>{translate('Assistant memory')}</Text>
                    <Text style={[styles.caption1, { color: colors.Text03 }]}>
                        {isOwner
                            ? shareWithProjectMembers
                                ? translate('Project members can see this memory, read-only.')
                                : translate('Only you can see what your assistant remembers about you in this project.')
                            : translate('Shared by its owner. Read-only.')}
                    </Text>
                </View>
                <TouchableOpacity
                    accessibilityRole="button"
                    testID="assistant-memory-toggle"
                    onPress={() => setExpanded(!expanded)}
                >
                    <Text style={[styles.subtitle2, { color: colors.Primary100 }]}>
                        {expanded ? translate('Hide memory') : translate('Show memory')}
                    </Text>
                </TouchableOpacity>
            </View>

            {expanded && (
                <View style={localStyles.body}>
                    {editing ? (
                        <>
                            <TextInput
                                testID="assistant-memory-input"
                                multiline
                                value={draft}
                                onChangeText={setDraft}
                                style={[styles.body2, localStyles.input]}
                            />
                            <View style={localStyles.actions}>
                                <TouchableOpacity
                                    testID="assistant-memory-save"
                                    disabled={saving}
                                    onPress={() => save({ content: draft })}
                                >
                                    <Text style={[styles.subtitle2, { color: colors.Primary100 }]}>
                                        {translate('Save memory')}
                                    </Text>
                                </TouchableOpacity>
                                <TouchableOpacity disabled={saving} onPress={() => setEditing(false)}>
                                    <Text style={[styles.subtitle2, { color: colors.Text03 }]}>
                                        {translate('Cancel editing')}
                                    </Text>
                                </TouchableOpacity>
                            </View>
                        </>
                    ) : (
                        <Text testID="assistant-memory-content" style={[styles.body2, { color: colors.Text02 }]}>
                            {hasContent
                                ? content
                                : translate(
                                      'Your assistant has not remembered anything about you in this project yet.'
                                  )}
                        </Text>
                    )}

                    {isOwner && !editing && (
                        <View style={localStyles.ownerControls}>
                            <TouchableOpacity
                                testID="assistant-memory-edit"
                                disabled={saving}
                                onPress={() => {
                                    setDraft(content || '')
                                    setEditing(true)
                                }}
                            >
                                <Text style={[styles.subtitle2, { color: colors.Primary100 }]}>
                                    {translate('Edit memory')}
                                </Text>
                            </TouchableOpacity>
                            <View style={localStyles.shareRow}>
                                <Switch
                                    active={!!shareWithProjectMembers}
                                    disabled={saving}
                                    activeSwitch={() => save({ shareWithProjectMembers: true })}
                                    deactiveSwitch={() => save({ shareWithProjectMembers: false })}
                                />
                                <Text style={[styles.body2, localStyles.shareLabel]}>
                                    {translate(
                                        'Show my assistant memory in my profile note (read-only for project members)'
                                    )}
                                </Text>
                            </View>
                        </View>
                    )}
                    {!!error && <Text style={localStyles.error}>{error}</Text>}
                </View>
            )}
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        marginTop: 16,
        paddingHorizontal: 16,
        paddingVertical: 12,
        borderRadius: 4,
        borderWidth: 1,
        borderColor: colors.Grey300,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    headerText: {
        flex: 1,
        marginRight: 12,
    },
    body: {
        marginTop: 12,
        maxHeight: 320,
        overflow: 'auto',
    },
    input: {
        minHeight: 120,
        borderWidth: 1,
        borderColor: colors.Grey300,
        borderRadius: 4,
        padding: 8,
        color: colors.Text01,
    },
    actions: {
        flexDirection: 'row',
        marginTop: 8,
        gap: 16,
    },
    ownerControls: {
        marginTop: 12,
        gap: 12,
    },
    shareRow: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    shareLabel: {
        marginLeft: 8,
        flex: 1,
        color: colors.Text02,
    },
    error: {
        ...styles.caption1,
        color: colors.UtilityRed200,
        marginTop: 8,
    },
})
