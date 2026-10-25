import React from 'react'
import { StyleSheet, View } from 'react-native'

import GhostBlock from '../UIComponents/Ghosts/GhostBlock'
import { useGhostPulse } from '../UIComponents/Ghosts/ghostAnimation'
import { GHOST_DEFAULT_ROWS } from '../UIComponents/Ghosts/ghostRowCount'
import { translate } from '../../i18n/TranslationService'

// A feed card is an object header plus N activity entries, so the ghosts vary the entry
// count as well as the widths.
const CARD_SHAPES = [
    { title: '54%', entries: ['72%', '48%'] },
    { title: '68%', entries: ['61%'] },
    { title: '44%', entries: ['80%', '55%', '39%'] },
    { title: '61%', entries: ['66%', '42%'] },
]

/**
 * AT-2382 — feed-card ghosts for the global feed's "show more".
 *
 * Mirrors the real card: a `minHeight: 60` header (24px avatar, `paddingLeft: 16`,
 * description at `paddingLeft: 12` — see `TaskObjectHeader`) followed by `RegularFeed`
 * entries (20px avatar, `marginLeft: 16`), with the 24px gap `FeedsList` puts between
 * cards.
 */
export default function FeedsListSkeleton({ rowCount = GHOST_DEFAULT_ROWS }) {
    const { pulse, reducedMotion } = useGhostPulse()
    const cards = Array.from({ length: Math.max(0, rowCount) })

    return (
        <View
            testID="feeds-list-loading-skeleton"
            accessibilityRole="progressbar"
            accessibilityLabel={translate('Loading updates')}
        >
            {cards.map((_, index) => {
                const shape = CARD_SHAPES[index % CARD_SHAPES.length]
                return (
                    <View key={index} testID="feed-loading-skeleton-card" style={localStyles.card}>
                        <View style={localStyles.header}>
                            <GhostBlock style={localStyles.headerAvatar} pulse={pulse} reducedMotion={reducedMotion} />
                            <View style={localStyles.headerText}>
                                <GhostBlock
                                    style={[localStyles.headerTitle, { width: shape.title }]}
                                    pulse={pulse}
                                    reducedMotion={reducedMotion}
                                />
                            </View>
                        </View>
                        {shape.entries.map((width, entryIndex) => (
                            <View key={entryIndex} style={localStyles.entry}>
                                <GhostBlock
                                    style={localStyles.entryAvatar}
                                    pulse={pulse}
                                    reducedMotion={reducedMotion}
                                    soft
                                />
                                <GhostBlock
                                    style={[localStyles.entryText, { width }]}
                                    pulse={pulse}
                                    reducedMotion={reducedMotion}
                                    soft
                                />
                            </View>
                        ))}
                    </View>
                )
            })}
        </View>
    )
}

const localStyles = StyleSheet.create({
    // FeedsList puts 24 between cards.
    card: {
        marginBottom: 24,
    },
    header: {
        minHeight: 60,
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 8,
        paddingLeft: 16,
    },
    headerAvatar: {
        width: 24,
        height: 24,
        borderRadius: 12,
    },
    headerText: {
        flex: 1,
        minWidth: 0,
        paddingLeft: 12,
    },
    headerTitle: {
        height: 12,
        borderRadius: 6,
    },
    entry: {
        flexDirection: 'row',
        alignItems: 'center',
        marginLeft: 16,
        paddingVertical: 1,
        marginBottom: 6,
    },
    entryAvatar: {
        width: 20,
        height: 20,
        borderRadius: 10,
    },
    entryText: {
        height: 10,
        marginLeft: 4,
        borderRadius: 5,
    },
})
