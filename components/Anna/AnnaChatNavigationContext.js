import { createContext } from 'react'
import { setAnnaMode } from '../../utils/annaMode'

// Only a visible desktop sidebar supplies a close action. Mobile headers keep
// the assistant toggle as the entry point back to the conversation.
export const AnnaSidebarCloseContext = createContext(null)

// AT-3034: the project whose chat the assistant-mode sidebar continues in (the
// account's default project while it is on "Automatic"). The assistant line's
// entry button compares its own project with it to decide between "open this
// assistant there" and "close the sidebar". Null outside the shell.
export const AnnaSidebarProjectContext = createContext(null)

// The shell also selects and focuses the chat pane when assistant mode is already
// active. Standalone navigation consumers can still enable assistant mode.
// AT-3034: `open({ projectId })` also moves the sidebar to that project's chat
// (null: "Automatic", the default project's chat). Without an argument the
// sidebar keeps its project.
export default createContext(() => setAnnaMode(true))
