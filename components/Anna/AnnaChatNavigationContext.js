import { createContext } from 'react'
import { setAnnaMode } from '../../utils/annaMode'

// Only a visible desktop sidebar supplies a close action. Mobile headers keep
// the assistant toggle as the entry point back to the conversation.
export const AnnaSidebarCloseContext = createContext(null)

// The shell also selects and focuses the chat pane when assistant mode is already
// active. Standalone navigation consumers can still enable assistant mode.
export default createContext(() => setAnnaMode(true))
