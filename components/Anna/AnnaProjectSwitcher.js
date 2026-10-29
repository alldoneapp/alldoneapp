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

const assistantLabel = choice => {
    const name = choice.assistant?.displayName?.trim() || translate('Assistant')
    if (choice.isDefault) return `${name} · ${translate('Default project')}`
    if (choice.isProjectAssistant) return name
    return translate('%{assistantName} (default assistant)', { assistantName: name })
}

/**
 * AT-2903 — the project chip in the assistant chat composer. The selected
 * project decides which daily chat the next message goes to, and with it which
 * assistant answers. Opens inside the chat pane, like the attachment menu.
 */
export default function AnnaProjectSwitcher({
    choices = EMPTY,
    activeProjectId,
    onSelect,
    disabled = false,
    busy = false,
    getViewport,
}) {
    const dispatch = useDispatch()
    const [open, setOpen] = useState(false)
    const [query, setQuery] = useState('')
    const active = choices.find(choice => choice.id === activeProjectId)
    const ids = useMemo(() => choices.map(choice => choice.id), [choices])
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

    if (choices.length < 2 || !active) return null

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
                  choice.name.toLowerCase().includes(needle) ||
                  (choice.assistant?.displayName || '').toLowerCase().includes(needle)
          )
        : choices
    const label = translate('Project: %{projectName}', { projectName: active.name })
    const title = disabled
        ? translate('Finish the call or dictation and stay online to change the project')
        : `${label} – ${translate('Choose project for this chat')}`

    const menu = (
        <div className="anna-project-menu" role="dialog" aria-label={translate('Choose project for this chat')}>
            {choices.length >= ANNA_PROJECT_SEARCH_THRESHOLD && (
                <input
                    className="anna-project-search"
                    type="search"
                    autoFocus
                    value={query}
                    placeholder={translate('Search projects')}
                    aria-label={translate('Search projects')}
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
            <ul className="anna-project-options" role="listbox" aria-label={translate('Projects')}>
                {filtered.map(choice => {
                    const selected = choice.id === activeProjectId
                    return (
                        <li key={choice.id} role="option" aria-selected={selected}>
                            <button
                                type="button"
                                className={`anna-project-option${selected ? ' anna-project-option-selected' : ''}`}
                                onClick={() => pick(choice.id)}
                            >
                                <span
                                    aria-hidden="true"
                                    className="anna-project-dot"
                                    style={choice.color ? { background: choice.color } : undefined}
                                />
                                <span className="anna-project-option-text">
                                    <strong>{choice.name}</strong>
                                    <span>
                                        {assistantLabel(choice)}
                                        {choice.isShared && ` · ${translate('Visible to project members')}`}
                                    </span>
                                </span>
                                {selected && <Icon name="check" size={16} color="currentColor" />}
                            </button>
                        </li>
                    )
                })}
            </ul>
            {filtered.length === 0 && <p className="anna-muted">{translate('No projects found')}</p>}
        </div>
    )

    return (
        <AppPopover
            content={menu}
            isOpen={open}
            onClickOutside={close}
            position={['top', 'bottom']}
            align="start"
            padding={6}
            getViewport={getViewport}
            useSheet={false}
        >
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
                <span
                    aria-hidden="true"
                    className="anna-project-dot"
                    style={active.color ? { background: active.color } : undefined}
                />
                <span className="anna-project-chip-name">{active.name}</span>
                <Icon name="chevron-down" size={14} color="currentColor" />
            </button>
        </AppPopover>
    )
}
