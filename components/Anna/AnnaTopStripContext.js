import { createContext } from 'react'

// AnnaShell shows its desktop strip (AnnaTopStrip) in windows wider than this.
export const ANNA_PHONE_QUERY = '(max-width: 760px)'
export const isAnnaPhoneWindow = () =>
    (typeof window !== 'undefined' && window.matchMedia?.(ANNA_PHONE_QUERY).matches) || false

// True while AnnaShell shows its own top strip above Alldone and, in assistant mode, the chat.
// Gold, search, chats and updates live in that strip then, so Alldone's own top bar stays hidden
// (TopBarContainer), and Alldone keeps the desktop sidebar instead of mobile navigation
// (responsiveLayout.js), because no bar is left to open a mobile sidebar from.
const AnnaTopStripContext = createContext(false)

export default AnnaTopStripContext
