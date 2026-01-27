import React from 'react'
import { StyleSheet, TouchableOpacity, View, ActivityIndicator, Text } from 'react-native'

import global, { colors } from '../../../styles/global'
import CommentElementsParser from '../../../Feeds/TextParser/CommentElementsParser'
import { divideQuotedText } from './quoteParserFunctions'
import QuotedText from './QuotedText'
import ChatInput from './ChatInput'
import DismissibleItem from '../../../UIComponents/DismissibleItem'
import { useEffect } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { setActiveChatMessageId } from '../../../../redux/actions'
import { divideCodeText } from './codeParserFunctions'
import CodeText from './CodeText'
import { parseMarkdownLines, parseInlineFormatting } from './markdownParserFunctions'
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

export default function MessageItemContent({
    messageId,
    creatorId,
    projectId,
    commentText,
    chatTitle,
    members,
    chat,
    blockOpen,
    dismissibleRef,
    creatorData,
    objectType,
    setAmountOfNewCommentsToHighligth,
    isLoading,
}) {
    const dispatch = useDispatch()
    const showFloatPopup = useSelector(state => state.showFloatPopup)
    const activeChatMessageId = useSelector(state => state.activeChatMessageId)
    const userIsAnonymous = useSelector(state => state.loggedUser.isAnonymous)

    // Check if this message is in loading state
    const isLoadingState = isLoading && creatorData?.isAssistant

    // DEBUG: Log original AI assistant answer
    if (creatorData?.isAssistant) {
        console.log('=== AI ASSISTANT MESSAGE DEBUG (Chat View) ===')
        console.log('Original commentText:', JSON.stringify(commentText))
        console.log('Original commentText (raw):', commentText)
    }

    // Process the content
    const processedContent = divideQuotedText(commentText, 'quote')

    // DEBUG: Log after quote processing
    if (creatorData?.isAssistant) {
        console.log('After divideQuotedText:', JSON.stringify(processedContent))
    }

    const enableEditMode = () => {
        if (!blockOpen && activeChatMessageId === '' && !showFloatPopup) {
            dispatch(setActiveChatMessageId(messageId))
            dismissibleRef.current.openModal()
        }
    }

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

            // Parse the segment text for links, tags, mentions, emails
            const parsedElements = parseFeedComment(segment.text, false, segment.bold)

            // DEBUG: Log parsed elements
            if (creatorData?.isAssistant) {
                console.log('parseFeedComment input:', JSON.stringify(segment.text))
                console.log('parseFeedComment output:', JSON.stringify(parsedElements))
            }

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

    const renderTextContent = (text, lastItem) => {
        // DEBUG: Log text before code parsing
        if (creatorData?.isAssistant) {
            console.log('renderTextContent input:', JSON.stringify(text))
        }

        const textData = divideCodeText(text)

        // DEBUG: Log after code block parsing
        if (creatorData?.isAssistant) {
            console.log('After divideCodeText:', JSON.stringify(textData))
        }

        return textData.map((data, subIndex) => {
            const lastItemInsideItem = lastItem && subIndex === textData.length - 1
            if (data.type === 'code') {
                return <CodeText key={`text-${subIndex}`} lastItem={lastItemInsideItem} text={data.text} />
            } else {
                const processedLines = parseMarkdownLines(data.text)

                // DEBUG: Log after markdown parsing
                if (creatorData?.isAssistant) {
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
                        // For regular text, check if it has inline formatting
                        const segments = parseInlineFormatting(line.text)
                        const hasFormatting = segments.some(s => s.bold || s.italic || s.strikethrough)

                        if (hasFormatting) {
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
                <TouchableOpacity style={{ marginLeft: 36 }} onPress={enableEditMode} disabled={userIsAnonymous}>
                    {isLoadingState ? (
                        <View style={localStyles.loadingContainer}>
                            <CommentElementsParser
                                comment={commentText}
                                containerStyle={{ marginBottom: 8 }}
                                entryStyle={localStyles.loadingText}
                                projectId={projectId}
                                inChat={true}
                            />
                            <View style={localStyles.loadingIndicator}>
                                <ActivityIndicator size="small" color={colors.PrimaryBlue} />
                            </View>
                        </View>
                    ) : (
                        processedContent.map((contentPart, index) => {
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
                        })
                    )}
                </TouchableOpacity>
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
                if (!visable) dispatch(setActiveChatMessageId(''))
            }}
        />
    )
}

const localStyles = StyleSheet.create({
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
        width: 16,
    },
    numberedPoint: {
        ...global.body1,
        color: colors.Text02,
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
        alignItems: 'flex-start',
    },
    inlineElement: {
        marginRight: 6,
    },
})
