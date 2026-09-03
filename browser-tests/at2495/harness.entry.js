/**
 * AT-2495 browser harness — the disintegration exit, actually erasing pixels.
 *
 * Renders the REAL `useTaskCompletionMotion` driving the REAL `createRowExitStyle` on a row node
 * and the REAL `TaskDisintegration` dust layer beside it, wired exactly as `TaskPresentation`
 * wires them: the mask on the collapsing row, the dust as its SIBLING.
 *
 * Jest can answer none of the questions this exists for, and there are three of them:
 *
 *   1. Does react-native-web 0.21 actually get `maskImage` / `maskSize` / `maskPosition` onto the
 *      DOM node, through both the initial style and `Animated`'s per-frame `setNativeProps`? The
 *      whole effect is that passthrough. A jsdom test cannot see it — jsdom's CSSStyleDeclaration
 *      silently drops properties it does not implement, so `mask-image` reads back as `''` there
 *      whether or not the code is right.
 *   2. Does the row's PAINT actually come apart, right to left? A style object is not a picture.
 *      The runner screenshots the row and counts surviving pixels, which is the only measurement
 *      that can tell "the mask is applied" from "the mask erases the correct half".
 *   3. Does it take 1.2 seconds? `__mocks__/react-native.js` stubs `Animated.timing` to a no-op,
 *      so no jest suite has ever watched this animation advance at all.
 *
 * The row's CONTENT is a stand-in — a solid block of one saturated colour — precisely so the
 * screenshot can be measured: on a real task row the surviving-pixel count would be dominated by
 * whatever text happened to be under the front. Everything that AT-2495 changed is the real
 * module.
 */
import React from 'react'
import { createRoot } from 'react-dom/client'
import { Animated, StyleSheet, View } from 'react-native'

import TaskDisintegration from '../../components/TaskListView/TaskItem/TaskPresentation/TaskDisintegration'
import useTaskCompletionMotion from '../../components/TaskListView/TaskItem/TaskPresentation/taskCompletionMotion'

const ROW_WIDTH = 900
const ROW_HEIGHT = 48
// Pure red on white: every channel is unambiguous, so "how much of the row survives" is a
// threshold on one number rather than a colour-distance heuristic.
const ROW_COLOR = 'rgb(255, 0, 0)'

const localStyles = StyleSheet.create({
    page: { width: ROW_WIDTH, backgroundColor: 'white' },
    body: { height: ROW_HEIGHT, backgroundColor: ROW_COLOR, flexDirection: 'row', alignItems: 'center' },
    // A row below it, so a collapse that fails to close the gap is visible as well as measurable.
    next: { height: ROW_HEIGHT, backgroundColor: 'rgb(0, 0, 255)' },
})

function Row() {
    const { onRowLayout, rowStyle, beginCompletionMotion, cancelCompletionMotion, completionDust } =
        useTaskCompletionMotion({ retainRow: false, isDone: false })

    window.__begin = options => beginCompletionMotion(options || { isCompletion: true })
    window.__cancel = () => cancelCompletionMotion()

    return (
        <View style={localStyles.page}>
            {/* Exactly `TaskPresentation`'s shape: the mask and the collapse ride on this node, and
                the dust is a sibling of it — a child would be erased by the same mask.

                It MUST be an `Animated.View`. A plain `View` handed the same style renders the
                interpolations' values once, through `toString()`, and then never updates: the
                mask lands on the DOM correctly and is frozen at `0%` forever, while the dust —
                which is animated properly — keeps moving. That is a genuinely convincing-looking
                half-working effect, and the first run of this harness reproduced it exactly. */}
            <View nativeID="row-wrapper">
                <Animated.View style={rowStyle} onLayout={onRowLayout} nativeID="task-completion-row">
                    <View style={localStyles.body} nativeID="row-body" />
                </Animated.View>
                {completionDust ? <TaskDisintegration {...completionDust} /> : null}
            </View>
            <View style={localStyles.next} nativeID="next-row" />
        </View>
    )
}

window.__measure = () => {
    const node = document.getElementById('task-completion-row')
    const style = node ? window.getComputedStyle(node) : null
    const dust = document.querySelector('[data-testid="task-disintegration"]')
    const motes = Array.from(document.querySelectorAll('[data-testid="task-disintegration-mote"]'))
    const next = document.getElementById('next-row')

    return {
        t: Math.round(performance.now() - (window.__t0 || 0)),
        rowHeight: node ? Math.round(node.getBoundingClientRect().height * 10) / 10 : null,
        // `maskImage` reads back from the shorthand-free longhand in Chromium; the WebKit alias is
        // reported separately and either one being present proves the passthrough.
        maskImage: style ? style.maskImage || style.webkitMaskImage || '' : '',
        maskPosition: style ? style.maskPosition || style.webkitMaskPosition || '' : '',
        maskSize: style ? style.maskSize || style.webkitMaskSize || '' : '',
        rowOpacity: style ? Number(style.opacity) : null,
        dustPresent: !!dust,
        moteCount: motes.length,
        // One mote is enough to prove the layer advances; they all share the same value.
        mote: motes.length
            ? (() => {
                  const box = motes[0].getBoundingClientRect()
                  return {
                      opacity: Math.round(Number(window.getComputedStyle(motes[0]).opacity) * 1000) / 1000,
                      x: Math.round(box.left * 10) / 10,
                      y: Math.round(box.top * 10) / 10,
                  }
              })()
            : null,
        // Where the row below has got to. The gap only closes if the collapse really runs.
        nextRowTop: next ? Math.round(next.getBoundingClientRect().top) : null,
    }
}

/**
 * Decodes a screenshot taken by the runner and reports, per column of the row, how much of the
 * stand-in colour survives. Done in the page because it needs no npm decoder — the browser that
 * painted the pixels can read them straight back through a canvas.
 */
window.__scan = dataUrl =>
    new Promise(resolve => {
        const image = new Image()
        image.onload = () => {
            const canvas = document.createElement('canvas')
            canvas.width = image.width
            canvas.height = image.height
            const context = canvas.getContext('2d')
            context.drawImage(image, 0, 0)
            const y = Math.min(Math.floor(image.height / 2), image.height - 1)
            const { data } = context.getImageData(0, y, image.width, 1)
            const columns = []
            for (let x = 0; x < image.width; x += 1) {
                const red = data[x * 4]
                const green = data[x * 4 + 1]
                const blue = data[x * 4 + 2]
                // The row is red over white, so a surviving column is red-high / green-low. The
                // green channel is the cleanest proxy for how much of it the mask has taken:
                // 0 = fully present, 255 = fully erased.
                columns.push(Math.max(0, Math.min(1, 1 - green / 255)) * (red > 100 ? 1 : 0))
            }
            resolve({ width: image.width, height: image.height, columns })
        }
        image.onerror = () => resolve(null)
        image.src = dataUrl
    })

const container = document.getElementById('root')
createRoot(container).render(<Row />)
window.__ready = true
