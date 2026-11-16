import React, { useLayoutEffect, useRef } from 'react'
import { useDispatch } from 'react-redux'
import ConnectionStatusChip from '../TopBar/ConnectionStatusChip'
import NotificationArea from '../TopBar/NotificationArea'
import TopBarStatisticArea from '../TopBar/TopBarStatisticArea'
import { setTopBarWidth } from '../../redux/actions'
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
 * (`onLeaveChat`), and then does what it always does there.
 */
export default function AnnaTopStrip({
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

    return (
        <div className="anna-strip" ref={strip} data-testid="anna-top-strip">
            <div className="anna-strip-left" onClickCapture={onLeaveChat}>
                <TopBarStatisticArea showTasksStatistics={canSplit} />
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
