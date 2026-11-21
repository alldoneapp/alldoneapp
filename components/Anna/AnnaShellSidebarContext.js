import { createContext } from 'react'

/**
 * AT-3121, the "Anna on top" sidebar (Settings -> Sidebar navigation; stored as `sectionsTop`). With
 * the chat open on a wide desktop window AnnaShell draws the one sidebar itself, left of the chat
 * (sidebar | chat | Alldone), so it stays on screen with the chat alone too. Inside the workspace this
 * is true and the screens leave their own sidebar out (CustomSideMenu).
 */
export const AnnaShellSidebarContext = createContext(false)

/**
 * The Anna button at the top of that sidebar. Null outside AnnaShell.
 * - `name`, `photo`: who answers.
 * - `chatShown`: the chat is on screen (alone or with Alldone beside it).
 * - `onOpenChat()`: opens the chat as it was last shown, or goes back to it when it is open.
 * - `onLeaveChat()`: leaves the chat for Alldone, keeping the page; the sidebar calls it when a
 *   project, All projects or a section is picked while Anna is alone on screen.
 */
export const AnnaSidebarModeContext = createContext(null)
