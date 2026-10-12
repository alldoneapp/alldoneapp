import { createContext } from 'react'
import { setAnnaMode } from '../../utils/annaMode'

// The shell also selects and focuses the chat pane when assistant mode is already
// active. Standalone navigation consumers can still enable assistant mode.
export default createContext(() => setAnnaMode(true))
