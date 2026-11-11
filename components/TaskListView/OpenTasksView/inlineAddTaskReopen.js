import React, { createContext, useCallback, useContext, useEffect, useRef } from 'react'

/**
 * AT-3010 — an open inline "Add new task" editor must survive its parent being rebuilt.
 *
 * The inline composer's open state lives in component-local state (`DismissibleItem.visibleModal`),
 * while its draft lives in Redux (`tmpInputTextTask`). Whenever the task board replaces the PARENT of
 * an open composer, React unmounts it: the editor closes and the keyboard goes away, and the draft only
 * comes back when the user taps the line again. Reported on Android right after switching to an empty
 * project from the sidebar: while the first snapshots of the new board land, the board can swap the
 * today section for the missing-dates composer (AT-2672) or for loading ghosts, so the user is
 * typing into a subtree that is being replaced underneath them.
 *
 * `utils/editingGuard.js` freezes the restructures that are known to do this. This is the safety
 * net for the ones that are not frozen: when an open inline composer unmounts without being closed,
 * the board remembers which line it was (project, day, goal), and the next composer for that same
 * line that mounts on the same board opens itself again. The draft is restored by `EditTask` from
 * `tmpInputTextTask`, and the editor focuses itself on mount as it always does.
 *
 * The memory is scoped to one board instance (`OpenTasksByProject` is keyed by project and user),
 * not to time: switching project, tab or section unmounts the board and drops it, so an editor
 * never reopens in a place the user deliberately left. Closing the editor (Escape, outside tap,
 * Cancel, submit) clears it, and opening any other inline composer on the board replaces it.
 */
const InlineAddTaskReopenContext = createContext(null)

export function InlineAddTaskReopenScope({ children }) {
    const registryRef = useRef(null)
    if (!registryRef.current) registryRef.current = { pendingLineKey: null }

    return (
        <InlineAddTaskReopenContext.Provider value={registryRef.current}>
            {children}
        </InlineAddTaskReopenContext.Provider>
    )
}

export const getInlineAddTaskLineKey = (projectId, goalId, dateFormated) =>
    `${projectId}|${goalId || ''}|${dateFormated}`

/**
 * @param {string} lineKey identity of the composer line, see getInlineAddTaskLineKey.
 * @param {{current: object}} editorRef ref to the line's DismissibleItem.
 * @returns {Function} `onToggleModal` handler for the line's DismissibleItem.
 */
export function useReopenInlineAddTaskAfterRebuild(lineKey, editorRef) {
    const registry = useContext(InlineAddTaskReopenContext)
    const isOpenRef = useRef(false)
    const lineKeyRef = useRef(lineKey)
    lineKeyRef.current = lineKey

    useEffect(() => {
        if (!registry) return undefined

        // React runs every unmount cleanup of a commit before its mount effects, so a composer that
        // replaces the unmounted one in the same commit already sees the pending line here.
        if (registry.pendingLineKey === lineKeyRef.current) {
            registry.pendingLineKey = null
            const editor = editorRef.current
            if (editor && !editor.modalIsVisible()) editor.openModal(true)
        }

        return () => {
            if (isOpenRef.current) registry.pendingLineKey = lineKeyRef.current
        }
    }, [registry])

    return useCallback(
        isOpen => {
            isOpenRef.current = isOpen
            if (registry && isOpen) registry.pendingLineKey = null
        },
        [registry]
    )
}
