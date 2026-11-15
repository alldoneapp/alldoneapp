import React from 'react'
import Icon from '../Icon'
import AmountTag from '../Feeds/FollowSwitchableTag/AmountTag'
import ConnectionStatusChip from '../TopBar/ConnectionStatusChip'
import GoldArea from '../TopBar/GoldArea'
import NotificationArea from '../TopBar/NotificationArea'
import { colors } from '../styles/global'
import { translate } from '../../i18n/TranslationService'

/**
 * Desktop assistant mode: one row above both cards. The view switch sits in the middle and stays
 * in the same place for "Both" and the assistant alone; "Tasks" leaves assistant mode and keeps the
 * page the workspace shows. Gold, search, chats and updates move here from Alldone's own top bar,
 * which stays hidden inside the workspace card while this row is shown (AnnaTopStripContext).
 */
export default function AnnaTopStrip({ layout, assistantName, photo, openTasksAmount, onSelect }) {
    const tasksLabel = translate('%{count} open tasks today', { count: openTasksAmount })
    return (
        <div className="anna-strip">
            <div className="anna-strip-left">
                <span className="anna-strip-logo" aria-hidden="true">
                    <Icon name="logo" size={22} color={colors.Primary100} />
                </span>
            </div>
            <div className="anna-strip-switch" role="group" aria-label={translate('Assistant view')}>
                <button
                    type="button"
                    aria-pressed={false}
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
                <button
                    type="button"
                    aria-pressed={layout === 'split'}
                    data-anna-layout="split"
                    onClick={() => onSelect('split')}
                >
                    <Icon name="columns" size={16} color="currentColor" />
                    <span>{translate('Both')}</span>
                </button>
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
                <GoldArea />
                <NotificationArea />
            </div>
        </div>
    )
}
