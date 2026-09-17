import React, { useCallback, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import Popover from 'react-tiny-popover'

import BottomSheet from './BottomSheet'
import { ModalShellContext } from './ModalShellContext'
import useModalSizing from '../../../hooks/useModalSizing'

const SHEET_CONTENT_INFO = { position: 'bottom', align: 'center' }
const SHEET_CONTEXT_VALUE = { presentation: 'sheet' }

/**
 * AppPopover owns the content tree; this host only chooses where its stable
 * portal container is attached. Changing hosts therefore moves DOM instead of
 * asking React to unmount one form and mount another one at the breakpoint.
 */
function PreservedContentHost({ contentNode, onPresenceChange, onInlinePresenceChange }) {
    const hostRef = useRef(null)

    useLayoutEffect(() => {
        const host = hostRef.current
        // react-test-renderer does not create DOM nodes for host refs. Leave the
        // content in AppPopover's tree in that renderer instead of creating a
        // ReactDOM portal into a container it cannot manage.
        if (!host || typeof host.appendChild !== 'function' || !contentNode) {
            onInlinePresenceChange(1)
            return () => onInlinePresenceChange(-1)
        }

        host.appendChild(contentNode)
        onPresenceChange(1)
        return () => {
            onPresenceChange(-1)
            // During a responsive handoff the new host may already own the
            // node. The retiring host must not detach it again.
            if (contentNode.parentNode === host) host.removeChild(contentNode)
        }
    }, [contentNode, onInlinePresenceChange, onPresenceChange])

    return <div ref={hostRef} style={{ display: 'contents' }} />
}

/**
 * Drop-in replacement for a direct react-tiny-popover usage
 * (MODAL_IMPROVEMENT_PLAN.md, Phase 2): below MODAL_SHEET_BREAKPOINT the
 * content renders as a BottomSheet; everywhere else the vendored Popover is
 * used untouched, with every prop passed through. Migrating a popup =
 * swapping the <Popover> tag for <AppPopover> in its trigger wrapper.
 *
 * In sheet mode `position`, `align`, `padding` and `contentLocation` are
 * meaningless and ignored; `onClickOutside` doubles as the sheet's close
 * request (backdrop tap / Escape / drag affordance).
 */
export default function AppPopover({ content, children, isOpen, onClickOutside, modalId, ...popoverProps }) {
    const { isSheet } = useModalSizing()
    const contentNodeRef = useRef(null)
    const [contentHostCount, setContentHostCount] = useState(0)
    const [contentRenderer, setContentRenderer] = useState(null)

    if (!contentNodeRef.current && typeof document !== 'undefined') {
        contentNodeRef.current = document.createElement('div')
        contentNodeRef.current.style.display = 'contents'
    }

    const onPresenceChange = useCallback(delta => {
        if (delta > 0) setContentRenderer('portal')
        setContentHostCount(count => Math.max(0, count + delta))
    }, [])
    const onInlinePresenceChange = useCallback(delta => {
        if (delta > 0) setContentRenderer(current => current || 'inline')
        setContentHostCount(count => Math.max(0, count + delta))
    }, [])

    const fallbackPosition = Array.isArray(popoverProps.position)
        ? popoverProps.position[0]
        : popoverProps.position || 'top'
    const contentInfo = isSheet
        ? SHEET_CONTENT_INFO
        : { position: fallbackPosition, align: popoverProps.align || 'center' }
    // Keep content through each shell's close animation. While open, isOpen
    // bridges the short interval in which one host has retired and the other
    // has not mounted yet.
    const shouldRenderContent = !!content && (!!isOpen || contentHostCount > 0)
    const renderedContent = shouldRenderContent
        ? typeof content === 'function'
            ? content(contentInfo)
            : content
        : null
    const contextValue = isSheet ? SHEET_CONTEXT_VALUE : null

    // Keep both the trigger and popup content under stable React ancestors
    // across the breakpoint. Only the content's DOM container moves between
    // the desktop popover portal and the mobile bottom-sheet portal.
    return (
        <>
            <Popover
                {...popoverProps}
                content={
                    isSheet ? null : (
                        <PreservedContentHost
                            contentNode={contentNodeRef.current}
                            onInlinePresenceChange={onInlinePresenceChange}
                            onPresenceChange={onPresenceChange}
                        />
                    )
                }
                isOpen={!isSheet && isOpen}
                onClickOutside={onClickOutside}
            >
                {children}
            </Popover>
            {/* Legacy content={null} dialogs position their own card. Never
                cover that card with an empty mobile sheet and backdrop. */}
            {isSheet && !!content && (
                <BottomSheet isOpen={!!isOpen} onRequestClose={onClickOutside} modalId={modalId}>
                    <PreservedContentHost
                        contentNode={contentNodeRef.current}
                        onInlinePresenceChange={onInlinePresenceChange}
                        onPresenceChange={onPresenceChange}
                    />
                </BottomSheet>
            )}
            {shouldRenderContent &&
                contentNodeRef.current &&
                (contentRenderer === 'portal' ? (
                    createPortal(
                        <ModalShellContext.Provider value={contextValue}>{renderedContent}</ModalShellContext.Provider>,
                        contentNodeRef.current
                    )
                ) : contentRenderer === 'inline' ? (
                    <ModalShellContext.Provider value={contextValue}>{renderedContent}</ModalShellContext.Provider>
                ) : null)}
        </>
    )
}
