import React from 'react'
import { StyleSheet, View } from 'react-native'

import GhostBlock from '../../UIComponents/Ghosts/GhostBlock'
import { useGhostPulse } from '../../UIComponents/Ghosts/ghostAnimation'
import { GHOST_DEFAULT_ROWS } from '../../UIComponents/Ghosts/ghostRowCount'
import { translate } from '../../../i18n/TranslationService'

// A comment is free text, so unlike a task or note row its height genuinely varies. The
// ghosts alternate between one- and two-line bodies so the block reads as a conversation
// rather than a stack of identical bars.
const BODY_LINES = [['86%'], ['92%', '54%'], ['73%'], ['90%', '68%']]

/**
 * AT-2382 — message-shaped ghosts for the chat thread's "show earlier".
 *
 * These render at the TOP of the scroll view, because that is where older messages are
 * prepended. Note `showEarlier` also nudges the scroll position to y=25, so the ghost's
 * height is part of that resting position — keep it close to a real `MessageItem`
 * (`paddingVertical: 8`, `marginLeft: 14`, 20px avatar + name line, then the body).
 */
export default function MessagesSkeleton({ rowCount = GHOST_DEFAULT_ROWS }) {
    const { pulse, reducedMotion } = useGhostPulse()
    const rows = Array.from({ length: Math.max(0, rowCount) })

    return (
        <View
            testID="messages-loading-skeleton"
            accessibilityRole="progressbar"
            accessibilityLabel={translate('Loading chats')}
        >
            {rows.map((_, index) => {
                const lines = BODY_LINES[index % BODY_LINES.length]
                return (
                    <View key={index} testID="message-loading-skeleton-row" style={localStyles.row}>
                        <View style={localStyles.header}>
                            <GhostBlock style={localStyles.avatar} pulse={pulse} reducedMotion={reducedMotion} />
                            <GhostBlock style={localStyles.name} pulse={pulse} reducedMotion={reducedMotion} soft />
                        </View>
                        <View style={localStyles.body}>
                            {lines.map((width, lineIndex) => (
                                <GhostBlock
                                    key={lineIndex}
                                    style={[localStyles.line, { width }]}
                                    pulse={pulse}
                                    reducedMotion={reducedMotion}
                                    soft
                                />
                            ))}
                        </View>
                    </View>
                )
            })}
        </View>
    )
}

const localStyles = StyleSheet.create({
    // MessageItem's root frame.
    row: {
        paddingVertical: 8,
        marginLeft: 14,
        paddingBottom: 16,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        height: 20,
    },
    avatar: {
        width: 20,
        height: 20,
        borderRadius: 10,
    },
    name: {
        width: 96,
        height: 10,
        marginLeft: 8,
        borderRadius: 5,
    },
    body: {
        marginLeft: 28,
        marginTop: 8,
    },
    line: {
        height: 12,
        marginBottom: 6,
        borderRadius: 6,
    },
})
