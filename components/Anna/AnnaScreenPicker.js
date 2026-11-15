import React, { useEffect, useRef, useState } from 'react'
import { useDispatch } from 'react-redux'
import AppPopover from '../UIComponents/ModalShell/AppPopover'
import Icon from '../Icon'
import useEscapeKey from '../../hooks/useEscapeKey'
import { hideFloatPopup, showFloatPopup } from '../../redux/actions'
import { translate } from '../../i18n/TranslationService'

const EMPTY = []

/**
 * Desktop assistant mode: chooses what the screen beside the chat shows (Alldone, the shared
 * browser, the VMs or an app the chat opened). It sits in the chat's header, where the workspace
 * picker was, and the chat card points at the screen from here in the bezel's colour, so the chat
 * visibly drives what is on it. Mobile keeps the native select, which also returns to the chat.
 */
export default function AnnaScreenPicker({ options = EMPTY, value, label, onSelect, getViewport }) {
    const dispatch = useDispatch()
    const [open, setOpen] = useState(false)

    const close = () => {
        if (!open) return
        setOpen(false)
        dispatch(hideFloatPopup())
    }
    useEscapeKey(close, { enabled: open })
    const openRef = useRef(open)
    openRef.current = open
    // Release the shortcut block if the header unmounts with the menu open.
    useEffect(
        () => () => {
            if (openRef.current) dispatch(hideFloatPopup())
        },
        []
    )

    const toggle = () => {
        if (open) return close()
        setOpen(true)
        dispatch(showFloatPopup())
    }
    const pick = next => {
        close()
        onSelect?.(next)
    }
    const title = translate('Show on screen')

    const menu = (
        <div className="anna-project-menu anna-screen-menu" role="dialog" aria-label={title}>
            <div className="anna-screen-menu-caption">{title}</div>
            <ul className="anna-project-options" role="listbox" aria-label={title}>
                {options.map(option => {
                    const selected = option.value === value
                    return (
                        <li key={option.value} role="option" aria-selected={selected}>
                            <button
                                type="button"
                                className={`anna-project-option${selected ? ' anna-project-option-selected' : ''}`}
                                data-surface={option.value}
                                onClick={() => pick(option.value)}
                            >
                                <span className="anna-screen-option-icon" aria-hidden="true">
                                    <Icon name={option.icon} size={16} color="currentColor" />
                                </span>
                                <span className="anna-project-option-text">
                                    <strong>{option.label}</strong>
                                    {!!option.detail && <span>{option.detail}</span>}
                                </span>
                                {option.live && (
                                    <span
                                        className="anna-screen-live"
                                        role="img"
                                        aria-label={translate('Running')}
                                        title={translate('Running')}
                                    />
                                )}
                                {selected && <Icon name="check" size={16} color="currentColor" />}
                            </button>
                        </li>
                    )
                })}
            </ul>
        </div>
    )

    return (
        <AppPopover
            content={menu}
            isOpen={open}
            onClickOutside={close}
            position={['bottom', 'top']}
            align="end"
            padding={6}
            getViewport={getViewport}
            useSheet={false}
        >
            <button
                type="button"
                className="anna-screen-picker"
                aria-label={`${title}: ${label}`}
                aria-haspopup="dialog"
                aria-expanded={open}
                title={`${title}: ${label}`}
                data-surface={value}
                onClick={toggle}
            >
                <Icon name="monitor" size={16} color="currentColor" />
                <span className="anna-screen-picker-label">{label}</span>
                <Icon name="chevron-down" size={14} color="currentColor" />
            </button>
        </AppPopover>
    )
}
