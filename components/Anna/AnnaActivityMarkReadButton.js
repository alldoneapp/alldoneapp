import React, { useEffect, useRef, useState } from 'react'
import { useSelector } from 'react-redux'
import Icon from '../Icon'
import { translate } from '../../i18n/TranslationService'
import { isBrowserOffline } from '../../utils/connectionState'

// AT-3075: the "Mark as read" control of Assistant mode, on one activity card or for all of them.
// It is a sibling of the card's link, never inside it (a button inside <a> is invalid and would
// open the item), and still stops the click so no ancestor handler treats it as navigation.
// Offline it is not offered: clearing a chat needs the server too.
export default function AnnaActivityMarkReadButton({ onMarkRead, label, className = '', compact = false }) {
    const connectionState = useSelector(state => state.connectionState)
    const [state, setState] = useState('idle')
    const mounted = useRef(true)
    useEffect(
        () => () => {
            mounted.current = false
        },
        []
    )
    if (connectionState === 'offline' || isBrowserOffline()) return null

    const busy = state === 'loading'
    const failed = state === 'error'
    const accessibleLabel = failed ? translate('Anna activity mark read failed') : label
    const press = async event => {
        event.preventDefault()
        event.stopPropagation()
        if (busy) return
        setState('loading')
        try {
            await onMarkRead()
            // Usually unmounted by now: the cleared badge turns the card read and removes the button.
            if (mounted.current) setState('idle')
        } catch (error) {
            console.error('[Anna] Could not mark activity as read', { code: error?.code, message: error?.message })
            if (mounted.current) setState('error')
        }
    }

    return (
        <button
            type="button"
            className={`anna-mark-read${compact ? ' anna-mark-read-compact' : ''}${failed ? ' anna-mark-read-error' : ''}${
                className ? ` ${className}` : ''
            }`}
            aria-label={accessibleLabel}
            title={accessibleLabel}
            aria-busy={busy || undefined}
            disabled={busy}
            data-anna-mark-read=""
            onClick={press}
            // A press on the control must not start the card's or the pane's pointer handling.
            onPointerDown={event => event.stopPropagation()}
        >
            <Icon name={failed ? 'rotate-cw' : 'double-check'} size={compact ? 16 : 14} color="currentColor" />
            {compact ? null : <span>{failed ? translate('try again') : label}</span>}
        </button>
    )
}
