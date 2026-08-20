import React from 'react'
import { StyleSheet, View } from 'react-native'

import GhostBlock from '../UIComponents/Ghosts/GhostBlock'
import { useGhostPulse } from '../UIComponents/Ghosts/ghostAnimation'
import { GHOST_DEFAULT_ROWS } from '../UIComponents/Ghosts/ghostRowCount'
import { translate } from '../../i18n/TranslationService'

// Cycled so a multi-row ghost does not look like a stack of identical bars. The pairs are
// (title, preview) widths; the meta line is fixed because the real one always renders the
// same "Edited: … • name • N views" shape.
const ROW_WIDTHS = [
    ['58%', '82%'],
    ['74%', '61%'],
    ['46%', '90%'],
    ['66%', '73%'],
]

/**
 * AT-2382 — note-shaped loading ghosts for the notes list "Show more".
 *
 * The geometry mirrors `NotesItem`'s exactly (8px padding, 24px title row, 32px preview
 * block, 20px meta block = the 92px `maxHeight` that component declares), so replacing a
 * ghost with the real row moves nothing on screen. When these numbers are touched,
 * `NotesItem.js`'s `localStyles` is the source of truth to re-check against.
 */
export default function NotesListSkeleton({ rowCount = GHOST_DEFAULT_ROWS, noteKeys = [] }) {
    const { pulse, reducedMotion } = useGhostPulse()
    const rows = Array.from({ length: Math.max(0, rowCount) })

    return (
        <View
            testID="notes-list-loading-skeleton"
            accessibilityRole="progressbar"
            accessibilityLabel={translate('Loading notes')}
        >
            {rows.map((_, index) => {
                const [titleWidth, previewWidth] = ROW_WIDTHS[index % ROW_WIDTHS.length]
                return (
                    <View key={noteKeys[index] || index} testID="note-loading-skeleton-row" style={localStyles.row}>
                        <View style={localStyles.titleRow}>
                            <GhostBlock style={localStyles.icon} pulse={pulse} reducedMotion={reducedMotion} />
                            <View style={localStyles.titleContainer}>
                                <GhostBlock
                                    style={[localStyles.title, { width: titleWidth }]}
                                    pulse={pulse}
                                    reducedMotion={reducedMotion}
                                />
                            </View>
                            <GhostBlock style={localStyles.avatar} pulse={pulse} reducedMotion={reducedMotion} />
                        </View>
                        <View style={localStyles.previewRow}>
                            <GhostBlock
                                style={[localStyles.preview, { width: previewWidth }]}
                                pulse={pulse}
                                reducedMotion={reducedMotion}
                                soft
                            />
                        </View>
                        <View style={localStyles.metaRow}>
                            <GhostBlock style={localStyles.meta} pulse={pulse} reducedMotion={reducedMotion} soft />
                        </View>
                    </View>
                )
            })}
        </View>
    )
}

const localStyles = StyleSheet.create({
    // NotesItem.localStyles.container, minus the swipe/press affordances a ghost has no
    // use for. The negative horizontal margin + matching padding is what keeps the ghost
    // aligned with the real rows inside the notes list's own padding.
    row: {
        paddingTop: 8,
        paddingBottom: 8,
        marginHorizontal: -8,
        paddingHorizontal: 8,
        borderRadius: 4,
    },
    titleRow: {
        height: 24,
        flexDirection: 'row',
        alignItems: 'center',
    },
    icon: {
        width: 24,
        height: 24,
        borderRadius: 6,
    },
    // NotesItem gives the title wrapper `marginHorizontal: 12`.
    titleContainer: {
        flex: 1,
        minWidth: 0,
        marginHorizontal: 12,
    },
    title: {
        height: 12,
        borderRadius: 6,
    },
    avatar: {
        width: 20,
        height: 20,
        borderRadius: 10,
        marginLeft: 8,
    },
    // notePreview: marginLeft 28 + the inner wrapper's marginLeft 8 = text starts at 36.
    previewRow: {
        height: 32,
        justifyContent: 'center',
        marginLeft: 36,
    },
    preview: {
        height: 12,
        borderRadius: 6,
    },
    // LastEditionData.dateAndSubHint: marginLeft 36, maxHeight 20, paddingBottom 6.
    metaRow: {
        height: 20,
        justifyContent: 'flex-start',
        paddingTop: 2,
        marginLeft: 36,
    },
    meta: {
        width: '38%',
        height: 10,
        borderRadius: 5,
    },
})
