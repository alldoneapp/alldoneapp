import { createContext } from 'react'

// Anna's chat opens MCP Apps views (e.g. Judy) in the shell's right pane instead of inline under the
// answer: `{ open(view), selectedViewId }`. Outside the assistant shell there is no pane and the
// view stays inline (McpAppViews).
export default createContext(null)
