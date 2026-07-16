import React from 'react'
import { ActivityIndicator, Image, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import moment from 'moment'
import { useSelector } from 'react-redux'

import styles, { colors } from '../../../styles/global'
import CommentElementsParser from '../../TextParser/CommentElementsParser'
import { divideQuotedText } from '../../../ChatsView/ChatDV/EditorView/quoteParserFunctions'
import QuotedText from '../../../ChatsView/ChatDV/EditorView/QuotedText'
import CodeText from '../../../ChatsView/ChatDV/EditorView/CodeText'
import { divideCodeText } from '../../../ChatsView/ChatDV/EditorView/codeParserFunctions'
import {
    getMarkdownTableColumnWidths,
    parseMarkdownLines,
    parseInlineFormatting,
} from '../../../ChatsView/ChatDV/EditorView/markdownParserFunctions'
import useGetUserPresentationData from '../../../ContactsView/Utils/useGetUserPresentationData'
import { getTimestampInMilliseconds } from '../../../ChatsView/Utils/ChatHelper'
import Icon from '../../../Icon'
import {
    parseFeedComment,
    TEXT_ELEMENT,
    HASH_ELEMENT,
    URL_ELEMENT,
    MENTION_ELEMENT,
    EMAIL_ELEMENT,
} from '../../Utils/HelperFunctions'
import HashTag from '../../../Tags/HashTag'
import LinkTag from '../../../Tags/LinkTag'
import MentionTag from '../../../Tags/MentionTag'
import EmailTag from '../../../Tags/EmailTag'
import TasksHelper from '../../../TaskListView/Utils/TasksHelper'
import { translate } from '../../../../i18n/TranslationService'
import GmailTag from '../../../Tags/GmailTag'
import EmailTaskAction from '../../../TaskListView/EmailLine/EmailTaskAction'

// Render inline formatted text segments with link/tag parsing
const renderFormattedText = (segments, baseStyle, projectId, getLinkCounter) => {
    if (!segments || segments.length === 0) return null

    return segments.map((segment, segmentIdx) => {
        const style = [
            baseStyle,
            segment.bold && { fontWeight: 'bold' },
            segment.italic && { fontStyle: 'italic' },
            segment.strikethrough && { textDecorationLine: 'line-through' },
        ]

        // Check if segment text has leading/trailing spaces that need to be preserved
        const hasLeadingSpace = segment.text && segment.text.startsWith(' ')
        const hasTrailingSpace = segment.text && segment.text.endsWith(' ')

        // Parse the segment text for links, tags, mentions, emails
        const parsedElements = parseFeedComment(segment.text, false, segment.bold)

        return parsedElements.map((element, elemIdx) => {
            const key = `${segmentIdx}-${elemIdx}`
            const { type, text, link, email } = element
            const isFirstElement = elemIdx === 0
            const isLastElement = elemIdx === parsedElements.length - 1
            // Add space after each word except the last one in the segment
            // Also preserve trailing space from original segment
            let spaceSuffix = isLastElement ? '' : ' '
            if (isLastElement && hasTrailingSpace) {
                spaceSuffix = ' '
            }
            // Preserve leading space from original segment
            const spacePrefix = isFirstElement && hasLeadingSpace ? ' ' : ''

            if (type === TEXT_ELEMENT) {
                // Render text element with preserved leading/trailing spaces
                if (text || spacePrefix || spaceSuffix) {
                    return (
                        <Text key={key} style={style}>
                            {spacePrefix}
                            {text}
                            {spaceSuffix}
                        </Text>
                    )
                }
                return null
            } else if (type === HASH_ELEMENT) {
                return (
                    <React.Fragment key={key}>
                        {spacePrefix ? <Text style={style}>{spacePrefix}</Text> : null}
                        <HashTag
                            projectId={projectId}
                            text={text}
                            useCommentTagStyle={true}
                            tagStyle={localStyles.inlineElement}
                        />
                        {spaceSuffix ? <Text style={style}>{spaceSuffix}</Text> : null}
                    </React.Fragment>
                )
            } else if (type === URL_ELEMENT) {
                return (
                    <React.Fragment key={key}>
                        {spacePrefix ? <Text style={style}>{spacePrefix}</Text> : null}
                        <LinkTag
                            link={link}
                            useCommentTagStyle={true}
                            text={'Link ' + getLinkCounter()}
                            tagStyle={localStyles.inlineElement}
                        />
                        {spaceSuffix ? <Text style={style}>{spaceSuffix}</Text> : null}
                    </React.Fragment>
                )
            } else if (type === MENTION_ELEMENT) {
                const { mention, user } = TasksHelper.getDataFromMention(text, projectId)
                return (
                    <React.Fragment key={key}>
                        {spacePrefix ? <Text style={style}>{spacePrefix}</Text> : null}
                        <MentionTag
                            text={mention}
                            useCommentTagStyle={true}
                            user={user}
                            tagStyle={localStyles.inlineElement}
                            projectId={projectId}
                        />
                        {spaceSuffix ? <Text style={style}>{spaceSuffix}</Text> : null}
                    </React.Fragment>
                )
            } else if (type === EMAIL_ELEMENT) {
                return (
                    <React.Fragment key={key}>
                        {spacePrefix ? <Text style={style}>{spacePrefix}</Text> : null}
                        <EmailTag
                            email={email}
                            useCommentTagStyle={true}
                            address={email}
                            tagStyle={localStyles.inlineElement}
                        />
                        {spaceSuffix ? <Text style={style}>{spaceSuffix}</Text> : null}
                    </React.Fragment>
                )
            }

            // Fallback for any unhandled element types
            return (
                <Text key={key} style={style}>
                    {spacePrefix}
                    {text || link || email || ''}
                    {spaceSuffix}
                </Text>
            )
        })
    })
}

const renderMarkdownTable = (line, key, isLastLine, projectId, getLinkCounter) => {
    const columnWidths = getMarkdownTableColumnWidths(line.rows)

    return (
        <ScrollView
            key={key}
            horizontal={true}
            showsHorizontalScrollIndicator={false}
            style={[localStyles.tableScroller, !isLastLine && { marginBottom: 16 }]}
            contentContainerStyle={localStyles.tableScrollerContent}
        >
            <View style={localStyles.tableContainer}>
                {line.rows.map((row, rowIndex) => {
                    const isHeaderRow = rowIndex === 0

                    return (
                        <View key={`table-row-${rowIndex}`} style={localStyles.tableRow}>
                            {columnWidths.map((width, cellIndex) => {
                                const alignment = line.alignments[cellIndex]
                                const textAlign = alignment || 'left'
                                const cellTextStyle = [
                                    localStyles.tableCellText,
                                    isHeaderRow && localStyles.tableHeaderText,
                                    { textAlign },
                                ]

                                return (
                                    <View
                                        key={`table-cell-${rowIndex}-${cellIndex}`}
                                        style={[
                                            localStyles.tableCell,
                                            isHeaderRow && localStyles.tableHeaderCell,
                                            { width },
                                        ]}
                                    >
                                        <Text style={cellTextStyle}>
                                            {renderFormattedText(
                                                parseInlineFormatting(row[cellIndex] || ''),
                                                cellTextStyle,
                                                projectId,
                                                getLinkCounter
                                            )}
                                        </Text>
                                    </View>
                                )
                            })}
                        </View>
                    )
                })}
            </View>
        </ScrollView>
    )
}

export default function Comment({
    containerStyle,
    projectId,
    comment,
    linkedEmail,
    linkedEmailGmailData,
    canArchiveLinkedEmail,
    linkedEmailArchiving,
    linkedEmailArchived,
    onArchiveLinkedEmail,
}) {
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)

    const { commentText, lastChangeDate, creatorId } = comment

    const { photoURL, displayName } = useGetUserPresentationData(creatorId)

    const textsFiltered = divideQuotedText(commentText, 'quote')

    const date = getTimestampInMilliseconds(lastChangeDate) ?? Date.now()

    // Track link counter for renderFormattedText
    let linkCounter = 0
    const getLinkCounter = () => {
        linkCounter++
        return linkCounter
    }

    const renderTextContent = (text, lastItem) => {
        const textData = divideCodeText(text)

        return textData.map((data, subIndex) => {
            const lastItemInsideItem = lastItem && subIndex === textData.length - 1
            if (data.type === 'code') {
                return (
                    <CodeText
                        key={`code-${subIndex}`}
                        lastItem={lastItemInsideItem}
                        text={data.text}
                        backgroundColor={colors.Secondary200}
                        textColor={colors.Text04}
                    />
                )
            } else {
                const processedLines = parseMarkdownLines(data.text)
                return processedLines.map((line, lineIndex) => {
                    const isLastLine = lastItemInsideItem && lineIndex === processedLines.length - 1
                    const marginStyle = !isLastLine ? { marginBottom: 4 } : null

                    if (line.type === 'table') {
                        return renderMarkdownTable(line, `table-${lineIndex}`, isLastLine, projectId, getLinkCounter)
                    } else if (line.type === 'hr') {
                        return (
                            <View
                                key={`hr-${lineIndex}`}
                                style={[localStyles.horizontalRule, !isLastLine && { marginBottom: 16 }]}
                            />
                        )
                    } else if (/^h[1-6]$/.test(line.type)) {
                        const headingStyle = localStyles[`header${line.type.substring(1)}`]
                        return (
                            <Text
                                key={`header-${lineIndex}`}
                                style={[headingStyle, !isLastLine && { marginBottom: 16 }]}
                            >
                                {renderFormattedText(line.segments, headingStyle, projectId, getLinkCounter)}
                            </Text>
                        )
                    } else if (line.type === 'bullet') {
                        return (
                            <View key={`bullet-${lineIndex}`} style={[localStyles.bulletContainer, marginStyle]}>
                                <Text style={localStyles.bulletPoint}>•</Text>
                                <View style={localStyles.bulletContent}>
                                    <Text style={localStyles.comment}>
                                        {renderFormattedText(
                                            line.segments,
                                            localStyles.comment,
                                            projectId,
                                            getLinkCounter
                                        )}
                                    </Text>
                                </View>
                            </View>
                        )
                    } else if (line.type === 'numbered') {
                        return (
                            <View key={`numbered-${lineIndex}`} style={[localStyles.bulletContainer, marginStyle]}>
                                <Text style={localStyles.numberedPoint}>{line.number}.</Text>
                                <View style={localStyles.bulletContent}>
                                    <Text style={localStyles.comment}>
                                        {renderFormattedText(
                                            line.segments,
                                            localStyles.comment,
                                            projectId,
                                            getLinkCounter
                                        )}
                                    </Text>
                                </View>
                            </View>
                        )
                    } else if (line.type === 'checkbox') {
                        return (
                            <View key={`checkbox-${lineIndex}`} style={[localStyles.bulletContainer, marginStyle]}>
                                <View style={localStyles.checkboxIcon}>
                                    <Icon
                                        name={line.checked ? 'square-check' : 'square'}
                                        size={16}
                                        color={line.checked ? colors.Primary100 : colors.Text03}
                                    />
                                </View>
                                <View style={localStyles.bulletContent}>
                                    <Text
                                        style={[
                                            localStyles.comment,
                                            line.checked && {
                                                textDecorationLine: 'line-through',
                                                color: colors.Text03,
                                            },
                                        ]}
                                    >
                                        {renderFormattedText(
                                            line.segments,
                                            localStyles.comment,
                                            projectId,
                                            getLinkCounter
                                        )}
                                    </Text>
                                </View>
                            </View>
                        )
                    } else {
                        // For regular text, check if it has inline formatting
                        const segments = parseInlineFormatting(line.text)
                        const hasFormatting = segments.some(s => s.bold || s.italic || s.strikethrough)

                        if (hasFormatting) {
                            return (
                                <Text key={`text-${lineIndex}`} style={[localStyles.comment, marginStyle]}>
                                    {renderFormattedText(segments, localStyles.comment, projectId, getLinkCounter)}
                                </Text>
                            )
                        }

                        return (
                            <CommentElementsParser
                                key={`text-${lineIndex}`}
                                comment={line.text}
                                containerStyle={marginStyle}
                                entryStyle={localStyles.comment}
                                projectId={projectId}
                                inChat={true}
                            />
                        )
                    }
                })
            }
        })
    }

    return (
        <View style={[localStyles.container, containerStyle]}>
            <View style={localStyles.commentBody}>
                <View style={localStyles.commentHeader}>
                    <Image style={localStyles.avatar} source={{ uri: photoURL }} />
                    <Text style={[localStyles.name, { maxWidth: smallScreenNavigation ? 130 : 250 }]} numberOfLines={1}>
                        {displayName}
                    </Text>
                    <Text style={[localStyles.commentSubHeader, { marginHorizontal: 4 }]}>•</Text>
                    <Text style={localStyles.commentSubHeader} numberOfLines={1}>
                        {moment(date).fromNow()}
                    </Text>
                </View>

                {textsFiltered.map((commentData, index) => {
                    const { type, text } = commentData
                    const lastItem = index === textsFiltered.length - 1
                    if (type === 'quote') {
                        return (
                            <QuotedText
                                key={index}
                                projectId={projectId}
                                lastItem={lastItem}
                                quotedText={text}
                                backgroundColor={colors.Secondary300}
                                textColor={colors.Text04}
                            />
                        )
                    } else {
                        return renderTextContent(text, lastItem)
                    }
                })}
                {linkedEmail && (
                    <View style={localStyles.linkedEmailActions}>
                        <GmailTag
                            gmailData={linkedEmailGmailData}
                            showLabel={true}
                            propStyles={localStyles.linkedEmailTag}
                        />
                        {canArchiveLinkedEmail && (
                            <>
                                <EmailTaskAction
                                    connectionId={linkedEmail.connectionProjectId}
                                    messageIds={[linkedEmail.messageId]}
                                    initialTask={linkedEmailGmailData?.taskCreated}
                                    checkExisting
                                    iconColor={colors.UtilityBlue125}
                                    borderColor={colors.Primary350}
                                    textColor={colors.UtilityBlue125}
                                    style={localStyles.linkedEmailTaskButton}
                                />
                                <TouchableOpacity
                                    style={localStyles.linkedEmailButton}
                                    onPress={() => onArchiveLinkedEmail([linkedEmail])}
                                    disabled={linkedEmailArchiving || linkedEmailArchived}
                                    accessibilityLabel={translate('Archive email')}
                                >
                                    {linkedEmailArchiving ? (
                                        <ActivityIndicator size="small" color={colors.UtilityBlue125} />
                                    ) : (
                                        <Icon
                                            name={linkedEmailArchived ? 'check' : 'archive'}
                                            size={14}
                                            color={colors.UtilityBlue125}
                                        />
                                    )}
                                    <Text style={localStyles.linkedEmailButtonText}>
                                        {translate(linkedEmailArchived ? 'Archived' : 'Archive email')}
                                    </Text>
                                </TouchableOpacity>
                            </>
                        )}
                    </View>
                )}
            </View>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flexDirection: 'row',
    },
    avatar: {
        width: 24,
        height: 24,
        borderRadius: 100,
        marginRight: 8,
    },
    commentHeader: {
        flex: 1,
        height: 24,
        flexDirection: 'row',
        alignItems: 'center',
    },
    commentSubHeader: {
        ...styles.body2,
        color: colors.Text03,
    },
    name: {
        ...styles.subtitle1,
        color: colors.Text04,
    },
    commentBody: {
        flex: 1,
        paddingHorizontal: 8,
    },
    commentContainer: {
        marginTop: 4,
    },
    comment: {
        ...styles.body2,
        color: colors.Grey400,
    },
    header1: {
        fontFamily: 'Roboto-Regular',
        fontSize: 32,
        lineHeight: 50,
        color: colors.Text04,
        fontWeight: '600',
    },
    header2: {
        fontFamily: 'Roboto-Medium',
        fontSize: 24,
        lineHeight: 32,
        color: colors.Text04,
        fontWeight: '500',
    },
    header3: {
        fontFamily: 'Roboto-Medium',
        fontSize: 20,
        lineHeight: 28,
        color: colors.Text04,
        fontWeight: '500',
    },
    header4: {
        fontFamily: 'Roboto-Medium',
        fontSize: 18,
        lineHeight: 26,
        color: colors.Text04,
        fontWeight: '500',
    },
    header5: {
        fontFamily: 'Roboto-Medium',
        fontSize: 16,
        lineHeight: 24,
        color: colors.Text04,
        fontWeight: '500',
    },
    header6: {
        fontFamily: 'Roboto-Medium',
        fontSize: 14,
        lineHeight: 20,
        color: colors.Text04,
        fontWeight: '500',
    },
    horizontalRule: {
        height: 1,
        backgroundColor: colors.Gray300,
        marginVertical: 16,
        width: '100%',
    },
    bulletContainer: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        width: '100%',
    },
    bulletPoint: {
        ...styles.body2,
        color: colors.Grey400,
        marginRight: 8,
        width: 8,
        flexShrink: 0,
    },
    numberedPoint: {
        ...styles.body2,
        color: colors.Grey400,
        marginRight: 8,
        minWidth: 20,
    },
    bulletContent: {
        flex: 1,
        flexWrap: 'wrap',
    },
    checkboxIcon: {
        marginRight: 8,
        marginTop: 2,
    },
    inlineElement: {
        marginRight: 6,
    },
    linkedEmailActions: {
        alignSelf: 'flex-start',
        maxWidth: '100%',
        marginTop: 6,
        flexDirection: 'row',
        alignItems: 'center',
        flexWrap: 'wrap',
    },
    linkedEmailTag: {
        marginRight: 8,
        marginBottom: 4,
    },
    linkedEmailTaskButton: {
        marginRight: 8,
        marginBottom: 4,
    },
    linkedEmailButton: {
        minHeight: 28,
        paddingHorizontal: 8,
        borderRadius: 4,
        borderWidth: 1,
        borderColor: colors.Primary350,
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 4,
    },
    linkedEmailButtonText: {
        ...styles.caption2,
        color: colors.UtilityBlue125,
        marginLeft: 6,
    },
    tableScroller: {
        maxWidth: '100%',
    },
    tableScrollerContent: {
        alignItems: 'flex-start',
    },
    tableContainer: {
        alignSelf: 'flex-start',
        borderLeftWidth: 1,
        borderTopWidth: 1,
        borderColor: colors.Gray300,
        borderRadius: 4,
        overflow: 'hidden',
    },
    tableRow: {
        flexDirection: 'row',
    },
    tableCell: {
        borderRightWidth: 1,
        borderBottomWidth: 1,
        borderColor: colors.Gray300,
        paddingHorizontal: 12,
        paddingVertical: 8,
        justifyContent: 'center',
    },
    tableHeaderCell: {
        backgroundColor: colors.Grey200,
    },
    tableCellText: {
        ...styles.body2,
        color: colors.Grey400,
    },
    tableHeaderText: {
        color: colors.Text01,
        fontWeight: '600',
    },
})
