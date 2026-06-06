import React from 'react'
import { Platform, ScrollView, StyleSheet, Text, View } from 'react-native'

import { colors } from '../../../styles/global'
import { parseInlineFormatting } from './markdownParserFunctions'

/**
 * Renders a parsed markdown table as a React Native component.
 * Used in chat messages and feed comments.
 *
 * @param {object} props
 * @param {string[][]} props.rows - Array of rows; first row is the header
 * @param {(string|null)[]} props.alignments - Per-column alignment: 'left', 'center', 'right', or null
 * @param {object} [props.textStyle] - Base text style to apply to cell content
 */
export default function MarkdownTable({ rows, alignments, textStyle }) {
    if (!rows || rows.length === 0) return null

    const renderCellContent = (cellText, isHeader) => {
        const segments = parseInlineFormatting(cellText)
        return segments.map((segment, idx) => (
            <Text
                key={idx}
                style={[
                    textStyle || localStyles.cellText,
                    isHeader && localStyles.headerText,
                    segment.bold && { fontWeight: 'bold' },
                    segment.italic && { fontStyle: 'italic' },
                    segment.strikethrough && { textDecorationLine: 'line-through' },
                ]}
            >
                {segment.text}
            </Text>
        ))
    }

    const getAlignStyle = colIndex => {
        const align = alignments && alignments[colIndex]
        if (align === 'center') return { textAlign: 'center' }
        if (align === 'right') return { textAlign: 'right' }
        return null
    }

    return (
        <ScrollView horizontal style={localStyles.scrollContainer} showsHorizontalScrollIndicator={false}>
            <View style={localStyles.table}>
                {rows.map((row, rowIndex) => {
                    const isHeader = rowIndex === 0
                    return (
                        <View key={rowIndex} style={localStyles.row}>
                            {row.map((cell, colIndex) => (
                                <View
                                    key={colIndex}
                                    style={[
                                        localStyles.cell,
                                        isHeader && localStyles.headerCell,
                                        colIndex === 0 && localStyles.firstCell,
                                    ]}
                                >
                                    <Text style={[localStyles.cellTextWrapper, getAlignStyle(colIndex)]}>
                                        {renderCellContent(cell, isHeader)}
                                    </Text>
                                </View>
                            ))}
                        </View>
                    )
                })}
            </View>
        </ScrollView>
    )
}

const localStyles = StyleSheet.create({
    scrollContainer: {
        marginVertical: 8,
        maxWidth: '100%',
    },
    table: {
        borderWidth: 1,
        borderColor: '#d7dff0',
        borderRadius: 4,
        overflow: 'hidden',
        ...(Platform.OS === 'web' ? { borderCollapse: 'collapse' } : {}),
    },
    row: {
        flexDirection: 'row',
    },
    cell: {
        minWidth: 96,
        maxWidth: 280,
        borderWidth: 0.5,
        borderColor: '#d7dff0',
        paddingHorizontal: 10,
        paddingVertical: 8,
    },
    headerCell: {
        backgroundColor: '#f6f8fc',
    },
    firstCell: {
        borderLeftWidth: 0,
    },
    cellText: {
        fontSize: 14,
        lineHeight: 20,
        color: colors.Text02,
    },
    headerText: {
        fontWeight: '700',
    },
    cellTextWrapper: {
        fontSize: 14,
        lineHeight: 20,
        color: colors.Text02,
    },
})
