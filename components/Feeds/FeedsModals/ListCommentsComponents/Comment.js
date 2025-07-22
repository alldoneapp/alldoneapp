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
import useGetUserPresentationData from '../../../ContactsView/Utils/useGetUserPresentationData'

// Helper function to process headers in text - Copied from MessageItemContent.js
const processHeaders = text => {
    const lines = text.split('\n')
    return lines.map(line => {
        const trimmedLine = line.trim()
        if (trimmedLine.startsWith('### ')) {
            return { type: 'h3', text: trimmedLine.substring(4) }
        } else if (trimmedLine.startsWith('## ')) {
            return { type: 'h2', text: trimmedLine.substring(3) }
        } else if (trimmedLine.startsWith('# ')) {
            return { type: 'h1', text: trimmedLine.substring(2) }
        }
        return { type: 'text', text: line }
    })
}

export default function Comment({ containerStyle, projectId, comment }) {
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)

    const { commentText, lastChangeDate, creatorId } = comment

    const { photoURL, displayName } = useGetUserPresentationData(creatorId)

    const textsFiltered = divideQuotedText(commentText, 'quote')
    date = lastChangeDate ? lastChangeDate.seconds * 1000 : Date.now()

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
                        const textData = divideCodeText(text)
                        return textData.map((data, index) => {
                            const lastItemInsideItem = lastItem && index === textData.length - 1
                            if (data.type === 'code') {
                                return (
                                    <CodeText
                                        key={index}
                                        lastItem={lastItemInsideItem}
                                        text={data.text}
                                        backgroundColor={colors.Secondary200}
                                        textColor={colors.Text04}
                                    />
                                )
                            } else {
                                // Apply header processing here
                                const processedLines = processHeaders(data.text)
                                return processedLines.map((line, lineIndex) => {
                                    const isLastLine = lastItemInsideItem && lineIndex === processedLines.length - 1
                                    if (line.type === 'h1') {
                                        return (
                                            <Text
                                                key={`header-${lineIndex}`}
                                                style={[localStyles.header1, !isLastLine && { marginBottom: 16 }]}
                                            >
                                                {line.text}
                                            </Text>
                                        )
                                    } else if (line.type === 'h2') {
                                        return (
                                            <Text
                                                key={`header-${lineIndex}`}
                                                style={[localStyles.header2, !isLastLine && { marginBottom: 16 }]}
                                            >
                                                {line.text}
                                            </Text>
                                        )
                                    } else if (line.type === 'h3') {
                                        return (
                                            <Text
                                                key={`header-${lineIndex}`}
                                                style={[localStyles.header3, !isLastLine && { marginBottom: 16 }]}
                                            >
                                                {line.text}
                                            </Text>
                                        )
                                    } else {
                                        // Use CommentElementsParser for regular text lines
                                        return (
                                            <CommentElementsParser
                                                key={`text-${lineIndex}`}
                                                comment={line.text}
                                                containerStyle={!isLastLine && { marginBottom: 16 }} // Apply marginBottom here instead of outer container
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
    // Add header styles - Corrected from MessageItemContent.js
    header1: {
        fontFamily: 'Roboto-Regular',
        fontSize: 32,
        lineHeight: 50,
        color: colors.Text04, // Adjusted color for popup context
        fontWeight: '600',
    },
    header2: {
        fontFamily: 'Roboto-Medium',
        fontSize: 24,
        lineHeight: 32,
        color: colors.Text04, // Adjusted color for popup context
        fontWeight: '500',
    },
    header3: {
        fontFamily: 'Roboto-Medium',
        fontSize: 20,
        lineHeight: 28,
        color: colors.Text04, // Adjusted color for popup context
        fontWeight: '500',
    },
})
