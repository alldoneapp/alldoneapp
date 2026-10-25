import React from 'react'
import { StyleSheet, View } from 'react-native'

import GhostBlock from '../UIComponents/Ghosts/GhostBlock'
import { useGhostPulse } from '../UIComponents/Ghosts/ghostAnimation'
import { GHOST_DEFAULT_ROWS } from '../UIComponents/Ghosts/ghostRowCount'
import { translate } from '../../i18n/TranslationService'

// Cycled so a multi-row ghost does not read as a stack of identical bars. The triples are
// (name, info, meta) widths; the avatar and the tag are fixed because the real ones are.
const ROW_WIDTHS = [
    ['42%', '68%', '34%'],
    ['56%', '49%', '30%'],
    ['35%', '77%', '38%'],
    ['48%', '61%', '32%'],
]

/**
 * AT-2385 — contact-shaped loading ghosts for the Contacts list.
 *
 * Geometry mirrors `ContactItem`'s exactly: an 8px top / 10px bottom padded container with
 * the same -8px horizontal bleed, wrapping a 90px `mainRow` (so a ghost row is 108px, the
 * height of the real row) that carries a 48px round avatar, a `marginLeft: 8` text column
 * of three lines, and the absolutely positioned tag block at `top: 8 / right: 8`. Getting
 * this right is the entire point: the arriving rows must not shove the page. When these
 * numbers are touched, `ContactItem.js`'s `localStyles` is the source of truth.
 */
export default function ContactsListSkeleton({ rowCount = GHOST_DEFAULT_ROWS, contactKeys = [] }) {
    const { pulse, reducedMotion } = useGhostPulse()
    const rows = Array.from({ length: Math.max(0, rowCount) })

    return (
        <View
            testID="contacts-list-loading-skeleton"
            accessibilityRole="progressbar"
            accessibilityLabel={translate('Loading contacts')}
        >
            {rows.map((_, index) => {
                const [nameWidth, infoWidth, metaWidth] = ROW_WIDTHS[index % ROW_WIDTHS.length]
                return (
                    <View
                        key={contactKeys[index] || index}
                        testID="contact-loading-skeleton-row"
                        style={localStyles.row}
                    >
                        <View testID="contact-loading-skeleton-main-row" style={localStyles.mainRow}>
                            <View style={localStyles.avatarContainer}>
                                <GhostBlock style={localStyles.avatar} pulse={pulse} reducedMotion={reducedMotion} />
                            </View>

                            <View style={localStyles.userData}>
                                <View style={localStyles.nameLine}>
                                    <GhostBlock
                                        style={[localStyles.name, { width: nameWidth }]}
                                        pulse={pulse}
                                        reducedMotion={reducedMotion}
                                    />
                                </View>
                                <View style={localStyles.infoLine}>
                                    <GhostBlock
                                        style={[localStyles.info, { width: infoWidth }]}
                                        pulse={pulse}
                                        reducedMotion={reducedMotion}
                                        soft
                                    />
                                </View>
                                <View style={localStyles.metaLine}>
                                    <GhostBlock
                                        style={[localStyles.meta, { width: metaWidth }]}
                                        pulse={pulse}
                                        reducedMotion={reducedMotion}
                                        soft
                                    />
                                </View>
                            </View>

                            <View style={localStyles.buttonSection}>
                                <GhostBlock style={localStyles.tag} pulse={pulse} reducedMotion={reducedMotion} soft />
                            </View>
                        </View>
                    </View>
                )
            })}
        </View>
    )
}

const localStyles = StyleSheet.create({
    // ContactItem.localStyles.container, minus the swipe/press affordances a ghost has no
    // use for. The negative horizontal margin plus matching padding is what keeps the ghost
    // aligned with the real rows inside the contacts list's own padding.
    row: {
        paddingTop: 8,
        paddingBottom: 10,
        marginLeft: -8,
        marginRight: -8,
        paddingLeft: 8,
        paddingRight: 8,
        borderRadius: 4,
        flexDirection: 'column',
        overflow: 'hidden',
    },
    mainRow: {
        flexDirection: 'row',
        width: '100%',
        height: 90,
    },
    avatarContainer: {
        justifyContent: 'flex-start',
        overflow: 'hidden',
        width: 48,
        height: 48,
        borderRadius: 100,
    },
    avatar: {
        width: 48,
        height: 48,
        borderRadius: 100,
    },
    userData: {
        flex: 1,
        minWidth: 0,
        alignSelf: 'flex-start',
        marginLeft: 8,
    },
    // The three text lines keep the real rows' line boxes (body1 24, body2 22, caption2 20)
    // so the bars sit where the text will.
    nameLine: {
        height: 24,
        justifyContent: 'center',
    },
    name: {
        height: 14,
        borderRadius: 7,
    },
    infoLine: {
        height: 22,
        justifyContent: 'center',
    },
    info: {
        height: 12,
        borderRadius: 6,
    },
    metaLine: {
        height: 20,
        justifyContent: 'center',
    },
    meta: {
        height: 10,
        borderRadius: 5,
    },
    buttonSection: {
        position: 'absolute',
        top: 8,
        right: 8,
        marginLeft: 8,
        flexDirection: 'row',
    },
    tag: {
        width: 44,
        height: 20,
        borderRadius: 10,
    },
})
