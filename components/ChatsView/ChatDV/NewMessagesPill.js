import React from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'

import Icon from '../../Icon'
import global, { colors } from '../../styles/global'
import { translate } from '../../../i18n/TranslationService'
import useHomeIndicatorLift from '../../../hooks/useHomeIndicatorLift'
import { CHAT_BOARD_CONTENT_OFFSET, getNewMessagesPillBottom } from './chatComposerLayout'

// White on Primary100, the same literal the primary `Button` uses for its own label — there is no
// white token in the palette.
const PILL_FOREGROUND = '#FFFFFF'

/**
 * "A new answer arrived while you were reading further up" (AT-2439).
 *
 * The chat follows the newest message whenever the reader is parked at it, and deliberately does
 * NOT when they are not — moving someone who is mid-sentence in an older message is worse than the
 * problem it would solve. That leaves one gap: without a signal, an answer arriving below the fold
 * is completely invisible, and the reader has no way of knowing there is anything to come back to.
 * This is that signal, and pressing it is the way back.
 *
 * It renders through the scroller's `fixedChildren`, so it floats over the messages instead of
 * taking part in their layout — a pill that pushed the thread down as it appeared would move the
 * text the reader is in the middle of, which is exactly what the pin is careful not to do.
 *
 * Floating over the messages is the point; floating over the COMPOSER is not. Its `bottom` comes
 * from `chatComposerLayout` because the scroller's own bottom edge is not the edge the user sees —
 * the composer is lifted over it by a relative offset (and further on an iOS standalone PWA), so a
 * pill anchored to the scroller alone lands underneath an opaque box. See that module's header.
 */
export default function NewMessagesPill({ onPress }) {
    // 0 on desktop, Android and browser tabs, so this only moves where the composer itself moves.
    const homeIndicatorLift = useHomeIndicatorLift()

    return (
        <View style={[localStyles.container, { bottom: getNewMessagesPillBottom(homeIndicatorLift) }]}>
            <TouchableOpacity
                style={localStyles.pill}
                onPress={onPress}
                accessibilityRole="button"
                accessibilityLabel={translate('Jump to newest message')}
            >
                <Text style={localStyles.text}>{translate('New message')}</Text>
                <Icon name="arrow-down" size={16} color={PILL_FOREGROUND} />
            </TouchableOpacity>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        position: 'absolute',
        // Cancels the scroller's own -13 margin so the pill centres on the composer frame below it
        // rather than on the message column, which is pulled left of it. `bottom` is applied by the
        // component, because it depends on the home-indicator lift.
        left: CHAT_BOARD_CONTENT_OFFSET,
        right: 0,
        alignItems: 'center',
        // The strip spans the full width but must not swallow taps on the messages behind it; the
        // pill itself opts back in below. (CSS `none` on a parent still lets a child re-enable it —
        // this is the style-prop spelling of RN's `box-none`, which is deprecated in RNW.)
        pointerEvents: 'none',
    },
    pill: {
        pointerEvents: 'auto',
        flexDirection: 'row',
        alignItems: 'center',
        height: 32,
        paddingLeft: 12,
        paddingRight: 8,
        borderRadius: 16,
        backgroundColor: colors.Primary100,
        // The thread scrolls underneath it, so it needs to read as floating rather than as part of
        // the message it happens to be over. Same shadow the app's other floating elements use;
        // the RN `shadow*` props are deprecated in react-native-web.
        boxShadow: '0px 4px 16px rgba(78,93,120,0.56)',
    },
    text: {
        ...global.subtitle2,
        color: PILL_FOREGROUND,
        marginRight: 4,
    },
})
