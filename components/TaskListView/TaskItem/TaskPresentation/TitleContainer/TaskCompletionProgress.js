import React, { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Animated, StyleSheet } from 'react-native'

import { colors } from '../../../../styles/global'

/**
 * AT-2404 — the 0 → 100% completion sweep a task title plays when the task is checked off.
 *
 * WHAT THIS REPLACED, AND WHY. The first two passes drew a dark `Text02` line through the middle of
 * the title. It was accurate — the task IS crossed off — and it read as *deletion*: a struck-out row
 * is the visual language of "this was removed", not of "you finished this". Completing a task is the
 * one moment in the product that should feel like an accomplishment, so the same geometry now
 * carries the opposite metaphor: a slim, bright-green PROGRESS BAR that fills left to right across
 * the title in 450ms and lands with a small confirmation pulse. Same measured lines, same single
 * animated value, opposite message.
 *
 * Deliberately NOT a track-plus-fill (the classic progress widget) and deliberately no numbers. A
 * grey track appearing under the title first would announce a UI control in a list of prose, and a
 * `0% → 100%` badge is unreadable at this speed while adding a second thing to look at. The fill
 * alone communicates the direction; the glowing head communicates that it is moving.
 *
 * ONE SWEEP ACROSS A WRAPPED TITLE. A title wrapped to three lines is ONE bar's worth of progress,
 * not three bars filling at once: `buildSweepSegments` gives each line the share of 0→1 that matches
 * its own ink width, so the head runs off the end of line one exactly as line two starts. Three
 * simultaneous fills would read as three progress bars, which is precisely the "UI control" feel
 * being avoided. It is still ONE `Animated.Value` — each line just interpolates its own window of it
 * — so the lines can never drift apart.
 *
 * THROUGH THE TEXT, NOT UNDER IT. The bar is centred on the middle of each line. An earlier pass put
 * it on the bottom edge of the ink, reasoning that a bar through the glyphs is a strike-through
 * however green it is — but that argument confuses the POSITION with the MESSAGE. In production it
 * read as a detached underline sitting visibly low, because an underline is exactly what it was.
 * Colour, direction and the moving head are what say "completed" instead of "deleted"; the
 * strike-through's PLACE is simply where a line across a title belongs. Both paths below therefore
 * aim the bar's centre at the line's centre, and both subtract half the bar's thickness to get from
 * that centre to the `top` they actually set — then add the single `OPTICAL_OFFSET_Y` pixel that
 * takes it from the geometric centre to the optical one.
 *
 * Drawn as an absolutely-positioned, `pointerEvents="none"` sibling of the title text, following the
 * same rule as `TaskRoutingActivityOverlay`: decoration never joins the layout, so it cannot change
 * the row's height, reflow the title or swallow a tap.
 *
 * WHY NOT `textDecorationLine: 'underline'` (or `'line-through'`) — it is not animatable (it is on
 * or off), and the title is not a plain string: `SocialText` renders hashtags, mentions, links and
 * the leading priority/Gmail chips as separate nested elements, so a decoration set on the parent
 * `<Text>` is at the mercy of how each of those children happens to be styled. An explicit bar is
 * fully controlled and can be swept.
 */

const BAR_THICKNESS = 3

// The bright tip that travels at the leading edge. Without it the bar is a shape being scaled; with
// it, the fill reads as something ADVANCING, which is the whole difference between a progress bar
// and a green rectangle growing. Only rendered on measured lines, because the fallback does not know
// where a line actually ends and a head parked in empty space is worse than no head.
const HEAD_WIDTH = 10
const HEAD_THICKNESS = 5
// The "restrained glow". A CSS box-shadow rather than a second halo node: one element, and a
// renderer that ignores it still shows a bright tip.
const HEAD_GLOW = '0px 0px 7px rgba(0, 194, 130, 0.9)'

// The confirmation pulse at 100%: the finished bar thickens briefly and settles back. Small on
// purpose — completing a task happens constantly, including in bursts while clearing a list.
const PULSE_PEAK_SCALE_Y = 1.7
// ...and the head blooms outward as it arrives, which is what makes the pulse read as "landed"
// rather than as the bar twitching.
const PULSE_HEAD_BLOOM = 2.4

// Matches `TitleContainer`'s `descriptionText` margins, which is where the first text line starts.
const TEXT_MARGIN_TOP = 5
const SUBTASK_TEXT_MARGIN_TOP = 6

// Where the bar's CENTRE sits inside a line box when the ink was not measured. The measured path
// derives this from the real rect; with no measurement the middle of the line box is the best
// available estimate of the same place, because CSS splits half-leading evenly above and below the
// text, so the line box and the glyphs it holds are concentric.
const FALLBACK_CENTER_RATIO = 0.5

/**
 * The one optical correction on top of the geometric centre, applied to BOTH paths so a row that
 * fails to measure cannot sit a pixel away from one that measured.
 *
 * The centring pass argued against exactly this — that a constant nudge would be font-specific
 * guesswork, because the x-height centre of lowercase text sits above the line box's midpoint while
 * the cap-height centre of mixed-case text sits below it. That reasoning is sound about which
 * DIRECTION a font-fitting correction would take, and it is why this is not one. It is a fixed 1px,
 * and it exists because the geometrically centred bar read as slightly high on screen: the line box
 * is symmetric about the em box, but the ink inside it is not — a Latin face carries descenders
 * below the baseline and most of a lowercase word's mass above it, so the visual centre of gravity
 * of a line of text sits marginally below the centre of the box that contains it. One pixel is the
 * smallest correction available and matches what dogfooding asked for; anything larger would start
 * to reintroduce the underline this replaced.
 *
 * Positive is downwards, in the same coordinate space as every `top` below.
 */
export const OPTICAL_OFFSET_Y = 1

// `numberOfLines={3}` on the title, so the text can never occupy more than three lines however
// long the task name is.
const MAX_TITLE_LINES = 3

/**
 * The title's own `onLayout` height divided by its line height. Only used when the DOM measurement
 * below is unavailable. Guarded on both ends because a layout can arrive before the text has
 * measured (height 0 → a single line is the right guess) and because rounding on a fractional line
 * height must never render more bars than the text can actually show.
 */
export const resolveProgressLineCount = (measuredHeight, lineHeight) => {
    if (!measuredHeight || !lineHeight) return 1
    return Math.min(MAX_TITLE_LINES, Math.max(1, Math.round(measuredHeight / lineHeight)))
}

/**
 * Splits 0→1 between the wrapped lines in proportion to how much text each one holds.
 *
 * This is what makes a three-line title read as ONE bar reaching 100% rather than as three bars
 * reaching 100% together. A line holding twice as much ink takes twice as long to fill, so the head
 * travels at a constant speed through the title — the same speed it would have if the title had been
 * laid out on a single line.
 *
 * Lines with no measured width (the fallback path, which only knows how MANY lines there are) fall
 * back to equal shares, which keeps the sequential reading even when the geometry is unknown.
 *
 * Exported for testing: pure geometry, and the part most worth pinning.
 */
export const buildSweepSegments = lines => {
    if (!lines?.length) return []

    const weights = lines.map(line => (typeof line.width === 'number' && line.width > 0 ? line.width : 1))
    const total = weights.reduce((sum, weight) => sum + weight, 0)
    if (!total) return lines.map((_line, index) => ({ start: index / lines.length, end: (index + 1) / lines.length }))

    let consumed = 0
    return weights.map((weight, index) => {
        const start = consumed / total
        consumed += weight
        // The last line is pinned to exactly 1 so floating-point drift can never leave the sweep
        // finishing at 0.9999 — the pulse fires off the end of the fill, and a bar that never quite
        // reaches its end would show a hairline of unfilled title.
        return { start, end: index === weights.length - 1 ? 1 : consumed / total }
    })
}

/**
 * Collapses a flat list of client rects into one span per visual line.
 *
 * WHY THIS EXISTS — without it the bar spans the whole title COLUMN, which is `flex: 1` and
 * therefore stretches to wherever the trailing tags begin. "Buy milk" on a desktop row would show a
 * progress bar several hundred pixels long, most of it under empty space, which reads as a row-level
 * loading indicator rather than as the title being completed.
 *
 * `Range.getClientRects()` over the title returns a rect per inline box — which, because
 * `SocialText` splits the title into per-word/segment elements, means roughly one rect per word.
 * Grouping them by their rounded `top` and taking `min(left) … max(right)` therefore reconstructs
 * exactly the ink extent of each wrapped line, without needing to know anything about how the text
 * was split or where it wrapped.
 *
 * Exported for testing.
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
            // Both ends of the union, not just the bottom. Sub-pixel only — the grouping key rounds
            // `top`, so every rect in a group is within a pixel of the others — but the midpoint is
            // now what positions the bar, and taking `max(bottom)` while keeping whichever `top`
            // happened to arrive first biases that midpoint downwards for no reason.
            existing.top = Math.min(existing.top, rect.top)
            existing.bottom = Math.max(existing.bottom, rect.bottom)
        } else {
            lines.set(key, { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right })
        }
    })

    return Array.from(lines.values())
        .sort((a, b) => a.top - b.top)
        .slice(0, MAX_TITLE_LINES)
        .map(line => ({
            // Relative to the overlay's own box, and centred on the MIDDLE of the line rather than
            // on its bottom edge. Sitting the bar on the bottom edge made it an underline, which is
            // what it looked like in production: detached from the text and visibly low. A progress
            // bar that replaces a strike-through has to occupy the strike-through's place.
            //
            // The midpoint of the rect is the right target: a range's client rect spans the line
            // box, CSS splits half-leading evenly above and below the text, and the em box is
            // therefore concentric with it. `OPTICAL_OFFSET_Y` then takes it the last pixel down —
            // the box is symmetric about the em box but the ink inside it is not, so a bar on the
            // exact midpoint reads as slightly high. See the constant for why that is a fixed
            // correction rather than a font-fitting one.
            top: (line.top + line.bottom) / 2 - baseRect.top - BAR_THICKNESS / 2 + OPTICAL_OFFSET_Y,
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
 * @param {Animated.Value} props.progress 0 → 1 over the whole title, driving every line's `scaleX`.
 * @param {Animated.Value} [props.pulse] 0 → 1 AFTER the fill reaches 100%. A clock, not an
 *   amplitude: the bump shape lives in the interpolations here, so the hook only has to say "the
 *   sweep has landed". Optional so the component still renders standalone.
 * @param {Animated.Value} [props.opacity] 0 → 1 as the completion starts, and back to 0 when a
 *   RETAINED row (a subtask, which stays in its list) releases the effect. Shared with the row wash
 *   and the checkbox fill so every part of the flourish arrives and leaves together.
 * @param {number} props.measuredHeight Laid-out height of the title text (fallback path only).
 * @param {boolean} props.isSubtask Subtasks use the smaller body2 metrics.
 * @param {string} [props.elementId] DOM id of the rendered title, used to measure its true width.
 */
export default function TaskCompletionProgress({ progress, pulse, opacity, measuredHeight, isSubtask, elementId }) {
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
        // which is wider than the text but still unmistakably a completion sweep.
        Array.from({ length: resolveProgressLineCount(measuredHeight, lineHeight) }, (_unused, index) => ({
            // Same rule as the measured path, including the optical offset: `top` is the bar's own
            // top edge, so the centre it is aiming for has half the bar's thickness taken off it
            // and the same 1px correction added on. The two paths have to agree — a row that failed
            // to measure sitting a pixel off one that measured is exactly the kind of difference
            // nobody would find deliberately.
            top:
                marginTop +
                index * lineHeight +
                lineHeight * FALLBACK_CENTER_RATIO -
                BAR_THICKNESS / 2 +
                OPTICAL_OFFSET_Y,
            left: 0,
            width: undefined,
        }))

    // Memoised on the measured path (where `lines` is state and therefore stable); the fallback
    // rebuilds a tiny array per render, which is what it did before as well.
    const segments = useMemo(() => buildSweepSegments(lines), [lines])

    // Shared by every line: the whole title confirms at once, because the whole title is what just
    // reached 100%.
    const pulseScaleY = pulse
        ? pulse.interpolate({ inputRange: [0, 0.45, 1], outputRange: [1, PULSE_PEAK_SCALE_Y, 1] })
        : 1
    const pulseHeadScale = pulse ? pulse.interpolate({ inputRange: [0, 1], outputRange: [1, PULSE_HEAD_BLOOM] }) : 1
    // The head is the only thing that must NOT survive the pulse: it has arrived, so it blooms out
    // instead of sitting lit at the end of a finished bar.
    const pulseHeadFade = pulse ? pulse.interpolate({ inputRange: [0, 0.55, 1], outputRange: [1, 0.55, 0] }) : 1

    return (
        <Animated.View
            ref={overlayRef}
            style={[localStyles.overlay, opacity ? { opacity } : undefined]}
            pointerEvents="none"
            testID="task-completion-progress"
        >
            {lines.map((line, index) => {
                const { start, end } = segments[index]
                return (
                    <Animated.View
                        key={`bar-${index}`}
                        testID="task-completion-progress-bar"
                        style={[
                            localStyles.bar,
                            { top: line.top },
                            // `right: 0` only in the fallback, where the ink width is unknown.
                            line.width === undefined ? { left: 0, right: 0 } : { left: line.left, width: line.width },
                            {
                                transform: [
                                    {
                                        // This line's own window of the shared 0→1. `clamp` is what
                                        // keeps it empty until the head reaches it and full once the
                                        // head has left.
                                        scaleX: progress.interpolate({
                                            inputRange: [start, end],
                                            outputRange: [0, 1],
                                            extrapolate: 'clamp',
                                        }),
                                    },
                                    { scaleY: pulseScaleY },
                                ],
                            },
                        ]}
                    />
                )
            })}
            {lines.map((line, index) => {
                if (line.width === undefined) return null
                const { start, end } = segments[index]
                const span = end - start
                const isLast = index === lines.length - 1
                const travel = progress.interpolate({
                    inputRange: [start, end],
                    outputRange: [line.left - HEAD_WIDTH / 2, line.left + line.width - HEAD_WIDTH / 2],
                    extrapolate: 'clamp',
                })
                // A head on a line that is not the last one has to be gone by the time the sweep
                // moves on, or every completed line would keep a lit dot at its right edge.
                const segmentOpacity = isLast
                    ? progress.interpolate({
                          inputRange: [start, start + span * 0.12, 1],
                          outputRange: [0, 1, 1],
                          extrapolate: 'clamp',
                      })
                    : progress.interpolate({
                          inputRange: [start, start + span * 0.12, end - span * 0.18, end],
                          outputRange: [0, 1, 1, 0],
                          extrapolate: 'clamp',
                      })

                return (
                    <Animated.View
                        key={`head-${index}`}
                        testID="task-completion-progress-head"
                        style={[
                            localStyles.head,
                            {
                                top: line.top + (BAR_THICKNESS - HEAD_THICKNESS) / 2,
                                opacity: isLast ? Animated.multiply(segmentOpacity, pulseHeadFade) : segmentOpacity,
                                // The head travels rather than being scaled, so it keeps its shape
                                // while the bar behind it grows — the point of a leading edge.
                                transform: [{ translateX: travel }, { scale: isLast ? pulseHeadScale : 1 }],
                            },
                        ]}
                    />
                )
            })}
        </Animated.View>
    )
}

const localStyles = StyleSheet.create({
    // Untransformed, so it is the stable coordinate space the measured rects are mapped into.
    overlay: {
        ...StyleSheet.absoluteFillObject,
    },
    bar: {
        position: 'absolute',
        height: BAR_THICKNESS,
        borderRadius: BAR_THICKNESS / 2,
        // The saturated brand green, matching the checkbox fill: the bar is the same event as the
        // tick, continued across the title.
        backgroundColor: colors.UtilityGreen200,
        // Fills from the checkbox side. Passed through verbatim by react-native-web 0.21's
        // `preprocess` (it becomes CSS `transform-origin`) — without it the bar would expand from
        // its own middle in both directions and would not read as progress at all. It also keeps
        // the pulse's `scaleY` centred on the bar.
        transformOrigin: 'left center',
    },
    head: {
        position: 'absolute',
        left: 0,
        width: HEAD_WIDTH,
        height: HEAD_THICKNESS,
        borderRadius: HEAD_THICKNESS / 2,
        // Lighter than the bar so the leading edge reads as the bright part of the sweep, plus a
        // small glow. Restrained on purpose: this is a 3px bar on a row the user ticks all day.
        backgroundColor: colors.UtilityGreen150,
        boxShadow: HEAD_GLOW,
    },
})
