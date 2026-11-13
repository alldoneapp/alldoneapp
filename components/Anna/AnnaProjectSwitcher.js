import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useDispatch } from 'react-redux'
import AppPopover from '../UIComponents/ModalShell/AppPopover'
import Icon from '../Icon'
import useEscapeKey from '../../hooks/useEscapeKey'
import { useProjectsData } from '../../hooks/useProjectData'
import { PROJECT_DATA_ASSISTANTS } from '../../utils/InitialLoad/projectDataLoader'
import { hideFloatPopup, showFloatPopup } from '../../redux/actions'
import { translate } from '../../i18n/TranslationService'

// A list this long is easier to filter than to scroll.
export const ANNA_PROJECT_SEARCH_THRESHOLD = 8
const EMPTY = []

// AT-3024: "Automatic" is a choice, not a project; it has no stored name.
const choiceName = choice => (choice.isAutomatic ? translate('Automatic') : choice.name)

const assistantLabel = choice => {
    const name = choice.assistant?.displayName?.trim() || translate('Assistant')
    if (choice.isAutomatic) return `${name} · ${translate('Automatic project description')}`
    if (choice.isDefault) return `${name} · ${translate('Default project')}`
    if (choice.isProjectAssistant) return name
    return translate('%{assistantName} (default assistant)', { assistantName: name })
}

// AT-3034: the assistant variant (top left of the sidebar) names the assistant first and
// says where it answers underneath.
const assistantName = choice => choice.assistant?.displayName?.trim() || translate('Assistant')
const projectLabel = choice => {
    if (choice.isAutomatic) return translate('Automatic project description')
    if (choice.isDefault) return `${choice.name} · ${translate('Default project')}`
    return choice.name
}

/**
 * The assistant variant lists who can answer, not every project: "Automatic" (the default
 * assistant) and each project with an assistant of its own. A project the default assistant
 * answers in, and the explicit default project, are project choices that would only repeat the
 * default assistant, so they stay in the composer's chip (and are listed here only while active).
 */
export const getAnnaAssistantChoices = (choices = [], activeProjectId = null) => {
    const hasAutomatic = choices.some(choice => choice.isAutomatic)
    return choices.filter(
        choice =>
            choice.id === activeProjectId ||
            choice.isAutomatic ||
            choice.isProjectAssistant ||
            (choice.isDefault && !hasAutomatic)
    )
}

// The project's color dot; "Automatic" shows the same icon as in the add-task picker.
const ChoiceMark = ({ choice }) =>
    choice.isAutomatic ? (
        <span aria-hidden="true" className="anna-project-auto-icon">
            <Icon name="cpu" size={14} color="currentColor" />
        </span>
    ) : (
        <span
            aria-hidden="true"
            className="anna-project-dot"
            style={choice.color ? { background: choice.color } : undefined}
        />
    )

/**
 * AT-2903 — the project chip in the assistant chat composer. The selected
 * project decides which daily chat the next message goes to, and with it which
 * assistant answers. Opens inside the chat pane, like the attachment menu.
 *
 * AT-3034 — `variant="assistant"` is the same choice, offered as "who answers": a chevron beside
 * the assistant's name at the top left of the sidebar, listing assistants (see
 * `getAnnaAssistantChoices`). Picking one selects its project, exactly like the chip.
 */
export default function AnnaProjectSwitcher({
    variant = 'project',
    choices: allChoices = EMPTY,
    activeProjectId,
    onSelect,
    disabled = false,
    busy = false,
    getViewport,
}) {
    const dispatch = useDispatch()
    const [open, setOpen] = useState(false)
    const [query, setQuery] = useState('')
    const byAssistant = variant === 'assistant'
    const choices = useMemo(
        () => (byAssistant ? getAnnaAssistantChoices(allChoices, activeProjectId) : allChoices),
        [byAssistant, allChoices, activeProjectId]
    )
    const active = choices.find(choice => choice.id === activeProjectId)
    const ids = useMemo(() => allChoices.filter(choice => !choice.isAutomatic).map(choice => choice.id), [allChoices])
    // Project assistants load on demand (AT-2386). Only the open list needs all of them.
    useProjectsData(ids, PROJECT_DATA_ASSISTANTS, { enabled: open })

    const close = () => {
        if (!open) return
        setOpen(false)
        setQuery('')
        dispatch(hideFloatPopup())
    }
    useEscapeKey(close, { enabled: open })
    useEffect(() => {
        if (open && disabled) close()
    }, [open, disabled])
    const openRef = useRef(open)
    openRef.current = open
    // Release the shortcut block if the composer unmounts with the menu open.
    useEffect(
        () => () => {
            if (openRef.current) dispatch(hideFloatPopup())
        },
        []
    )

    // Gate on every project, not the assistant list: who has an assistant of their own is only
    // known once the open menu has loaded them (AT-2386).
    if (allChoices.length < 2 || !active) return null

    const toggle = () => {
        if (open) return close()
        if (disabled) return
        setOpen(true)
        dispatch(showFloatPopup())
    }
    const pick = projectId => {
        close()
        if (projectId !== activeProjectId) onSelect?.(projectId)
    }
    const needle = query.trim().toLowerCase()
    const filtered = needle
        ? choices.filter(
              choice =>
                  choiceName(choice).toLowerCase().includes(needle) ||
                  (choice.assistant?.displayName || '').toLowerCase().includes(needle)
          )
        : choices
    const menuLabel = translate(byAssistant ? 'Choose assistant for this chat' : 'Choose project for this chat')
    const label = byAssistant
        ? translate('Assistant: %{assistantName}', { assistantName: assistantName(active) })
        : translate('Project: %{projectName}', { projectName: choiceName(active) })
    const title = disabled
        ? translate(
              byAssistant
                  ? 'Finish the call and stay online to change the assistant'
                  : 'Finish the call or dictation and stay online to change the project'
          )
        : `${label} – ${menuLabel}`
    const searchLabel = translate(byAssistant ? 'Search assistants' : 'Search projects')

    const menu = (
        <div className="anna-project-menu" role="dialog" aria-label={menuLabel}>
            {choices.length >= ANNA_PROJECT_SEARCH_THRESHOLD && (
                <input
                    className="anna-project-search"
                    type="search"
                    autoFocus
                    value={query}
                    placeholder={searchLabel}
                    aria-label={searchLabel}
                    onChange={event => setQuery(event.target.value)}
                    onKeyDown={event => {
                        // The chat editor submits on Enter at document level.
                        if (event.key !== 'Enter') return
                        event.preventDefault()
                        event.stopPropagation()
                        if (filtered[0]) pick(filtered[0].id)
                    }}
                />
            )}
            <ul
                className="anna-project-options"
                role="listbox"
                aria-label={translate(byAssistant ? 'Assistants' : 'Projects')}
            >
                {filtered.map(choice => {
                    const selected = choice.id === activeProjectId
                    return (
                        <li key={choice.id} role="option" aria-selected={selected}>
                            <button
                                type="button"
                                className={`anna-project-option${selected ? ' anna-project-option-selected' : ''}`}
                                onClick={() => pick(choice.id)}
                            >
                                <ChoiceMark choice={choice} />
                                <span className="anna-project-option-text">
                                    <strong>{byAssistant ? assistantName(choice) : choiceName(choice)}</strong>
                                    <span>
                                        {byAssistant ? projectLabel(choice) : assistantLabel(choice)}
                                        {choice.isShared && ` · ${translate('Visible to project members')}`}
                                    </span>
                                </span>
                                {selected && <Icon name="check" size={16} color="currentColor" />}
                            </button>
                        </li>
                    )
                })}
            </ul>
            {filtered.length === 0 && (
                <p className="anna-muted">{translate(byAssistant ? 'No assistants found' : 'No projects found')}</p>
            )}
        </div>
    )

    return (
        <AppPopover
            content={menu}
            isOpen={open}
            onClickOutside={close}
            position={byAssistant ? ['bottom', 'top'] : ['top', 'bottom']}
            align="start"
            padding={6}
            getViewport={getViewport}
            useSheet={false}
        >
            {byAssistant ? (
                <button
                    type="button"
                    className={`anna-pane-toggle anna-assistant-picker${busy ? ' anna-project-chip-busy' : ''}`}
                    aria-label={label}
                    aria-haspopup="dialog"
                    aria-expanded={open}
                    aria-busy={busy || undefined}
                    title={title}
                    disabled={disabled}
                    onClick={toggle}
                >
                    <Icon name="chevron-down" size={16} color="currentColor" />
                </button>
            ) : (
                <button
                    type="button"
                    className={`anna-project-chip${busy ? ' anna-project-chip-busy' : ''}`}
                    aria-label={label}
                    aria-haspopup="dialog"
                    aria-expanded={open}
                    aria-busy={busy || undefined}
                    title={title}
                    disabled={disabled}
                    onClick={toggle}
                >
                    <ChoiceMark choice={active} />
                    <span className="anna-project-chip-name">{choiceName(active)}</span>
                    <Icon name="chevron-down" size={14} color="currentColor" />
                </button>
            )}
        </AppPopover>
    )
}
