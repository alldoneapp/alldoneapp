import React from 'react'
import { StyleSheet, View } from 'react-native'

import GhostBlock from '../UIComponents/Ghosts/GhostBlock'
import { useGhostPulse } from '../UIComponents/Ghosts/ghostAnimation'
import { GHOST_DEFAULT_ROWS } from '../UIComponents/Ghosts/ghostRowCount'
import { CHAT_AVATAR_COLUMN_GUTTER, CHAT_AVATAR_COLUMN_WIDTH } from './chatRowLayout'
import { translate } from '../../i18n/TranslationService'

const TITLE_WIDTHS = ['52%', '71%', '43%', '63%']

/**
 * AT-2382 — chat-shaped loading ghosts for the chat list "Show more".
 *
 * Geometry mirrors `ChatItem`'s row: `paddingVertical: 18` around a 24px title line, and
 * the same 48+16 avatar column the real rows reserve (imported from `chatRowLayout` rather
 * than re-typed, so the ghost cannot drift out of alignment when that column is retuned).
 */
export default function ChatsListSkeleton({ rowCount = GHOST_DEFAULT_ROWS, chatKeys = [] }) {
    const { pulse, reducedMotion } = useGhostPulse()
    const rows = Array.from({ length: Math.max(0, rowCount) })

    return (
        <View
            testID="chats-list-loading-skeleton"
            accessibilityRole="progressbar"
            accessibilityLabel={translate('Loading chats')}
        >
            {rows.map((_, index) => (
                <View key={chatKeys[index] || index} testID="chat-loading-skeleton-row" style={localStyles.row}>
                    <View style={localStyles.avatarColumn}>
                        <GhostBlock style={localStyles.avatar} pulse={pulse} reducedMotion={reducedMotion} />
                    </View>
                    <View style={localStyles.body}>
                        <GhostBlock
                            style={[localStyles.title, { width: TITLE_WIDTHS[index % TITLE_WIDTHS.length] }]}
                            pulse={pulse}
                            reducedMotion={reducedMotion}
                        />
                    </View>
                    <GhostBlock style={localStyles.tag} pulse={pulse} reducedMotion={reducedMotion} soft />
                </View>
            ))}
        </View>
    )
}

const localStyles = StyleSheet.create({
    // ChatItem.localStyles.container.
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 18,
        paddingHorizontal: 8,
        marginHorizontal: -8,
        borderRadius: 4,
    },
    avatarColumn: {
        width: CHAT_AVATAR_COLUMN_WIDTH,
        marginRight: CHAT_AVATAR_COLUMN_GUTTER,
        alignItems: 'center',
    },
    avatar: {
        width: 24,
        height: 24,
        borderRadius: 12,
    },
    body: {
        flex: 1,
        minWidth: 0,
    },
    title: {
        height: 12,
        borderRadius: 6,
    },
    tag: {
        width: 40,
        height: 16,
        marginLeft: 10,
        borderRadius: 8,
    },
})
