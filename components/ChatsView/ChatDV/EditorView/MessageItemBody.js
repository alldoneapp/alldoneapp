import React from 'react'
import { Platform, ScrollView, StyleSheet, View, ActivityIndicator, Text, TouchableOpacity } from 'react-native'

import global, { colors } from '../../../styles/global'
import CommentElementsParser from '../../../Feeds/TextParser/CommentElementsParser'
import { divideQuotedText } from './quoteParserFunctions'
import QuotedText from './QuotedText'
import { divideCodeText } from './codeParserFunctions'
import CodeText from './CodeText'
import { getMarkdownTableColumnWidths, parseMarkdownLines, parseInlineFormatting } from './markdownParserFunctions'
import { hasContentBeforeLine, MARKDOWN_HEADING_TOP_MARGIN } from './markdownLayout'
import Icon from '../../../Icon'
import {
    parseFeedComment,
    TEXT_ELEMENT,
    HASH_ELEMENT,
    URL_ELEMENT,
    MENTION_ELEMENT,
    EMAIL_ELEMENT,
} from '../../../Feeds/Utils/HelperFunctions'
import HashTag from '../../../Tags/HashTag'
import LinkTag from '../../../Tags/LinkTag'
import MentionTag from '../../../Tags/MentionTag'
import EmailTag from '../../../Tags/EmailTag'
import TasksHelper from '../../../TaskListView/Utils/TasksHelper'
import { translate } from '../../../../i18n/TranslationService'
import GmailTag from '../../../Tags/GmailTag'
import { openUrlInNewTab, resolveUnsubscribeUrl } from '../../../TaskListView/EmailLine/emailLineHelper'
import EmailTaskAction from '../../../TaskListView/EmailLine/EmailTaskAction'
import { markAlldoneChatsReadForLinkedEmails } from '../../../../utils/backends/Chats/markChatCommentsAsRead'
import VmInteractionCard from './VmInteractionCard'
import { isAwaitingVmInteraction as hasAwaitingVmInteraction } from './messageLoadingState'
import AssistantProgress from './AssistantProgress'
import StopAssistantRunButton from './StopAssistantRunButton'

// Helper to check if a comment contains block/special elements that cannot be rendered inline
const containsBlockOrSpecialElements = text => {
    if (!text) return false
    return (
        text.includes('EbDsQTD14ahtSR5') || // Attachment
        text.includes('O2TI5plHBf1QfdY') || // Image
        text.includes('ptPQsef7OeB5eWd') || // Video
        text.includes('pMP4SB2IsTQr8LN') || // Karma
        text.includes('qM54HU5TsTOe3Yw') // Milestone
    )
}

/**
 * The read-only rendering of a single chat message: markdown/quotes/code/tags, the assistant
 * loading + awaiting-interaction states, and the linked-email action row.
 *
 * Extracted from MessageItemContent so the chat list's unread previews (AT-2256) render messages
 * through exactly the same code path as the thread itself, instead of maintaining a second,
 * inevitably drifting renderer. MessageItemContent keeps everything that only makes sense inside
 * a thread (the DismissibleItem edit mode and its ChatInput); nothing interactive beyond the
 * message's own content lives here.
 */
export default function MessageItemBody({
    messageId,
    projectId,
    commentText,
    chat,
    creatorData,
    objectType,
    isLoading,
    assistantRun,
    linkedEmail,
    linkedEmailGmailData,
    linkedEmailArchiving,
    linkedEmailArchived,
    onArchiveLinkedEmail,
    canArchiveLinkedEmail,
    containerStyle,
}) {
    // Surface a one-tap unsubscribe next to the Archive button for incoming
    // informational emails that carry List-Unsubscribe metadata. Null when the
    // email has no safe unsubscribe destination, so the control stays hidden.
    const linkedEmailUnsubscribeUrl = resolveUnsubscribeUrl(linkedEmailGmailData)

    // Awaiting-user is a durable state, not a transient spinner. Render its card
    // even if legacy/stale message-loading logic has already cleared isLoading.
    const isAwaitingVmInteraction = creatorData?.isAssistant && hasAwaitingVmInteraction(assistantRun)
    const isLoadingState = creatorData?.isAssistant && (isLoading || isAwaitingVmInteraction)
    const showFriendlyAssistantProgress = isLoadingState && !isAwaitingVmInteraction && assistantRun?.kind === 'chat'
    // Strip leading whitespace so a status block appended before any answer text streamed
    // (e.g. a tool that runs immediately) doesn't render with a large blank gap above it.
    const loadingText = typeof commentText === 'string' ? commentText.replace(/^\s+/, '') : commentText

    // Process the content
    const processedContent = divideQuotedText(commentText, 'quote')

    // Track link counter for renderFormattedText
    let linkCounter = 0
    const getLinkCounter = () => {
        linkCounter++
        return linkCounter
    }

    // Render inline formatted text segments with link/tag parsing
    const renderFormattedText = (segments, baseStyle) => {
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

    const renderMarkdownTable = (line, key, isLastLine) => {
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
                                                    cellTextStyle
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

    const renderTextContent = (text, firstItem, lastItem) => {
        const textData = divideCodeText(text)

        return textData.map((data, subIndex) => {
            const firstItemInsideItem = firstItem && subIndex === 0
            const lastItemInsideItem = lastItem && subIndex === textData.length - 1
            if (data.type === 'code') {
                return <CodeText key={`text-${subIndex}`} lastItem={lastItemInsideItem} text={data.text} />
            } else {
                const processedLines = parseMarkdownLines(data.text)
                return processedLines.map((line, lineIndex) => {
                    const isLastLine = lastItemInsideItem && lineIndex === processedLines.length - 1
                    const marginStyle = !isLastLine ? { marginBottom: 4 } : null

                    if (line.type === 'table') {
                        return renderMarkdownTable(line, `table-${lineIndex}`, isLastLine)
                    } else if (line.type === 'hr') {
                        return (
                            <View
                                key={`hr-${lineIndex}`}
                                style={[localStyles.horizontalRule, !isLastLine && { marginBottom: 16 }]}
                            />
                        )
                    } else if (/^h[1-6]$/.test(line.type)) {
                        const headingStyle = localStyles[`header${line.type.substring(1)}`]
                        const hasPrecedingContent = hasContentBeforeLine(
                            processedLines,
                            lineIndex,
                            !firstItemInsideItem
                        )
                        return (
                            <Text
                                key={`header-${lineIndex}`}
                                testID="markdown-heading"
                                style={[
                                    headingStyle,
                                    hasPrecedingContent && { marginTop: MARKDOWN_HEADING_TOP_MARGIN },
                                    !isLastLine && { marginBottom: 16 },
                                ]}
                            >
                                {renderFormattedText(line.segments, headingStyle)}
                            </Text>
                        )
                    } else if (line.type === 'bullet') {
                        return (
                            <View key={`bullet-${lineIndex}`} style={[localStyles.bulletContainer, marginStyle]}>
                                <Text style={localStyles.bulletPoint}>•</Text>
                                <View style={localStyles.bulletContent}>
                                    <Text style={localStyles.text}>
                                        {renderFormattedText(line.segments, localStyles.text)}
                                    </Text>
                                </View>
                            </View>
                        )
                    } else if (line.type === 'numbered') {
                        return (
                            <View key={`numbered-${lineIndex}`} style={[localStyles.bulletContainer, marginStyle]}>
                                <Text style={localStyles.numberedPoint}>{line.number}.</Text>
                                <View style={localStyles.bulletContent}>
                                    <Text style={localStyles.text}>
                                        {renderFormattedText(line.segments, localStyles.text)}
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
                                            localStyles.text,
                                            line.checked && {
                                                textDecorationLine: 'line-through',
                                                color: colors.Text03,
                                            },
                                        ]}
                                    >
                                        {renderFormattedText(line.segments, localStyles.text)}
                                    </Text>
                                </View>
                            </View>
                        )
                    } else {
                        // Check if the line has block or special elements that cannot be rendered inline
                        if (!containsBlockOrSpecialElements(line.text)) {
                            const segments = parseInlineFormatting(line.text)
                            return (
                                <Text key={`text-${lineIndex}`} style={[localStyles.text, marginStyle]}>
                                    {renderFormattedText(segments, localStyles.text)}
                                </Text>
                            )
                        }

                        return (
                            <CommentElementsParser
                                key={`text-${lineIndex}`}
                                comment={line.text}
                                containerStyle={marginStyle}
                                entryStyle={localStyles.text}
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
        <View style={[localStyles.messageContentContainer, containerStyle]}>
            {isLoadingState ? (
                <View style={localStyles.loadingContainer}>
                    {showFriendlyAssistantProgress ? (
                        <AssistantProgress activity={assistantRun?.activity} />
                    ) : !containsBlockOrSpecialElements(loadingText) ? (
                        <Text style={[localStyles.loadingText, { marginBottom: 8 }]}>{loadingText}</Text>
                    ) : (
                        <CommentElementsParser
                            comment={loadingText}
                            containerStyle={{ marginBottom: 8 }}
                            entryStyle={localStyles.loadingText}
                            projectId={projectId}
                            inChat={true}
                        />
                    )}
                    {isAwaitingVmInteraction && (
                        <VmInteractionCard
                            projectId={projectId}
                            objectType={objectType}
                            objectId={chat?.id}
                            commentId={messageId}
                            assistantRun={assistantRun}
                        />
                    )}
                    {!isAwaitingVmInteraction && !showFriendlyAssistantProgress && (
                        <View style={localStyles.loadingIndicator}>
                            <ActivityIndicator size="small" color={colors.PrimaryBlue} />
                        </View>
                    )}
                    <StopAssistantRunButton
                        projectId={projectId}
                        objectType={objectType}
                        objectId={chat?.id}
                        commentId={messageId}
                        assistantRun={assistantRun}
                        isLoading={isLoadingState}
                    />
                </View>
            ) : (
                <>
                    {processedContent.map((contentPart, index) => {
                        const firstItem = index === 0
                        const lastItem = index === processedContent.length - 1
                        const { type, text } = contentPart

                        if (type === 'quote') {
                            return (
                                <QuotedText key={index} projectId={projectId} lastItem={lastItem} quotedText={text} />
                            )
                        } else {
                            return renderTextContent(text, firstItem, lastItem)
                        }
                    })}
                    {canArchiveLinkedEmail && linkedEmail && (
                        <View style={localStyles.linkedEmailActions}>
                            <GmailTag
                                gmailData={linkedEmailGmailData}
                                showLabel={true}
                                propStyles={localStyles.linkedEmailTag}
                            />
                            <EmailTaskAction
                                connectionId={linkedEmail.connectionProjectId}
                                messageIds={[linkedEmail.messageId]}
                                initialTask={linkedEmailGmailData?.taskCreated}
                                checkExisting
                                // Creating a task means this email has been handled. Clear only
                                // its Alldone chat notification; Gmail's read state stays intact.
                                onTaskCreated={() => markAlldoneChatsReadForLinkedEmails([linkedEmail])}
                                style={localStyles.linkedEmailTaskButton}
                            />
                            <TouchableOpacity
                                style={localStyles.linkedEmailButton}
                                onPress={() => onArchiveLinkedEmail([linkedEmail])}
                                disabled={linkedEmailArchiving || linkedEmailArchived}
                                accessibilityLabel={translate('Archive email')}
                            >
                                {/* Archived wins over archiving (AT-2424): the archive is
                                    optimistic, so the check mark is the answer from the press
                                    onwards and the spinner only covers a state the user never
                                    normally reaches. */}
                                {linkedEmailArchived ? (
                                    <Icon name="check" size={14} color={colors.Text03} />
                                ) : linkedEmailArchiving ? (
                                    <ActivityIndicator size="small" color={colors.Text03} />
                                ) : (
                                    <Icon name="archive" size={14} color={colors.Text03} />
                                )}
                                <Text style={localStyles.linkedEmailButtonText}>
                                    {translate(linkedEmailArchived ? 'Archived' : 'Archive email')}
                                </Text>
                            </TouchableOpacity>
                            {!!linkedEmailUnsubscribeUrl && (
                                <TouchableOpacity
                                    style={[localStyles.linkedEmailButton, localStyles.linkedEmailUnsubscribe]}
                                    onPress={() => openUrlInNewTab(linkedEmailUnsubscribeUrl)}
                                    accessibilityLabel={translate('Unsubscribe')}
                                >
                                    <Icon name="slash" size={14} color={colors.Text03} />
                                    <Text style={localStyles.linkedEmailButtonText}>{translate('Unsubscribe')}</Text>
                                </TouchableOpacity>
                            )}
                        </View>
                    )}
                </>
            )}
        </View>
    )
}

const localStyles = StyleSheet.create({
    messageContentContainer: {
        marginLeft: 36,
        ...(Platform.OS === 'web' ? { userSelect: 'text', cursor: 'text' } : {}),
    },
    text: {
        ...global.body1,
        color: colors.Text02,
    },
    header1: {
        fontFamily: 'Roboto-Regular',
        fontSize: 32,
        lineHeight: 50,
        color: colors.Text01,
        fontWeight: '600',
    },
    header2: {
        fontFamily: 'Roboto-Medium',
        fontSize: 24,
        lineHeight: 32,
        color: colors.Text01,
        fontWeight: '500',
    },
    header3: {
        fontFamily: 'Roboto-Medium',
        fontSize: 20,
        lineHeight: 28,
        color: colors.Text01,
        fontWeight: '500',
    },
    header4: {
        fontFamily: 'Roboto-Medium',
        fontSize: 18,
        lineHeight: 26,
        color: colors.Text01,
        fontWeight: '500',
    },
    header5: {
        fontFamily: 'Roboto-Medium',
        fontSize: 16,
        lineHeight: 24,
        color: colors.Text01,
        fontWeight: '500',
    },
    header6: {
        fontFamily: 'Roboto-Medium',
        fontSize: 14,
        lineHeight: 20,
        color: colors.Text01,
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
        ...global.body1,
        color: colors.Text02,
        marginRight: 8,
        width: 8,
        flexShrink: 0,
    },
    numberedPoint: {
        ...global.body1,
        color: colors.Text02,
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
    loadingContainer: {
        opacity: 0.8,
    },
    loadingText: {
        ...global.body1,
        color: colors.Text02,
        fontStyle: 'italic',
    },
    loadingIndicator: {
        marginTop: 8,
        flexDirection: 'row',
        alignItems: 'flex-start',
    },
    inlineElement: {
        marginRight: 6,
    },
    linkedEmailActions: {
        alignSelf: 'flex-start',
        maxWidth: '100%',
        marginTop: 8,
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
        borderColor: colors.Gray300,
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 4,
    },
    linkedEmailButtonText: {
        ...global.caption2,
        color: colors.Text03,
        marginLeft: 6,
    },
    linkedEmailUnsubscribe: {
        marginLeft: 8,
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
        ...global.body1,
        color: colors.Text02,
    },
    tableHeaderText: {
        color: colors.Text01,
        fontWeight: '600',
    },
})
