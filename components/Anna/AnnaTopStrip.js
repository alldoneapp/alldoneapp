import React, { useLayoutEffect, useRef, useState } from 'react'
import { useDispatch } from 'react-redux'
import ConnectionStatusChip from '../TopBar/ConnectionStatusChip'
import NotificationArea from '../TopBar/NotificationArea'
import TopBarStatisticArea from '../TopBar/TopBarStatisticArea'
import { setTopBarWidth } from '../../redux/actions'
import Icon from '../Icon'
import { colors } from '../styles/global'
import navigateToHome from '../../utils/navigateToHome'
import AnnaViewSwitch from './AnnaViewSwitch'

/**
 * Desktop: one row above Alldone and, in assistant mode, above the chat. It replaces Alldone's own
 * top bar there (AnnaTopStripContext; Alldone keeps its desktop sidebar below it): XP, gold, task
 * statistics and quota on the left, search, chats and updates on the right, and in the middle the
 * view switch (AnnaViewSwitch), which stays in one place in all views. "App" replaces the home
 * button and the assistant toggle and still shows the open-task count. Where the window is too
 * narrow for Alldone beside the chat (`canSplit`), the switch offers only App and the assistant. `layout` is what the window shows: null while it
 * shows another screen than Alldone alone. In assistant mode a click on anything left or right of
 * the switch (XP, gold, statistics, search, chats, updates) first leaves the chat for the app
 * (`onLeaveChat`), and then does what it always does there. Where the strip spans the window
 * (`showLogo`: assistant mode, and screens without a top bar slot) it starts with Alldone's logo, at
 * the spot where the sidebar shows it in the App view; like the sidebar's, it opens All projects,
 * but keeps the view: in Anna or Both it does not leave the chat.
 */
// How many things the statistics can give up when short of room (see `squeeze`).
const STATISTICS_STEPS = 3

export default function AnnaTopStrip({
    showLogo = false,
    layout,
    canSplit,
    assistantName,
    photo,
    openTasksAmount,
    onSelect,
    onLeaveChat,
}) {
    const dispatch = useDispatch()
    const strip = useRef(null)
    // XpBar, TasksStatisticsArea and the connection chip size themselves from the top bar's width,
    // which only TopBar reported until now.
    useLayoutEffect(() => {
        const node = strip.current
        if (!node) return
        const report = () => dispatch(setTopBarWidth(node.getBoundingClientRect().width))
        const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(report)
        observer?.observe(node)
        report()
        return () => observer?.disconnect()
    }, [dispatch])

    // The statistics need more room than the left side has in a narrow strip (for example the card
    // above the content in plain Alldone). Each step gives some up until they fit: first the XP bar,
    // then the labels (icons instead, as on a small screen), then the done-task count. A step is taken
    // back once the side is as wide as the statistics needed before it.
    const left = useRef(null)
    const neededWidth = useRef([])
    const [squeeze, setSqueeze] = useState(0)
    // After a render the statistics may only give more up (they overflow). A change of the side's own
    // size (ResizeObserver) starts taking steps back, one per render while the next one fits, and
    // stops at the first that does not; a render alone never undoes the one before it.
    const squeezeNow = useRef(squeeze)
    squeezeNow.current = squeeze
    const relaxing = useRef(false)
    const checkStatistics = sizeChanged => {
        const node = left.current
        if (!node) return
        const step = squeezeNow.current
        const room = node.clientWidth
        if (sizeChanged) relaxing.current = true
        let next = step
        if (step < STATISTICS_STEPS && node.scrollWidth > room + 1) {
            neededWidth.current[step] = node.scrollWidth
            relaxing.current = false
            next = step + 1
        } else if (relaxing.current && step > 0 && room >= neededWidth.current[step - 1]) next = step - 1
        else relaxing.current = false
        if (next !== step) setSqueeze(next)
    }
    useLayoutEffect(() => checkStatistics(false))
    useLayoutEffect(() => {
        if (!left.current || typeof ResizeObserver === 'undefined') return
        const observer = new ResizeObserver(() => checkStatistics(true))
        observer.observe(left.current)
        return () => observer.disconnect()
    }, [])

    // The logo keeps the view the person chose; everything else on the left belongs to the app.
    const leaveChatUnlessLogo = event => {
        if (!event.target.closest?.('.anna-strip-logo')) onLeaveChat?.(event)
    }

    return (
        <div className="anna-strip" ref={strip} data-testid="anna-top-strip">
            <div className="anna-strip-left" ref={left} onClickCapture={leaveChatUnlessLogo}>
                {showLogo && (
                    <button
                        type="button"
                        className="anna-strip-logo"
                        aria-label="Alldone.app"
                        title="Alldone.app"
                        onClick={() => navigateToHome(dispatch)}
                    >
                        <Icon size={24} name="logo" color={colors.Primary100} />
                    </button>
                )}
                <TopBarStatisticArea
                    showXp={squeeze < 1}
                    compact={squeeze >= 2}
                    showTasksStatistics={canSplit && squeeze < 3}
                />
            </div>
            <AnnaViewSwitch
                layout={layout}
                canSplit={canSplit}
                assistantName={assistantName}
                photo={photo}
                openTasksAmount={openTasksAmount}
                onSelect={onSelect}
            />
            <div className="anna-strip-right" onClickCapture={onLeaveChat}>
                <ConnectionStatusChip />
                <NotificationArea />
            </div>
        </div>
    )
}
