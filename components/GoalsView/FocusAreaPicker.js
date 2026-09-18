import React, { useEffect, useId, useRef, useState } from 'react'
import { ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native'
import { useSelector } from 'react-redux'

import styles, { colors } from '../styles/global'
import Icon from '../Icon'
import ModalHeader from '../UIComponents/FloatModals/ModalHeader'
import { translate } from '../../i18n/TranslationService'
import { removeModal, storeModal } from '../ModalsManager/modalsManager'
import {
    MAX_FOCUS_AREA_NAME_LENGTH,
    focusAreaNameKey,
    getProjectFocusAreas,
    normalizeFocusAreaName,
} from '../../functions/shared/goalFocusAreas'
import { ensureProjectFocusArea, renameProjectFocusArea } from '../../utils/backends/Goals/goalFocusAreas'
import useEscapeKey from '../../hooks/useEscapeKey'
import useModalSizing from '../../hooks/useModalSizing'

export default function FocusAreaPicker({ projectId, selectedId, onChange, onClose }) {
    const { width, maxHeight } = useModalSizing()
    const catalog = useSelector(state => state.loggedUserProjectsMap?.[projectId]?.focusAreas)
    const [query, setQuery] = useState('')
    const [renaming, setRenaming] = useState(null)
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState('')
    const busyRef = useRef(false)
    const modalId = useId()
    const areas = getProjectFocusAreas(catalog)
    const name = normalizeFocusAreaName(query)
    const key = focusAreaNameKey(name)
    const exactMatch = areas.find(area => focusAreaNameKey(area.name) === key)
    const canCreate = name && key !== 'general' && !exactMatch

    useEffect(() => {
        storeModal(modalId)
        return () => removeModal(modalId)
    }, [modalId])

    const perform = async action => {
        if (busyRef.current) return
        busyRef.current = true
        setBusy(true)
        setError('')
        try {
            await action()
        } catch (error) {
            setError(
                translate(
                    error.code === 'focus-area-duplicate-name'
                        ? 'A focus area with this name already exists'
                        : error.code === 'focus-area-reserved-name'
                          ? 'General is reserved for goals without a focus area'
                          : 'Could not save the focus area. Please try again.'
                )
            )
        } finally {
            busyRef.current = false
            setBusy(false)
        }
    }

    const select = areaId =>
        perform(async () => {
            await onChange(areaId || null)
            onClose()
        })

    const create = () =>
        perform(async () => {
            const area = await ensureProjectFocusArea(projectId, name)
            await onChange(area.id)
            onClose()
        })

    const rename = () =>
        perform(async () => {
            await renameProjectFocusArea(projectId, renaming.id, name)
            setRenaming(null)
            setQuery('')
        })

    const cancelRename = () => {
        setRenaming(null)
        setQuery('')
        setError('')
    }

    useEscapeKey(() => {
        if (!busyRef.current) renaming ? cancelRename() : onClose()
    })

    return (
        <div
            onKeyDown={event => {
                // Goal editors also submit on document Enter. The picker owns
                // its keys so creating an area cannot accidentally create a goal.
                event.stopPropagation()
            }}
        >
            <View style={[localStyles.container, { width, maxHeight }]}>
                <ModalHeader
                    disabledEscape
                    closeModal={busy ? () => {} : onClose}
                    title={translate(renaming ? 'Rename focus area' : 'Focus area')}
                    description={translate(
                        renaming
                            ? 'This name changes for all goals in this project'
                            : 'Select or create a focus area for this project'
                    )}
                />
                <TextInput
                    autoFocus
                    accessibilityLabel={translate(renaming ? 'Focus area name' : 'Select or create a focus area')}
                    placeholder={translate('Select or create a focus area')}
                    placeholderTextColor={colors.Text03}
                    style={localStyles.input}
                    value={query}
                    onChangeText={setQuery}
                    maxLength={MAX_FOCUS_AREA_NAME_LENGTH}
                    editable={!busy}
                    onSubmitEditing={() => {
                        if (renaming && name) rename()
                        else if (exactMatch) select(exactMatch.id)
                        else if (key === 'general') select(null)
                        else if (canCreate) create()
                    }}
                />
                {renaming ? (
                    <View style={localStyles.renameActions}>
                        <TouchableOpacity
                            accessibilityRole="button"
                            onPress={cancelRename}
                            disabled={busy}
                            style={localStyles.option}
                        >
                            <Text style={localStyles.text}>{translate('Cancel')}</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                            accessibilityRole="button"
                            onPress={rename}
                            disabled={busy || !name}
                            style={localStyles.option}
                        >
                            <Text style={localStyles.text}>{translate('Save')}</Text>
                        </TouchableOpacity>
                    </View>
                ) : (
                    <ScrollView style={localStyles.options} keyboardShouldPersistTaps="handled">
                        <TouchableOpacity
                            accessibilityRole="button"
                            style={localStyles.option}
                            disabled={busy}
                            onPress={() => select(null)}
                        >
                            <Text style={localStyles.text}>{translate('None (General)')}</Text>
                            {!selectedId && <Icon name="check" size={20} color={colors.Primary200} />}
                        </TouchableOpacity>
                        {areas
                            .filter(area => focusAreaNameKey(area.name).includes(key))
                            .map(area => (
                                <View key={area.id} style={localStyles.row}>
                                    <TouchableOpacity
                                        accessibilityRole="button"
                                        style={[localStyles.option, { flex: 1 }]}
                                        disabled={busy}
                                        onPress={() => select(area.id)}
                                    >
                                        <Text style={localStyles.text}>{area.name}</Text>
                                        {selectedId === area.id && (
                                            <Icon name="check" size={20} color={colors.Primary200} />
                                        )}
                                    </TouchableOpacity>
                                    <TouchableOpacity
                                        accessibilityRole="button"
                                        accessibilityLabel={`${translate('Rename focus area')}: ${area.name}`}
                                        style={localStyles.renameButton}
                                        disabled={busy}
                                        onPress={() => {
                                            setRenaming(area)
                                            setQuery(area.name)
                                            setError('')
                                        }}
                                    >
                                        <Icon name="edit-2" size={16} color={colors.Text03} />
                                    </TouchableOpacity>
                                </View>
                            ))}
                        {!!canCreate && (
                            <TouchableOpacity
                                accessibilityRole="button"
                                style={localStyles.option}
                                disabled={busy}
                                onPress={create}
                            >
                                <Text style={localStyles.text}>{translate('Create focus area named', { name })}</Text>
                                <Icon name="plus" size={20} color={colors.Primary200} />
                            </TouchableOpacity>
                        )}
                    </ScrollView>
                )}
                {!!error && (
                    <Text accessibilityRole="alert" style={localStyles.error}>
                        {error}
                    </Text>
                )}
                {busy && (
                    <Text accessibilityLiveRegion="polite" style={localStyles.status}>
                        {translate('Saving focus area')}
                    </Text>
                )}
            </View>
        </div>
    )
}

const localStyles = StyleSheet.create({
    container: { backgroundColor: colors.Secondary400, borderRadius: 4, padding: 16, maxWidth: '100%' },
    input: {
        ...styles.body1,
        color: '#ffffff',
        borderWidth: 1,
        borderColor: colors.Text03,
        borderRadius: 4,
        padding: 10,
        marginBottom: 8,
    },
    options: { maxHeight: 280, flexShrink: 1 },
    row: { flexDirection: 'row', alignItems: 'center' },
    option: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        minHeight: 44,
        paddingVertical: 10,
        paddingHorizontal: 4,
    },
    text: { ...styles.subtitle2, color: '#ffffff', flexShrink: 1, marginRight: 8 },
    renameButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
    renameActions: { flexDirection: 'row', justifyContent: 'space-between' },
    error: { ...styles.body2, color: colors.UtilityRed150, marginTop: 8 },
    status: { ...styles.body2, color: '#ffffff', marginTop: 8 },
})
