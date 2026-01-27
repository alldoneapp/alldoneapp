import React from 'react'
import { Image, StyleSheet, Text, View } from 'react-native'
import moment from 'moment'
import { useSelector } from 'react-redux'

import styles, { colors } from '../../../styles/global'
import CommentElementsParser from '../../TextParser/CommentElementsParser'
import { divideQuotedText } from '../../../ChatsView/ChatDV/EditorView/quoteParserFunctions'
import QuotedText from '../../../ChatsView/ChatDV/EditorView/QuotedText'
import CodeText from '../../../ChatsView/ChatDV/EditorView/CodeText'
import { divideCodeText } from '../../../ChatsView/ChatDV/EditorView/codeParserFunctions'
import { parseMarkdownLines, parseInlineFormatting } from '../../../ChatsView/ChatDV/EditorView/markdownParserFunctions'
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

        // Parse the segment text for links, tags, mentions, emails
        const parsedElements = parseFeedComment(segment.text, false, segment.bold)

        return parsedElements.map((element, elemIdx) => {
            const key = `${segmentIdx}-${elemIdx}`
            const { type, text, link, email } = element
            const isLastElement = elemIdx === parsedElements.length - 1
            // Add space after each word except the last one in the segment
            const spaceSuffix = isLastElement ? '' : ' '

            if (type === TEXT_ELEMENT) {
                // Render text element, including space suffix even if text is empty
                // This preserves leading/trailing spaces from the original text
                if (text || spaceSuffix) {
                    return (
                        <Text key={key} style={style}>
                            {text}
                            {spaceSuffix}
                        </Text>
                    )
                }
                return null
            } else if (type === HASH_ELEMENT) {
                return (
                    <React.Fragment key={key}>
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
                    {text || link || email || ''}
                    {spaceSuffix}
                </Text>
            )
        })
    })
}

export default function Comment({ containerStyle, projectId, comment }) {
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)

    const { commentText, lastChangeDate, creatorId, creatorType } = comment

    const { photoURL, displayName } = useGetUserPresentationData(creatorId)

    // Check if this is an assistant comment
    const isAssistantComment = creatorType === 'assistant'

    // DEBUG: Log original AI assistant answer in comment popup
    if (isAssistantComment) {
        console.log('=== AI ASSISTANT MESSAGE DEBUG (Comment Popup) ===')
        console.log('Original commentText:', JSON.stringify(commentText))
        console.log('Original commentText (raw):', commentText)
    }

    const textsFiltered = divideQuotedText(commentText, 'quote')

    // DEBUG: Log after quote processing
    if (isAssistantComment) {
        console.log('After divideQuotedText:', JSON.stringify(textsFiltered))
    }

    const date = getTimestampInMilliseconds(lastChangeDate) ?? Date.now()

    // Track link counter for renderFormattedText
    let linkCounter = 0
    const getLinkCounter = () => {
        linkCounter++
        return linkCounter
    }

    const renderTextContent = (text, lastItem) => {
        // DEBUG: Log text before code parsing
        if (isAssistantComment) {
            console.log('renderTextContent input:', JSON.stringify(text))
        }

        const textData = divideCodeText(text)

        // DEBUG: Log after code block parsing
        if (isAssistantComment) {
            console.log('After divideCodeText:', JSON.stringify(textData))
        }

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

                // DEBUG: Log after markdown parsing
                if (isAssistantComment) {
                    console.log('After parseMarkdownLines:', JSON.stringify(processedLines))
                }
                return processedLines.map((line, lineIndex) => {
                    const isLastLine = lastItemInsideItem && lineIndex === processedLines.length - 1
                    const marginStyle = !isLastLine ? { marginBottom: 4 } : null

                    if (line.type === 'hr') {
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
                                {renderFormattedText(line.segments, localStyles.header1, projectId, getLinkCounter)}
                            </Text>
                        )
                    } else if (line.type === 'h2') {
                        return (
                            <Text
                                key={`header-${lineIndex}`}
                                style={[localStyles.header2, !isLastLine && { marginBottom: 16 }]}
                            >
                                {renderFormattedText(line.segments, localStyles.header2, projectId, getLinkCounter)}
                            </Text>
                        )
                    } else if (line.type === 'h3') {
                        return (
                            <Text
                                key={`header-${lineIndex}`}
                                style={[localStyles.header3, !isLastLine && { marginBottom: 16 }]}
                            >
                                {renderFormattedText(line.segments, localStyles.header3, projectId, getLinkCounter)}
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
        width: 16,
    },
    numberedPoint: {
        ...styles.body2,
        color: colors.Grey400,
        marginRight: 8,
        minWidth: 20,
    },
    bulletContent: {
        flex: 1,
    },
    checkboxIcon: {
        marginRight: 8,
        marginTop: 2,
    },
    inlineElement: {
        marginRight: 6,
    },
})
