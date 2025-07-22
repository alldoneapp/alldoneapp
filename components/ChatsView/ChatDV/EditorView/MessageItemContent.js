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

// Helper function to process headers in text
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

    // Process the content
    const processedContent = divideQuotedText(commentText, 'quote')

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

    const renderTextContent = (text, lastItem) => {
        const textData = divideCodeText(text)
        return textData.map((data, subIndex) => {
            const lastItemInsideItem = lastItem && subIndex === textData.length - 1
            if (data.type === 'code') {
                return <CodeText key={`text-${subIndex}`} lastItem={lastItemInsideItem} text={data.text} />
            } else {
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
                        return (
                            <CommentElementsParser
                                key={`text-${lineIndex}`}
                                comment={line.text}
                                containerStyle={!isLastLine && { marginBottom: 16 }}
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
})
