import { createContext } from 'react'

// True while AnnaShell shows its own top strip above the chat card and the workspace card (desktop
// assistant mode). Gold, search, chats and updates live in that strip then, so Alldone's own top
// bar inside the workspace stays hidden (TopBarContainer).
const AnnaTopStripContext = createContext(false)

export default AnnaTopStripContext
