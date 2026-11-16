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

// Plain Alldone on desktop: the strip to render in Alldone's own top bar slot (TopBarContainer), right
// of the sidebar, which then runs up to the top as it does outside AnnaShell. A screen that renders it
// calls `claim` (and the returned release on unmount); while nothing claims it, as on detail views,
// AnnaShell keeps the strip above everything. Null in assistant mode and on phones.
export const AnnaStripSlotContext = createContext(null)

// Whether Alldone itself is on screen: false in assistant mode while the chat or another screen is
// in front, where the views behind it are not what the user looks at (topBarNavSelection.js).
export const AnnaAppShownContext = createContext(true)

export default AnnaTopStripContext
