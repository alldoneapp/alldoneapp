import { createContext } from 'react'

// Sidebar selections reveal Alldone while keeping the assistant conversation
// open. Outside the assistant shell, navigation already owns the full view.
export default createContext(() => {})
