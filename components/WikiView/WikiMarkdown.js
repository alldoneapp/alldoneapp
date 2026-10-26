import React, { useMemo } from 'react'
import { StyleSheet, Text, View } from 'react-native'

import styles, { colors } from '../styles/global'
import { getIconGlyph } from '../Icon'
import { translate } from '../../i18n/TranslationService'
import { parseWikiMarkdown } from './wikiMarkdownParser'

const SOURCE_TYPE_ICONS = {
    task: 'check-square',
    note: 'file-text',
    goal: 'target',
    contact: 'user',
    chat: 'message-circle',
    artifact: 'package',
    correction: 'edit-3',
    document: 'paperclip',
}

const SOURCE_TYPE_LABELS = {
    task: 'Task',
    note: 'Note',
    goal: 'Goal',
    contact: 'Contact',
    chat: 'Chat',
    artifact: 'Artifact',
    correction: 'Correction',
    document: 'Document',
}

// Corrections and documents added to the wiki live inside it and have no view of their own.
export function isOpenableWikiSource(objectType) {
    return objectType !== 'correction' && objectType !== 'document'
}

export function getWikiSourceLabel(node, sourceLabels = {}) {
    return node.label || sourceLabels[node.key] || translate(SOURCE_TYPE_LABELS[node.objectType] || 'Source')
}

function openExternalLink(url) {
    if (typeof window !== 'undefined' && typeof window.open === 'function') window.open(url, '_blank', 'noopener')
}

function Inline({ nodes, context }) {
    return nodes.map((node, index) => {
        switch (node.type) {
            case 'text':
                return <React.Fragment key={index}>{node.text}</React.Fragment>
            case 'bold':
                return (
                    <Text key={index} style={localStyles.bold}>
                        <Inline nodes={node.children} context={context} />
                    </Text>
                )
            case 'italic':
                return (
                    <Text key={index} style={localStyles.italic}>
                        <Inline nodes={node.children} context={context} />
                    </Text>
                )
            case 'code':
                return (
                    <Text key={index} style={localStyles.inlineCode}>
                        {node.text}
                    </Text>
                )
            case 'link':
                return (
                    <Text key={index} style={localStyles.link} onPress={() => openExternalLink(node.url)}>
                        <Inline nodes={node.children} context={context} />
                    </Text>
                )
            case 'pageLink': {
                const exists = context.pageExists(node.slug)
                return (
                    <Text
                        key={index}
                        testID={`wiki-page-link-${node.slug}`}
                        style={exists ? localStyles.pageLink : localStyles.missingPageLink}
                        onPress={exists ? () => context.onPressPage(node.slug) : undefined}
                    >
                        {node.label}
                    </Text>
                )
            }
            case 'source': {
                const pressable = isOpenableWikiSource(node.objectType)
                return (
                    <Text
                        key={index}
                        testID={`wiki-source-${node.key}`}
                        style={localStyles.sourceChip}
                        onPress={pressable ? () => context.onPressSource(node) : undefined}
                    >
                        <Text style={localStyles.sourceChipIcon}>
                            {getIconGlyph(SOURCE_TYPE_ICONS[node.objectType])}
                        </Text>
                        {` ${getWikiSourceLabel(node, context.sourceLabels)}`}
                    </Text>
                )
            }
            default:
                return null
        }
    })
}

// Where list text starts, and how far each nested list steps right — the notes editor's values.
const LIST_TEXT_INDENT = 36
const LIST_NESTING_STEP = 24

const HEADING_STYLES = {
    1: styles.title5,
    2: styles.title6,
    3: styles.subtitle1,
    4: styles.subtitle2,
}

function Block({ block, context, depth = 0 }) {
    switch (block.type) {
        case 'heading':
            return (
                <Text style={[HEADING_STYLES[block.level], localStyles.heading]}>
                    <Inline nodes={block.inline} context={context} />
                </Text>
            )
        case 'paragraph':
            return (
                <Text style={localStyles.paragraph}>
                    <Inline nodes={block.inline} context={context} />
                </Text>
            )
        case 'list':
            return (
                <View testID="wiki-list" style={[localStyles.list, depth > 0 && localStyles.nestedList]}>
                    {block.items.map((item, index) => (
                        <View key={index}>
                            <View style={localStyles.listItem}>
                                <Text
                                    testID="wiki-list-marker"
                                    style={[
                                        localStyles.listMarker,
                                        block.ordered ? localStyles.orderedListMarker : localStyles.bulletListMarker,
                                    ]}
                                >
                                    {block.ordered ? `${index + 1}.` : '•'}
                                </Text>
                                <Text testID="wiki-list-text" style={localStyles.listText}>
                                    <Inline nodes={item.inline} context={context} />
                                </Text>
                            </View>
                            {item.children.map((child, childIndex) => (
                                <Block key={childIndex} block={child} context={context} depth={depth + 1} />
                            ))}
                        </View>
                    ))}
                </View>
            )
        case 'quote':
            return (
                <View style={localStyles.quote}>
                    {block.blocks.map((child, index) => (
                        <Block key={index} block={child} context={context} depth={depth} />
                    ))}
                </View>
            )
        case 'code':
            return (
                <View style={localStyles.codeBlock}>
                    <Text style={localStyles.codeText}>{block.text}</Text>
                </View>
            )
        case 'rule':
            return <View style={localStyles.rule} />
        case 'table':
            return (
                <View style={localStyles.table}>
                    {[block.header, ...block.rows].map((row, rowIndex) => (
                        <View key={rowIndex} style={[localStyles.tableRow, rowIndex === 0 && localStyles.tableHeader]}>
                            {row.map((cell, cellIndex) => (
                                <Text
                                    key={cellIndex}
                                    style={[localStyles.tableCell, rowIndex === 0 && localStyles.tableHeaderCell]}
                                >
                                    <Inline nodes={cell} context={context} />
                                </Text>
                            ))}
                        </View>
                    ))}
                </View>
            )
        default:
            return null
    }
}

/**
 * Renders a wiki page body. Wiki links and source references come back through the callbacks, so
 * the view decides where they lead; a link to a page that does not exist (any more) is shown but
 * not pressable, and a correction or an added document cannot be opened because it has no view of
 * its own.
 */
export default function WikiMarkdown({
    body,
    sourceLabels = {},
    pageExists = () => true,
    onPressPage = () => {},
    onPressSource = () => {},
}) {
    const blocks = useMemo(() => parseWikiMarkdown(body), [body])
    const context = { sourceLabels, pageExists, onPressPage, onPressSource }
    return (
        <View testID="wiki-markdown">
            {blocks.map((block, index) => (
                <Block key={index} block={block} context={context} />
            ))}
        </View>
    )
}

const localStyles = StyleSheet.create({
    heading: {
        color: colors.Text01,
        marginTop: 16,
        marginBottom: 8,
    },
    paragraph: {
        ...styles.body1,
        color: colors.Text01,
        marginBottom: 12,
    },
    bold: {
        fontWeight: '600',
    },
    italic: {
        fontStyle: 'italic',
    },
    inlineCode: {
        fontFamily: 'monospace',
        backgroundColor: colors.Grey200,
        paddingHorizontal: 4,
        borderRadius: 4,
    },
    link: {
        color: colors.Primary100,
        textDecorationLine: 'underline',
    },
    pageLink: {
        color: colors.Primary100,
        fontWeight: '500',
    },
    missingPageLink: {
        color: colors.Text03,
    },
    sourceChip: {
        ...styles.body2,
        color: colors.Text02,
        backgroundColor: colors.Grey200,
        borderRadius: 12,
        paddingHorizontal: 6,
        paddingVertical: 1,
    },
    sourceChipIcon: {
        fontFamily: 'alldone',
        color: colors.Text03,
    },
    // Lists are laid out like lists in notes (AT-2873, measured against the notes editor's
    // toolbar-styles.css at the same 16px): the marker sits in a fixed column, right-aligned, so the
    // text of every item — and every wrapped line of it — starts at the same indent, and each nesting
    // level steps right by the same 24px a note does.
    list: {
        marginBottom: 12,
    },
    nestedList: {
        marginLeft: LIST_NESTING_STEP,
        marginBottom: 0,
    },
    listItem: {
        flexDirection: 'row',
        marginBottom: 4,
    },
    // The app shell forces `flex-basis: auto !important` on every element (web-bundler/index.html),
    // which turns the text's `flex: 1` into a content-sized basis. Without flexShrink: 0 the marker
    // column was then squeezed in proportion to how long the item is, so the gap between bullet and
    // text changed from item to item. minWidth (not width) lets a long number like "100." widen its
    // own column instead of running into the text.
    listMarker: {
        ...styles.body1,
        color: colors.Text02,
        minWidth: LIST_TEXT_INDENT,
        flexShrink: 0,
        textAlign: 'right',
    },
    bulletListMarker: {
        paddingRight: 4,
    },
    orderedListMarker: {
        paddingRight: 11,
    },
    listText: {
        ...styles.body1,
        color: colors.Text01,
        flex: 1,
        minWidth: 0,
    },
    quote: {
        borderLeftWidth: 3,
        borderLeftColor: colors.Grey300,
        paddingLeft: 12,
        marginBottom: 12,
    },
    codeBlock: {
        backgroundColor: colors.Grey200,
        borderRadius: 4,
        padding: 12,
        marginBottom: 12,
    },
    codeText: {
        fontFamily: 'monospace',
        color: colors.Text01,
    },
    rule: {
        height: 1,
        backgroundColor: colors.Grey300,
        marginVertical: 16,
    },
    table: {
        borderWidth: 1,
        borderColor: colors.Grey300,
        borderRadius: 4,
        marginBottom: 12,
    },
    tableRow: {
        flexDirection: 'row',
        borderTopWidth: 1,
        borderTopColor: colors.Grey300,
    },
    tableHeader: {
        borderTopWidth: 0,
        backgroundColor: colors.Grey200,
    },
    tableCell: {
        ...styles.body2,
        color: colors.Text01,
        flex: 1,
        padding: 8,
    },
    tableHeaderCell: {
        fontWeight: '600',
    },
})
