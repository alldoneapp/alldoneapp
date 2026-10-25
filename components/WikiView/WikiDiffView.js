import React, { useMemo, useState } from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'

import styles, { colors } from '../styles/global'
import { translate } from '../../i18n/TranslationService'
import { buildWikiDiff } from './wikiDiff'

const ROW_STYLES = {
    added: { sign: '+', row: 'addedRow', highlight: 'addedHighlight' },
    removed: { sign: '−', row: 'removedRow', highlight: 'removedHighlight' },
    equal: { sign: ' ', row: null, highlight: null },
}

function DiffLine({ row }) {
    const config = ROW_STYLES[row.kind]
    return (
        <View
            testID={`wiki-diff-${row.kind}`}
            style={[localStyles.row, config.row && localStyles[config.row]]}
            accessibilityLabel={row.kind === 'equal' ? undefined : translate(`Wiki diff ${row.kind}`)}
        >
            <Text style={localStyles.sign}>{config.sign}</Text>
            <Text style={[localStyles.text, row.kind === 'equal' && localStyles.equalText]}>
                {row.segments
                    ? row.segments.map((segment, index) => (
                          <Text key={index} style={segment.changed ? localStyles[config.highlight] : null}>
                              {segment.text}
                          </Text>
                      ))
                    : // A blank line still needs its height, or a removed empty line is invisible.
                      row.text || ' '}
            </Text>
        </View>
    )
}

// A line diff as a reader sees it: removed lines in red, added ones in green, the words that changed
// inside an edited line highlighted (and struck through on the removed side), unchanged stretches
// folded away until opened.
export default function WikiDiffView({ before, after, testID = 'wiki-diff' }) {
    const diff = useMemo(() => buildWikiDiff(before, after), [before, after])
    const [openedSkips, setOpenedSkips] = useState(() => new Set())

    if (diff.unchanged) return <Text style={localStyles.unchanged}>{translate('No text changes')}</Text>

    const openSkip = id => setOpenedSkips(current => new Set([...current, id]))

    return (
        <View testID={testID} style={localStyles.container}>
            {diff.rows.map((row, index) => {
                if (row.kind !== 'skip') return <DiffLine key={index} row={row} />
                if (openedSkips.has(row.id)) {
                    return row.rows.map((hiddenRow, hiddenIndex) => (
                        <DiffLine key={`${row.id}-${hiddenIndex}`} row={hiddenRow} />
                    ))
                }
                return (
                    <TouchableOpacity
                        key={row.id}
                        testID={`wiki-diff-skip-${row.id}`}
                        style={localStyles.skip}
                        onPress={() => openSkip(row.id)}
                        accessible={false}
                    >
                        <Text style={localStyles.skipText}>
                            {translate('Wiki diff unchanged lines', { amount: row.count })}
                        </Text>
                    </TouchableOpacity>
                )
            })}
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        borderWidth: 1,
        borderColor: colors.Grey300,
        borderRadius: 4,
        overflow: 'hidden',
    },
    row: {
        flexDirection: 'row',
        paddingVertical: 2,
        paddingRight: 8,
    },
    addedRow: {
        backgroundColor: colors.UtilityGreen100,
    },
    removedRow: {
        backgroundColor: colors.UtilityRed100,
    },
    sign: {
        ...styles.body2,
        width: 20,
        textAlign: 'center',
        color: colors.Text03,
    },
    text: {
        ...styles.body2,
        color: colors.Text01,
        flex: 1,
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
    },
    equalText: {
        color: colors.Text02,
    },
    addedHighlight: {
        backgroundColor: colors.UtilityGreen150,
    },
    removedHighlight: {
        backgroundColor: colors.UtilityRed150,
        textDecorationLine: 'line-through',
    },
    skip: {
        backgroundColor: colors.Grey200,
        paddingVertical: 4,
        paddingHorizontal: 28,
    },
    skipText: {
        ...styles.caption2,
        color: colors.Primary100,
    },
    unchanged: {
        ...styles.body2,
        color: colors.Text03,
    },
})
