/**
 * AT-2495 browser harness — the PROJECT LINE's disintegration, actually erasing pixels.
 *
 * Renders the REAL `useProjectCompletedSweepMotion` driving the REAL `useProjectLineExit` on a row
 * node and the REAL `ProjectLineDisintegration` particle layer beside it, wired exactly as
 * `ProjectHeader` wires them: the mask on the collapsing row, the dust and the sparks as its
 * SIBLING.
 *
 * Jest can answer none of the questions this exists for, and there are four of them:
 *
 *   1. Does react-native-web 0.21 actually get `maskImage` / `maskSize` / `maskPosition` onto the
 *      DOM node, through both the initial style and `Animated`'s per-frame `setNativeProps`? The
 *      whole effect is that passthrough. A jsdom test cannot see it — jsdom's CSSStyleDeclaration
 *      silently drops properties it does not implement, so `mask-image` reads back as `''` there
 *      whether or not the code is right.
 *   2. Does the row's PAINT actually come apart, right to left? A style object is not a picture.
 *      The runner screenshots the row and counts surviving pixels, which is the only measurement
 *      that can tell "the mask is applied" from "the mask erases the correct half".
 *   3. Does the exit take 1.2 seconds, and does it wait for the sweep's three stages first?
 *      `__mocks__/react-native.js` stubs `Animated.timing` to a no-op, so no jest suite in this
 *      repo has ever watched this animation advance by a frame.
 *   4. Does stage 4 branch on `lineWillLeave` read LATE? The board tells us the line is leaving
 *      through a different Firestore listener from the one that starts the celebration, and it is
 *      routinely the second to arrive. `--stay` and `--late` drive both orders.
 *
 * The row's CONTENT is a stand-in — a solid block of one saturated colour — precisely so the
 * screenshot can be measured: on a real project header the surviving-pixel count would be dominated
 * by whatever glyph happened to be under the front. The real `ProjectCompletedSweep` overlay is not
 * mounted either, because it reads the project colour out of redux; it is a CHILD of the masked
 * node, so the mask erases it exactly as it erases this stand-in (`browser-tests/at2492` is where
 * the sweep's own paint is checked). Everything AT-2495 changed is the real module.
 */
import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Animated, StyleSheet, View } from 'react-native'

import ProjectLineDisintegration from '../../components/TaskListView/Header/ProjectLineDisintegration'
import useProjectCompletedSweepMotion, {
    useProjectLineExit,
} from '../../components/TaskListView/OpenTasksView/projectCompletedSweepMotion'

const ROW_WIDTH = 900
// The real header is a 56px content box plus its 1px bottom rule.
const ROW_HEIGHT = 57
// Pure red on white: every channel is unambiguous, so "how much of the row survives" is a
// threshold on one number rather than a colour-distance heuristic.
const ROW_COLOR = 'rgb(255, 0, 0)'
const PROJECT_TINT = 'rgb(47, 128, 237)'

const localStyles = StyleSheet.create({
    page: { width: ROW_WIDTH, backgroundColor: 'white' },
    lineContainer: { position: 'relative' },
    body: { height: ROW_HEIGHT, backgroundColor: ROW_COLOR, flexDirection: 'row', alignItems: 'center' },
    // A row below it, so a collapse that fails to close the gap is visible as well as measurable.
    next: { height: ROW_HEIGHT, backgroundColor: 'rgb(0, 0, 255)' },
})

function Line() {
    const [runId, setRunId] = useState(0)
    const [lineWillLeave, setLineWillLeave] = useState(false)
    const motion = useProjectCompletedSweepMotion(runId, lineWillLeave)
    const { exitStyle, exitHeight, onLineLayout } = useProjectLineExit(motion)

    // `leaving` is set separately from the run so the runner can reproduce BOTH arrival orders: the
    // board's verdict landing before the celebration, and landing a second after it.
    window.__begin = leaving => {
        if (leaving) setLineWillLeave(true)
        setRunId(id => id + 1)
    }
    window.__setLeaving = leaving => setLineWillLeave(leaving)

    return (
        <View style={localStyles.page}>
            {/* Exactly `ProjectHeader`'s shape: the mask and the collapse ride on this node, and the
                particles are a sibling of it — a child would be erased by the same mask.

                It MUST be an `Animated.View`. A plain `View` handed the same style renders the
                interpolations' values once, through `toString()`, and then never updates: the mask
                lands on the DOM correctly and is frozen at `0%` forever, while the particles — which
                are animated properly — keep moving. That is a genuinely convincing-looking
                half-working effect, and the first run of this harness (against the task row it was
                originally written for) reproduced it exactly. */}
            <View style={localStyles.lineContainer} nativeID="line-wrapper">
                <Animated.View style={exitStyle} onLayout={onLineLayout} nativeID="project-line">
                    <View style={localStyles.body} nativeID="line-body" />
                </Animated.View>
                {exitStyle ? (
                    <ProjectLineDisintegration progress={motion.disintegrate} height={exitHeight} tint={PROJECT_TINT} />
                ) : null}
            </View>
            <View style={localStyles.next} nativeID="next-row" />
        </View>
    )
}

const boxOf = node => {
    const box = node.getBoundingClientRect()
    return { x: Math.round(box.left * 10) / 10, y: Math.round(box.top * 10) / 10, w: box.width, h: box.height }
}

window.__measure = () => {
    const node = document.getElementById('project-line')
    const style = node ? window.getComputedStyle(node) : null
    const layer = document.querySelector('[data-testid="project-line-disintegration"]')
    const motes = Array.from(document.querySelectorAll('[data-testid="project-line-disintegration-mote"]'))
    const sparks = Array.from(document.querySelectorAll('[data-testid="project-line-disintegration-spark"]'))
    const next = document.getElementById('next-row')
    const sample = nodes =>
        nodes.length
            ? nodes.map(item => ({
                  opacity: Math.round(Number(window.getComputedStyle(item).opacity) * 1000) / 1000,
                  ...boxOf(item),
              }))
            : []

    return {
        t: Math.round(performance.now() - (window.__t0 || 0)),
        rowHeight: node ? Math.round(node.getBoundingClientRect().height * 10) / 10 : null,
        // `maskImage` reads back from the shorthand-free longhand in Chromium; the WebKit alias is
        // reported separately and either one being present proves the passthrough.
        maskImage: style ? style.maskImage || style.webkitMaskImage || '' : '',
        maskPosition: style ? style.maskPosition || style.webkitMaskPosition || '' : '',
        maskSize: style ? style.maskSize || style.webkitMaskSize || '' : '',
        rowOpacity: style ? Number(style.opacity) : null,
        layerPresent: !!layer,
        layerPosition: layer ? window.getComputedStyle(layer).position : null,
        layerBox: layer ? boxOf(layer) : null,
        moteCount: motes.length,
        sparkCount: sparks.length,
        // Colours prove the two layers are what they claim to be: neutral grey dust, tinted sparks.
        sparkArmColor: sparks.length ? window.getComputedStyle(sparks[0].firstElementChild).backgroundColor : null,
        moteColor: motes.length ? window.getComputedStyle(motes[0]).backgroundColor : null,
        motes: sample(motes).slice(0, 4),
        sparks: sample(sparks).slice(0, 4),
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
                /**
                 * The row is pure red over white, so as the mask thins it the pixel walks along
                 * (255, k, k) — red pinned, green and blue equal. That signature is what identifies
                 * a ROW pixel, and identifying it matters: the particle layer paints over the same
                 * scanline, and a gold spark (255, 174, 71) or a grey mote would otherwise be
                 * counted as surviving row and make the erasure look incomplete. Green is then the
                 * measure of how much the mask has taken: 0 = fully present, 255 = fully erased.
                 */
                const isRow = red > 200 && Math.abs(green - blue) < 12
                columns.push(isRow ? Math.max(0, Math.min(1, 1 - green / 255)) : 0)
            }
            resolve({ width: image.width, height: image.height, columns })
        }
        image.onerror = () => resolve(null)
        image.src = dataUrl
    })

const container = document.getElementById('root')
createRoot(container).render(<Line />)
window.__ready = true
