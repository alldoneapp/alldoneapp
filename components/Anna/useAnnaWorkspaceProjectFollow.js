import { useCallback, useEffect, useRef } from 'react'
import { useSelector } from 'react-redux'
import { getAnnaWorkspaceProjectKey } from './annaWorkspaceProjectSync'

// AT-3036 follow-up — when the person opens a project in the Alldone workspace (right) while
// assistant mode is on, the chat (left) follows: `follow(workspaceKey)` is called and picks that
// project's chat, and with it the assistant that answers there.
//
// Only the person's own navigation counts. The workspace also changes project for other reasons,
// none of which may move the chat:
// - the chat's own left-to-right sync (`expectSync`), which would otherwise bounce straight back;
// - the assistant revealing an object it just saved, `show_workspace`, a link or activity row in
//   the chat (all started from the chat side or by no one).
// A person's navigation starts with a pointer or key press outside the chat pane and the Anna
// header (the app sidebar, the header's project picker, which renders in a body portal, a project
// shortcut). That press opens a short window in which a project change is taken as theirs. A press
// on the chat side closes it again, so the latest of both sides wins.
export const ANNA_WORKSPACE_INTENT_MS = 4000

export default function useAnnaWorkspaceProjectFollow({ active, isChatSide, follow }) {
    const workspaceKey = useSelector(getAnnaWorkspaceProjectKey)
    const intentAt = useRef(0)
    const expected = useRef(null)
    const last = useRef(null)
    const isChatSideRef = useRef(isChatSide)
    isChatSideRef.current = isChatSide
    const followRef = useRef(follow)
    followRef.current = follow

    useEffect(() => {
        const mark = event => {
            intentAt.current = isChatSideRef.current?.(event.target) ? 0 : Date.now()
        }
        document.addEventListener('pointerdown', mark, true)
        document.addEventListener('keydown', mark, true)
        return () => {
            document.removeEventListener('pointerdown', mark, true)
            document.removeEventListener('keydown', mark, true)
        }
    }, [])

    useEffect(() => {
        // Detail views and other routes do not move the chat, and are not remembered either: coming
        // back from a task to the same project's list is no project change.
        if (!workspaceKey || workspaceKey === last.current) return
        last.current = workspaceKey
        const now = Date.now()
        const sync = expected.current
        expected.current = null
        if (sync && sync.key === workspaceKey && now - sync.at <= ANNA_WORKSPACE_INTENT_MS) return
        const byUser = intentAt.current > 0 && now - intentAt.current <= ANNA_WORKSPACE_INTENT_MS
        // One press, one follow: a later programmatic change in the same window stays programmatic.
        intentAt.current = 0
        if (active && byUser) followRef.current?.(workspaceKey)
    }, [workspaceKey, active])

    // The chat moved the workspace: that change is the chat's, not the person's in the workspace.
    const expectSync = useCallback(key => {
        intentAt.current = 0
        expected.current = key ? { key, at: Date.now() } : null
    }, [])

    return { expectSync }
}
