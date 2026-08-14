import React, { useEffect, useMemo } from 'react'
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { useDispatch, useSelector } from 'react-redux'

import styles, { colors } from '../../styles/global'
import Icon from '../../Icon'
import Avatar from '../../Avatar'
import { translate } from '../../../i18n/TranslationService'
import { clearNoteOwnerFilters, setNoteOwnerFilters } from '../../../redux/actions'
import { collectNoteOwnerCounts, NOTE_OWNER_UNASSIGNED, resolveNoteOwner } from './noteOwnerFilterHelper'

/**
 * Owner filter for the notes list (AT-2194), modelled on
 * components/TaskListView/PriorityFilters/TaskFiltersLine.js.
 *
 * Chips are derived from the notes currently loaded for the project. Selecting an owner
 * narrows the list client-side; NotesView raises the fetch window while any filter is
 * active so the filtered list stays useful.
 */
export default function NoteOwnerFiltersLine({ projectId, notes, stickyNotes }) {
    const dispatch = useDispatch()
    const noteOwnerFilters = useSelector(state => state.noteOwnerFilters)
    const selectedProjectIndex = useSelector(state => state.selectedProjectIndex)

    const { counts, total, ownerIds } = useMemo(() => collectNoteOwnerCounts(notes, stickyNotes), [notes, stickyNotes])

    // Keep a selected owner visible even once their notes scroll out of the loaded window,
    // otherwise the chip disappears and the filter can no longer be switched off from here.
    const visibleOwnerIds = useMemo(() => {
        const merged = [...ownerIds]
        for (const ownerId of noteOwnerFilters) {
            if (!merged.includes(ownerId)) merged.push(ownerId)
        }
        return merged
    }, [ownerIds, noteOwnerFilters])

    const owners = useMemo(
        () =>
            visibleOwnerIds.map(ownerId => ({
                ownerId,
                count: counts[ownerId] || 0,
                data: resolveNoteOwner(projectId, ownerId),
            })),
        [visibleOwnerIds, counts, projectId]
    )

    // Reset when the board changes, and on unmount, so a filter can never leak into another
    // project's notes list or outlive the view (same lifecycle rules as TaskFiltersLine).
    useEffect(() => {
        dispatch(clearNoteOwnerFilters())
    }, [projectId, selectedProjectIndex])

    useEffect(() => {
        return () => {
            dispatch(clearNoteOwnerFilters())
        }
    }, [])

    // Nothing to filter when every loaded note has the same owner. An active filter always
    // keeps the row on screen, though: selecting an owner reloads the list with a wider
    // window, and a hashtag filter can leave the selected owner with zero loaded notes --
    // in both cases hiding the row would strand the user with a filter they cannot clear.
    if (noteOwnerFilters.length === 0 && visibleOwnerIds.length < 2) return null

    const toggleOwner = ownerId => {
        const next = noteOwnerFilters.includes(ownerId)
            ? noteOwnerFilters.filter(id => id !== ownerId)
            : [...noteOwnerFilters, ownerId]
        dispatch(next.length === 0 ? clearNoteOwnerFilters() : setNoteOwnerFilters(next))
    }

    const activeFilterCount = noteOwnerFilters.length

    return (
        <View style={localStyles.container} testID="note-owner-filters">
            <View style={localStyles.header}>
                <Icon name="filter" size={14} color={colors.Text03} style={localStyles.headerIcon} />
                <Text style={[styles.caption1, localStyles.headerText]}>{translate('Note Filters')}</Text>
            </View>

            <ScrollView
                horizontal={true}
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={localStyles.filtersRow}
                style={localStyles.filtersScroll}
                testID="note-owner-filters-horizontal-scroll"
            >
                <OwnerChip
                    selected={activeFilterCount === 0}
                    onPress={() => dispatch(clearNoteOwnerFilters())}
                    testID="note-owner-filter-all"
                    label={translate('All')}
                    count={total}
                />

                <View style={localStyles.group} testID="note-owner-filter-group">
                    {owners.map(({ ownerId, count, data }) => {
                        const selected = noteOwnerFilters.includes(ownerId)
                        if (count === 0 && !selected) return null
                        const isUnassigned = ownerId === NOTE_OWNER_UNASSIGNED
                        return (
                            <OwnerChip
                                key={ownerId}
                                selected={selected}
                                onPress={() => toggleOwner(ownerId)}
                                testID={`note-owner-filter-${ownerId}`}
                                label={isUnassigned ? translate('No owner') : data.displayName}
                                count={count}
                                avatarId={isUnassigned ? null : ownerId}
                                photoURL={data.photoURL}
                                isAssistant={data.isAssistant}
                            />
                        )
                    })}
                </View>
            </ScrollView>
        </View>
    )
}

function OwnerChip({ selected, onPress, testID, label, count, avatarId, photoURL, isAssistant }) {
    return (
        <TouchableOpacity
            style={[localStyles.filterItem, selected && localStyles.filterItemSelected]}
            onPress={onPress}
            testID={testID}
        >
            {avatarId != null && (
                <Avatar
                    avatarId={avatarId}
                    reviewerPhotoURL={photoURL}
                    size={14}
                    borderSize={1}
                    externalStyle={localStyles.avatar}
                />
            )}
            {isAssistant && (
                <Icon
                    name="cpu"
                    size={10}
                    color={selected ? '#ffffff' : colors.Text03}
                    style={localStyles.assistantIcon}
                />
            )}
            <Text style={[localStyles.filterName, selected && localStyles.filterNameSelected]} numberOfLines={1}>
                {label}
            </Text>
            <Text style={[localStyles.filterCount, selected && localStyles.filterCountSelected]}>{count}</Text>
        </TouchableOpacity>
    )
}

const localStyles = StyleSheet.create({
    container: { marginTop: 8, marginBottom: 8 },
    header: { minHeight: 24, flexDirection: 'row', alignItems: 'center' },
    headerIcon: { marginRight: 6 },
    headerText: { flex: 1, color: colors.Text03, marginRight: 8 },
    filtersScroll: { marginTop: 8 },
    filtersRow: { flexDirection: 'row', flexWrap: 'nowrap', alignItems: 'center' },
    group: { flexDirection: 'row', alignItems: 'center' },
    filterItem: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: colors.Grey200,
        borderRadius: 12,
        paddingHorizontal: 10,
        paddingVertical: 4,
        marginRight: 8,
        marginBottom: 8,
        maxWidth: 220,
    },
    filterItemSelected: { backgroundColor: colors.Primary200 },
    avatar: { marginRight: 6 },
    assistantIcon: { marginRight: 4 },
    filterName: { ...styles.caption1, color: colors.Text03, marginRight: 6 },
    filterNameSelected: { color: 'white' },
    filterCount: { ...styles.caption2, color: colors.Text03 },
    filterCountSelected: { color: 'white' },
})
