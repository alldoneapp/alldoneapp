import React, { createContext } from 'react'
import Icon from '../Icon'
import AmountTag from '../Feeds/FollowSwitchableTag/AmountTag'
import { colors } from '../styles/global'
import { translate } from '../../i18n/TranslationService'

// AnnaShell hands the switch to Alldone's phone bar (TopBarMobile) through this: null on desktop,
// where the strip carries it.
export const AnnaViewSwitchContext = createContext(null)

// The icons-only switch: two 34px buttons, a 2px gap, 2px padding and a 1px border (anna.css).
export const ANNA_VIEW_SWITCH_WIDTH = 76
export const ANNA_VIEW_SWITCH_HEIGHT = 38

/**
 * Switches between the assistant and the app: in the desktop strip (AnnaTopStrip, with "Both" where
 * the window has room for it) and on phones, icons only, in the chat header and in Alldone's own
 * phone bar. Its order follows the desktop cards: the assistant, Both, App. `layout` is what is in
 * front: `chat`, `split`, `alldone`, or null for another screen than Alldone.
 */
export default function AnnaViewSwitch({
    layout,
    canSplit = false,
    assistantName,
    photo,
    openTasksAmount = 0,
    onSelect,
    iconsOnly = false,
}) {
    const tasksLabel = translate('%{count} open tasks today', { count: openTasksAmount })
    const chatLabel = translate('Only %{assistantName}', { assistantName })
    return (
        <div
            className={`anna-strip-switch${iconsOnly ? ' anna-view-switch-icons' : ''}`}
            role="group"
            aria-label={translate('Assistant view')}
        >
            <button
                type="button"
                aria-pressed={layout === 'chat'}
                aria-label={chatLabel}
                title={chatLabel}
                data-anna-layout="chat"
                onClick={() => onSelect('chat')}
            >
                <span className="anna-strip-avatar" aria-hidden="true">
                    {photo ? <img src={photo} alt="" /> : assistantName.charAt(0)}
                </span>
                {!iconsOnly && <span className="anna-strip-name">{assistantName}</span>}
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
                aria-pressed={layout === 'alldone'}
                aria-label={iconsOnly ? translate('App') : undefined}
                title={tasksLabel}
                data-anna-layout="alldone"
                onClick={() => onSelect('alldone')}
            >
                <Icon name="check-circle" size={iconsOnly ? 20 : 16} color="currentColor" />
                {!iconsOnly && <span>{translate('App')}</span>}
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
        </div>
    )
}
