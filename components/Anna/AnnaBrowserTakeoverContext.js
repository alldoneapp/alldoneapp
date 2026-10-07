import { createContext } from 'react'

// The shell owns an interactive login so navigating the chat or changing panes
// does not remount the controller or put credentials into a chat message.
export default createContext(null)
