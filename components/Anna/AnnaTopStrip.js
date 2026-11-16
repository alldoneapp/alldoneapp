import React, { useLayoutEffect, useRef } from 'react'
import { useDispatch } from 'react-redux'
import Icon from '../Icon'
import AmountTag from '../Feeds/FollowSwitchableTag/AmountTag'
import ConnectionStatusChip from '../TopBar/ConnectionStatusChip'
import NotificationArea from '../TopBar/NotificationArea'
import TopBarStatisticArea from '../TopBar/TopBarStatisticArea'
import { setTopBarWidth } from '../../redux/actions'
import { colors } from '../styles/global'
import { translate } from '../../i18n/TranslationService'

/**
 * Desktop: one row above Alldone and, in assistant mode, above the chat. It replaces Alldone's own
 * top bar there (AnnaTopStripContext; Alldone keeps its desktop sidebar below it): XP, gold, task
 * statistics and quota on the left, search, chats and updates on the right, and in the middle the
 * view switch, which stays in one place in all views. "Tasks" replaces the home button and the
 * assistant toggle. Where the window is too narrow for Alldone beside the chat (`canSplit`), the
 * switch offers only Tasks and the assistant. `layout` is what the window shows: null while it
 * shows another screen than Alldone alone.
 */
export default function AnnaTopStrip({ layout, canSplit, assistantName, photo, openTasksAmount, onSelect }) {
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

    const tasksLabel = translate('%{count} open tasks today', { count: openTasksAmount })
    return (
        <div className="anna-strip" ref={strip} data-testid="anna-top-strip">
            <div className="anna-strip-left">
                <TopBarStatisticArea />
            </div>
            <div className="anna-strip-switch" role="group" aria-label={translate('Assistant view')}>
                <button
                    type="button"
                    aria-pressed={layout === 'alldone'}
                    title={tasksLabel}
                    data-anna-layout="alldone"
                    onClick={() => onSelect('alldone')}
                >
                    <Icon name="home" size={16} color="currentColor" />
                    <span>{translate('Tasks')}</span>
                    {openTasksAmount > 0 && (
                        <span className="anna-strip-count" aria-label={tasksLabel}>
                            <AmountTag
                                feedAmount={openTasksAmount}
                                isFollowedButton={false}
                                showFullAmount={true}
                                style={{ backgroundColor: colors.Primary100 }}
                            />
                        </span>
                    )}
                </button>
                {canSplit && (
                    <button
                        type="button"
                        aria-pressed={layout === 'split'}
                        data-anna-layout="split"
                        onClick={() => onSelect('split')}
                    >
                        <Icon name="columns" size={16} color="currentColor" />
                        <span>{translate('Both')}</span>
                    </button>
                )}
                <button
                    type="button"
                    aria-pressed={layout === 'chat'}
                    aria-label={translate('Only %{assistantName}', { assistantName })}
                    title={translate('Only %{assistantName}', { assistantName })}
                    data-anna-layout="chat"
                    onClick={() => onSelect('chat')}
                >
                    <span className="anna-strip-avatar" aria-hidden="true">
                        {photo ? <img src={photo} alt="" /> : assistantName.charAt(0)}
                    </span>
                    <span className="anna-strip-name">{assistantName}</span>
                </button>
            </div>
            <div className="anna-strip-right">
                <ConnectionStatusChip />
                <NotificationArea />
            </div>
        </div>
    )
}
