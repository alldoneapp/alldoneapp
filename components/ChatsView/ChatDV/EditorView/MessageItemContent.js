import React, { useEffect, useState } from 'react'
import { Platform, ScrollView, StyleSheet, View, ActivityIndicator, Text, TouchableOpacity } from 'react-native'

import global, { colors } from '../../../styles/global'
import CommentElementsParser from '../../../Feeds/TextParser/CommentElementsParser'
import { divideQuotedText } from './quoteParserFunctions'
import QuotedText from './QuotedText'
import ChatInput from './ChatInput'
import DismissibleItem from '../../../UIComponents/DismissibleItem'
import { useDispatch, useSelector } from 'react-redux'
import { setActiveChatMessageId } from '../../../../redux/actions'
import { divideCodeText } from './codeParserFunctions'
import CodeText from './CodeText'
import { getMarkdownTableColumnWidths, parseMarkdownLines, parseInlineFormatting } from './markdownParserFunctions'
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
import { cancelAssistantRun } from '../../../../utils/backends/Assistants/assistantRuns'
import { translate } from '../../../../i18n/TranslationService'
import GmailTag from '../../../Tags/GmailTag'
import { openUrlInNewTab, resolveUnsubscribeUrl } from '../../../TaskListView/EmailLine/emailLineHelper'

export default function MessageItemContent({
    messageId,
    creatorId,
    projectId,
    commentText,
    chatTitle,
    members,
    chat,
    dismissibleRef,
    creatorData,
    objectType,
    setAmountOfNewCommentsToHighligth,
    isLoading,
    assistantRun,
    linkedEmail,
    linkedEmailGmailData,
    linkedEmailArchiving,
    linkedEmailArchived,
    onArchiveLinkedEmail,
    canArchiveLinkedEmail,
}) {
    const dispatch = useDispatch()
    const activeChatMessageId = useSelector(state => state.activeChatMessageId)
    const loggedUserId = useSelector(state => state.loggedUser?.uid)
    const [cancellingRun, setCancellingRun] = useState(false)

    // Surface a one-tap unsubscribe next to the Archive button for incoming
    // informational emails that carry List-Unsubscribe metadata. Null when the
    // email has no safe unsubscribe destination, so the control stays hidden.
    const linkedEmailUnsubscribeUrl = resolveUnsubscribeUrl(linkedEmailGmailData)

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

    // Check if this message is in loading state
    const isLoadingState = isLoading && creatorData?.isAssistant
    // Strip leading whitespace so a status block appended before any answer text streamed
    // (e.g. a tool that runs immediately) doesn't render with a large blank gap above it.
    const loadingText = typeof commentText === 'string' ? commentText.replace(/^\s+/, '') : commentText
    const canStopAssistantRun =
        isLoadingState &&
        assistantRun?.status === 'running' &&
        assistantRun?.runId &&
        assistantRun?.kind &&
        chat?.id &&
        (!assistantRun.requestUserId || assistantRun.requestUserId === loggedUserId)

    const stopAssistantRun = async () => {
        if (!canStopAssistantRun || cancellingRun) return
        setCancellingRun(true)
        try {
            await cancelAssistantRun({
                projectId,
                objectType,
                objectId: chat?.id,
                commentId: messageId,
                runKind: assistantRun.kind,
                runId: assistantRun.runId,
            })
        } catch (error) {
            setCancellingRun(false)
            console.error('Failed to stop assistant run', error)
            alert(`Could not stop assistant: ${error.message}`)
        }
    }

    // Process the content
    const processedContent = divideQuotedText(commentText, 'quote')

    const closeEditMode = () => {
        dismissibleRef.current.closeModal()
    }

    useEffect(() => {
        if (dismissibleRef.current.modalIsVisible() && activeChatMessageId !== messageId) {
            closeEditMode()
        }
    }, [activeChatMessageId])

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

    const renderTextContent = (text, lastItem) => {
        const textData = divideCodeText(text)

        return textData.map((data, subIndex) => {
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
                    } else if (line.type === 'h1') {
                        return (
                            <Text
                                key={`header-${lineIndex}`}
                                style={[localStyles.header1, !isLastLine && { marginBottom: 16 }]}
                            >
                                {renderFormattedText(line.segments, localStyles.header1)}
                            </Text>
                        )
                    } else if (line.type === 'h2') {
                        return (
                            <Text
                                key={`header-${lineIndex}`}
                                style={[localStyles.header2, !isLastLine && { marginBottom: 16 }]}
                            >
                                {renderFormattedText(line.segments, localStyles.header2)}
                            </Text>
                        )
                    } else if (line.type === 'h3') {
                        return (
                            <Text
                                key={`header-${lineIndex}`}
                                style={[localStyles.header3, !isLastLine && { marginBottom: 16 }]}
                            >
                                {renderFormattedText(line.segments, localStyles.header3)}
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
        <DismissibleItem
            ref={dismissibleRef}
            defaultComponent={
                <View style={localStyles.messageContentContainer}>
                    {isLoadingState ? (
                        <View style={localStyles.loadingContainer}>
                            {!containsBlockOrSpecialElements(loadingText) ? (
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
                            <View style={localStyles.loadingIndicator}>
                                <ActivityIndicator size="small" color={colors.PrimaryBlue} />
                                {canStopAssistantRun && (
                                    <TouchableOpacity
                                        style={[
                                            localStyles.stopRunButton,
                                            cancellingRun && localStyles.stopRunButtonDisabled,
                                        ]}
                                        onPress={stopAssistantRun}
                                        disabled={cancellingRun}
                                        accessibilityLabel="Stop assistant"
                                    >
                                        <Icon name="x-thicker" size={10} color={colors.UtilityRed200} />
                                        <Text style={localStyles.stopRunButtonText}>
                                            {cancellingRun ? 'Stopping...' : 'Stop'}
                                        </Text>
                                    </TouchableOpacity>
                                )}
                            </View>
                        </View>
                    ) : (
                        <>
                            {processedContent.map((contentPart, index) => {
                                const lastItem = index === processedContent.length - 1
                                const { type, text } = contentPart

                                if (type === 'quote') {
                                    return (
                                        <QuotedText
                                            key={index}
                                            projectId={projectId}
                                            lastItem={lastItem}
                                            quotedText={text}
                                        />
                                    )
                                } else {
                                    return renderTextContent(text, lastItem)
                                }
                            })}
                            {canArchiveLinkedEmail && linkedEmail && (
                                <View style={localStyles.linkedEmailActions}>
                                    <GmailTag
                                        gmailData={linkedEmailGmailData}
                                        showLabel={true}
                                        propStyles={localStyles.linkedEmailTag}
                                    />
                                    <TouchableOpacity
                                        style={localStyles.linkedEmailButton}
                                        onPress={() => onArchiveLinkedEmail([linkedEmail])}
                                        disabled={linkedEmailArchiving || linkedEmailArchived}
                                        accessibilityLabel={translate('Archive email')}
                                    >
                                        {linkedEmailArchiving ? (
                                            <ActivityIndicator size="small" color={colors.Text03} />
                                        ) : (
                                            <Icon
                                                name={linkedEmailArchived ? 'check' : 'archive'}
                                                size={14}
                                                color={colors.Text03}
                                            />
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
                                            <Text style={localStyles.linkedEmailButtonText}>
                                                {translate('Unsubscribe')}
                                            </Text>
                                        </TouchableOpacity>
                                    )}
                                </View>
                            )}
                        </>
                    )}
                </View>
            }
            modalComponent={
                <ChatInput
                    chat={chat}
                    projectId={projectId}
                    chatTitle={chatTitle}
                    members={members}
                    containerStyle={{
                        bottom: undefined,
                        left: undefined,
                        right: undefined,
                        marginRight: 16,
                        marginTop: 8,
                    }}
                    initialText={commentText}
                    editing={true}
                    messageId={messageId}
                    closeEditMode={closeEditMode}
                    creatorId={creatorId}
                    creatorData={creatorData}
                    objectType={objectType}
                    setAmountOfNewCommentsToHighligth={setAmountOfNewCommentsToHighligth}
                />
            }
            onToggleModal={visable => {
                console.log('[ChatEditDebug] message edit modal toggled', {
                    messageId,
                    visible: visable,
                    activeChatMessageId,
                })
                if (!visable) dispatch(setActiveChatMessageId(''))
            }}
        />
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
    stopRunButton: {
        marginLeft: 12,
        minHeight: 24,
        paddingHorizontal: 8,
        borderRadius: 4,
        borderWidth: 1,
        borderColor: colors.UtilityRed200,
        flexDirection: 'row',
        alignItems: 'center',
    },
    stopRunButtonDisabled: {
        opacity: 0.6,
    },
    stopRunButtonText: {
        ...global.caption2,
        color: colors.UtilityRed200,
        marginLeft: 4,
    },
    inlineElement: {
        marginRight: 6,
    },
    linkedEmailActions: {
        alignSelf: 'flex-start',
        marginTop: 8,
        flexDirection: 'row',
        alignItems: 'center',
    },
    linkedEmailTag: {
        marginRight: 8,
    },
    linkedEmailButton: {
        minHeight: 28,
        paddingHorizontal: 8,
        borderRadius: 4,
        borderWidth: 1,
        borderColor: colors.Gray300,
        flexDirection: 'row',
        alignItems: 'center',
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
