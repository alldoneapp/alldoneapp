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

// Render inline formatted text segments
const renderFormattedText = (segments, baseStyle) => {
    if (!segments || segments.length === 0) return null
    return segments.map((segment, idx) => {
        const style = [
            baseStyle,
            segment.bold && { fontWeight: 'bold' },
            segment.italic && { fontStyle: 'italic' },
            segment.strikethrough && { textDecorationLine: 'line-through' },
        ]
        return (
            <Text key={idx} style={style}>
                {segment.text}
            </Text>
        )
    })
}

export default function Comment({ containerStyle, projectId, comment }) {
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)

    const { commentText, lastChangeDate, creatorId } = comment

    const { photoURL, displayName } = useGetUserPresentationData(creatorId)

    const textsFiltered = divideQuotedText(commentText, 'quote')
    const date = getTimestampInMilliseconds(lastChangeDate) ?? Date.now()

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
                                    <Text style={localStyles.comment}>
                                        {renderFormattedText(line.segments, localStyles.comment)}
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
                                        {renderFormattedText(line.segments, localStyles.comment)}
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
                                        {renderFormattedText(line.segments, localStyles.comment)}
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
                                    {renderFormattedText(segments, localStyles.comment)}
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
})
