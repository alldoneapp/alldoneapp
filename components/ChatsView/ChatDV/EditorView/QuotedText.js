import React from 'react'
import { View, StyleSheet } from 'react-native'

import global, { colors } from '../../../styles/global'
import CommentElementsParser from '../../../Feeds/TextParser/CommentElementsParser'
import { divideQuotedText } from './quoteParserFunctions'

export default function QuotedText({ projectId, lastItem, quotedText, backgroundColor, textColor }) {
    const textsData = divideQuotedText(quotedText, 'header')
    return (
        <View
            style={[!lastItem && { marginBottom: 16 }, localStyles.container, backgroundColor && { backgroundColor }]}
        >
            {textsData.map(data => {
                const { type, text } = data
                return type === 'header' ? (
                    <CommentElementsParser
                        comment={text}
                        entryStyle={[localStyles.boldText, textColor && { color: textColor }]}
                        projectId={projectId}
                        inChat={true}
                    />
                ) : (
                    <CommentElementsParser
                        comment={text}
                        entryStyle={[localStyles.text, textColor && { color: textColor }]}
                        projectId={projectId}
                        inChat={true}
                    />
                )
            })}
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        backgroundColor: colors.Grey200,
        paddingHorizontal: 14,
        paddingBottom: 9,
        paddingTop: 9,
        marginRight: 16,
    },
    text: {
        ...global.body1,
        color: colors.Text02,
    },
    boldText: {
        ...global.subtitle2,
        color: colors.Text02,
    },
})
