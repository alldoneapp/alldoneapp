import React, { useLayoutEffect, useRef, useState } from 'react'
import { Animated, StyleSheet, View } from 'react-native'

import { colors } from '../../../../styles/global'

/**
 * AT-2404 — the line that crosses a task title out when it is checked off.
 *
 * Drawn as an absolutely-positioned, `pointerEvents="none"` sibling of the title text, following
 * the same rule as `TaskRoutingActivityOverlay`: decoration never joins the layout, so it cannot
 * change the row's height, reflow the title or swallow a tap.
 *
 * WHY NOT `textDecorationLine: 'line-through'` — it is not animatable (it is on or off), and the
 * title is not a plain string: `SocialText` renders hashtags, mentions, links and the leading
 * priority/Gmail chips as separate nested elements, so a decoration set on the parent `<Text>` is
 * at the mercy of how each of those children happens to be styled. An explicit line is fully
 * controlled and can be swept.
 *
 * ONE ANIMATED NODE FOR ALL LINES. The scaler scales on X from `transformOrigin: 'left'`, and the
 * per-line bars inside it are positioned absolutely — so a title wrapped to three lines is crossed
 * out by one native-driven `scaleX`, not three animations that could drift apart. `transformOrigin`
 * is passed through verbatim by react-native-web 0.21's `preprocess` (it becomes CSS
 * `transform-origin`), which is what makes the line grow from the left edge rather than from its
 * own centre.
 */

const STRIKE_THICKNESS = 2

// The bright tip that travels along with the line's leading edge. Without it the bar is a shape
// being scaled; with it, the line reads as being DRAWN, which is the whole difference between the
// effect looking mechanical and looking deliberate. Only rendered on measured lines, because the
// fallback does not know where a line actually ends.
const STRIKE_HEAD_WIDTH = 9
const STRIKE_HEAD_THICKNESS = 3

// Matches `TitleContainer`'s `descriptionText` margins, which is where the first text line starts.
const TEXT_MARGIN_TOP = 5
const SUBTASK_TEXT_MARGIN_TOP = 6

// `numberOfLines={3}` on the title, so the text can never occupy more than three lines however
// long the task name is.
const MAX_TITLE_LINES = 3

/**
 * The title's own `onLayout` height divided by its line height. Only used when the DOM measurement
 * below is unavailable. Guarded on both ends because a layout can arrive before the text has
 * measured (height 0 → a single line is the right guess) and because rounding on a fractional line
 * height must never render more bars than the text can actually show.
 */
export const resolveStrikeLineCount = (measuredHeight, lineHeight) => {
    if (!measuredHeight || !lineHeight) return 1
    return Math.min(MAX_TITLE_LINES, Math.max(1, Math.round(measuredHeight / lineHeight)))
}

/**
 * Collapses a flat list of client rects into one span per visual line.
 *
 * WHY THIS EXISTS — without it the bar spans the whole title COLUMN, which is `flex: 1` and
 * therefore stretches to wherever the trailing tags begin. "Buy milk" on a desktop row would be
 * crossed out by a line several hundred pixels long, most of it through empty space. That reads as
 * a struck-out ROW rather than struck-out TEXT, and it is the single most visible way this effect
 * can look unfinished.
 *
 * `Range.getClientRects()` over the title returns a rect per inline box — which, because
 * `SocialText` splits the title into per-word/segment elements, means roughly one rect per word.
 * Grouping them by their rounded `top` and taking `min(left) … max(right)` therefore reconstructs
 * exactly the ink extent of each wrapped line, without needing to know anything about how the text
 * was split or where it wrapped.
 *
 * Exported for testing: this is pure geometry, and it is the part most worth pinning.
 */
export const groupRectsIntoLines = (rects, baseRect) => {
    if (!rects?.length || !baseRect) return null

    const lines = new Map()
    rects.forEach(rect => {
        // Sub-pixel line boxes are common; rounding is what makes two words on the same line group
        // together instead of becoming two nearly-identical bars.
        const key = Math.round(rect.top)
        const existing = lines.get(key)
        if (existing) {
            existing.left = Math.min(existing.left, rect.left)
            existing.right = Math.max(existing.right, rect.right)
        } else {
            lines.set(key, { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right })
        }
    })

    return Array.from(lines.values())
        .sort((a, b) => a.top - b.top)
        .slice(0, MAX_TITLE_LINES)
        .map(line => ({
            // Relative to the overlay's own box, and centred on the line's ink rather than on the
            // box, so the bar sits through the middle of the glyphs the way a decoration would.
            top: (line.top + line.bottom) / 2 - baseRect.top - STRIKE_THICKNESS / 2,
            left: line.left - baseRect.left,
            width: line.right - line.left,
        }))
        .filter(line => line.width > 1)
}

/**
 * Reads the ink extent of the rendered title. Web-only by nature, and deliberately total in its
 * failure handling: ANY problem returns null and the caller falls back to full-width bars, which
 * still communicate "done". `document.getElementById(...).getBoundingClientRect()` is the same
 * measurement route `TasksHelper.showWrappedTaskEllipsis` already uses for this exact element.
 */
export const measureTitleLines = (elementId, overlayNode) => {
    if (typeof document === 'undefined' || !document.createRange || !elementId) return null
    if (!overlayNode?.getBoundingClientRect) return null

    try {
        const textNode = document.getElementById(elementId)
        if (!textNode) return null

        const range = document.createRange()
        range.selectNodeContents(textNode)
        const rects = Array.from(range.getClientRects()).filter(rect => rect.width > 0 && rect.height > 0)

        return groupRectsIntoLines(rects, overlayNode.getBoundingClientRect())
    } catch (error) {
        return null
    }
}

/**
 * @param {object} props
 * @param {Animated.Value} props.progress 0 → 1, drives `scaleX`.
 * @param {Animated.Value} [props.opacity] 0 → 1 as the completion starts, and back to 0 when a
 *   RETAINED row (a subtask, which stays in its list) releases the effect. Shared with the row wash
 *   and the checkbox fill so every part of the flourish arrives and leaves together. Optional so
 *   the component still renders standalone.
 * @param {number} props.measuredHeight Laid-out height of the title text (fallback path only).
 * @param {boolean} props.isSubtask Subtasks use the smaller body2 metrics.
 * @param {string} [props.elementId] DOM id of the rendered title, used to measure its true width.
 */
export default function TaskCompletionStrike({ progress, opacity, measuredHeight, isSubtask, elementId }) {
    const overlayRef = useRef(null)
    const [measuredLines, setMeasuredLines] = useState(null)

    // Runs once, when the row starts completing. The title is already on screen and does not change
    // during the animation, so a single synchronous measurement before paint is enough — and being
    // synchronous is what stops the bar from being visibly drawn at the wrong width for one frame.
    useLayoutEffect(() => {
        const lines = measureTitleLines(elementId, overlayRef.current)
        if (lines?.length) setMeasuredLines(lines)
    }, [elementId])

    const lineHeight = isSubtask ? 22 : 24
    const marginTop = isSubtask ? SUBTASK_TEXT_MARGIN_TOP : TEXT_MARGIN_TOP

    const lines =
        measuredLines ||
        // Fallback: no DOM, no id, or a measurement that came back empty. Spans the title column,
        // which is wider than the text but still unmistakably a strike-through.
        Array.from({ length: resolveStrikeLineCount(measuredHeight, lineHeight) }, (_unused, index) => ({
            top: marginTop + index * lineHeight + lineHeight / 2 - STRIKE_THICKNESS / 2,
            left: 0,
            width: undefined,
        }))

    return (
        <Animated.View
            ref={overlayRef}
            style={[localStyles.overlay, opacity ? { opacity } : undefined]}
            pointerEvents="none"
            testID="task-completion-strike"
        >
            <Animated.View
                style={[localStyles.scaler, { transform: [{ scaleX: progress }] }]}
                testID="task-completion-strike-scaler"
            >
                {lines.map((line, index) => (
                    <View
                        key={index}
                        style={[
                            localStyles.line,
                            { top: line.top, left: line.left },
                            // `right: 0` only in the fallback, where the ink width is unknown.
                            line.width === undefined ? { right: 0 } : { width: line.width },
                        ]}
                    />
                ))}
            </Animated.View>
            {/* The heads sit OUTSIDE the scaler and travel by `translateX` instead. Inside it they
                would be squashed to nothing along with everything else — the point of a head is
                that it keeps its shape while the line behind it grows. */}
            {lines.map((line, index) =>
                line.width === undefined ? null : (
                    <Animated.View
                        key={`head-${index}`}
                        testID="task-completion-strike-head"
                        style={[
                            localStyles.head,
                            {
                                top: line.top + (STRIKE_THICKNESS - STRIKE_HEAD_THICKNESS) / 2,
                                opacity: progress.interpolate({
                                    inputRange: [0, 0.08, 0.75, 1],
                                    outputRange: [0, 1, 1, 0],
                                }),
                                transform: [
                                    {
                                        translateX: progress.interpolate({
                                            inputRange: [0, 1],
                                            outputRange: [
                                                line.left - STRIKE_HEAD_WIDTH / 2,
                                                line.left + line.width - STRIKE_HEAD_WIDTH / 2,
                                            ],
                                        }),
                                    },
                                ],
                            },
                        ]}
                    />
                )
            )}
        </Animated.View>
    )
}

const localStyles = StyleSheet.create({
    // Untransformed, so it is the stable coordinate space the measured rects are mapped into.
    // Measuring against the scaler instead would read a box already squashed to scaleX(0).
    overlay: {
        ...StyleSheet.absoluteFillObject,
    },
    scaler: {
        ...StyleSheet.absoluteFillObject,
        transformOrigin: 'left center',
    },
    line: {
        position: 'absolute',
        height: STRIKE_THICKNESS,
        borderRadius: STRIKE_THICKNESS / 2,
        // Text02, not the title's own near-black: the line marks the text as struck without
        // competing with it for weight during the ~360ms both are on screen together.
        backgroundColor: colors.Text02,
    },
    head: {
        position: 'absolute',
        left: 0,
        width: STRIKE_HEAD_WIDTH,
        height: STRIKE_HEAD_THICKNESS,
        borderRadius: STRIKE_HEAD_THICKNESS / 2,
        // The one saturated green on the title, and only for the moment it is moving. It ties the
        // line to the checkbox burst without turning the strike itself into a highlighter.
        backgroundColor: colors.UtilityGreen300,
    },
})
