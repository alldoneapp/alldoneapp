import React, { useMemo } from 'react'
import { StyleSheet, Text, View } from 'react-native'

import styles, { colors, windowTagStyle } from '../styles/global'
import WordsList from '../UIControls/SocialText/WordsList'
import {
    ATTACHMENT_ELEMENT,
    IMAGE_ELEMENT,
    MILESTONE_TAG_ELEMENT,
    TEXT_ELEMENT,
    URL_ELEMENT,
    VIDEO_ELEMENT,
    parseFeedComment,
} from '../Feeds/Utils/feedCommentParser'
import { cleanTextMetaData, getAttachmentData, getImageData, getVideoData } from '../../functions/Utils/parseTextUtils'

// The detector also accepts bare domains. Validate after adding a protocol, before
// handing a destination to LinkTag or FileDownloadableTag; neither accepts arbitrary schemes.
const safeDestination = value => {
    if (!value || /[\s\\\u0000-\u001f\u007f]/.test(value)) return null
    const destination = /^(https?|ftp):\/\//i.test(value) ? value : `https://${value}`
    try {
        const url = new URL(destination)
        if (!['http:', 'https:', 'ftp:'].includes(url.protocol) || !url.hostname) return null
        // Reject disguised schemes such as javascript:example.com rather than
        // treating them as a bare domain. Domain:port remains supported.
        if (
            !/^(https?|ftp):\/\//i.test(value) &&
            /^[a-z][a-z\d+.-]*:/i.test(value) &&
            !/^[^:]+:\d+(?:[/?#]|$)/.test(value)
        ) {
            return null
        }
        return destination.replace(/^(https?|ftp):/i, protocol => protocol.toLowerCase())
    } catch {
        return null
    }
}

export const parseTaskTagTitle = text =>
    parseFeedComment(text.replace(/<\/?[^>]+>/gi, '').replace(/\s+/g, ' '), false, false).map(word => {
        const plainText = () => ({ type: TEXT_ELEMENT, text: cleanTextMetaData(word.text || word.link) })
        if (word.type === URL_ELEMENT) {
            const link = safeDestination(word.link)
            return link ? { ...word, link } : plainText()
        }
        const mediaData = {
            [ATTACHMENT_ELEMENT]: getAttachmentData,
            [IMAGE_ELEMENT]: getImageData,
            [VIDEO_ELEMENT]: getVideoData,
        }[word.type]
        if (mediaData) {
            const { uri } = mediaData(word.text)
            if (!/^(https?|ftp):\/\//i.test(uri || '') || !safeDestination(uri)) return plainText()
        }
        // Milestone markers have no renderer in WordsList; retain their readable label.
        return word.type === MILESTONE_TAG_ELEMENT ? plainText() : word
    })

const stopPropagation = event => event.stopPropagation()

export default function TaskTagTitle({ text, projectId, disabled, style }) {
    const words = useMemo(() => parseTaskTagTitle(text), [text])
    const blockDisabledAction = event => {
        if (disabled) {
            event.preventDefault()
            event.stopPropagation()
        }
    }

    if (words.every(word => word.type === TEXT_ELEMENT)) {
        return (
            <Text style={[localStyles.text, style, windowTagStyle()]} numberOfLines={1}>
                {cleanTextMetaData(text)}
            </Text>
        )
    }

    return (
        <View style={[localStyles.container, style]}>
            {words.map((word, index) =>
                word.type === TEXT_ELEMENT ? (
                    <Text key={index} style={localStyles.word} numberOfLines={1}>
                        {word.text}
                    </Text>
                ) : (
                    <span
                        key={index}
                        style={{ display: 'inline-flex', flexShrink: 0 }}
                        onClickCapture={blockDisabledAction}
                        onAuxClickCapture={blockDisabledAction}
                        onClick={stopPropagation}
                        onAuxClick={stopPropagation}
                        onKeyDownCapture={event => {
                            if (event.key === 'Enter' || event.key === ' ') blockDisabledAction(event)
                        }}
                        onKeyUpCapture={event => {
                            if (event.key === 'Enter' || event.key === ' ') blockDisabledAction(event)
                        }}
                        onKeyDown={stopPropagation}
                    >
                        <WordsList
                            wordList={[word]}
                            projectId={projectId}
                            numberOfLines={1}
                            wrapText={false}
                            inFeedComment={true}
                        />
                    </span>
                )
            )}
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        alignItems: 'center',
        flexShrink: 1,
        overflow: 'hidden',
        height: 24,
    },
    text: {
        ...styles.subtitle2,
        color: colors.Primary100,
    },
    word: {
        ...styles.subtitle2,
        color: colors.Primary100,
        whiteSpace: 'nowrap',
        flexShrink: 0,
        marginRight: 4.3,
    },
})
