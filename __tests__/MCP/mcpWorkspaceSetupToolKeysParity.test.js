const fs = require('fs')
const path = require('path')

import {
    DEFAULT_ALLOWED_TOOLS,
    OPT_IN_ONLY_TOOLS,
    TOOL_OPTIONS,
} from '../../components/AssistantDetailedView/Customizations/ToolsAccess/toolOptions'

// create_assistant over MCP validates Tools Access keys against a copy of the app's list, because
// Functions code cannot import app code. If the two drift, MCP either rejects a key the app offers
// or grants one the app does not know. Read from source like MCPSettingsToolParity.test.js.
const SERVER_FILE = path.join(__dirname, '..', '..', 'functions', 'MCP', 'mcpWorkspaceSetupTools.js')

function readStringArray(constantName) {
    const source = fs.readFileSync(SERVER_FILE, 'utf8')
    const match = source.match(new RegExp(`const ${constantName} = \\[([\\s\\S]*?)\\]`))
    if (!match) throw new Error(`${constantName} not found in ${SERVER_FILE}`)
    return [...match[1].matchAll(/'([a-z_]+)'/g)].map(entry => entry[1])
}

describe('MCP workspace setup: Tools Access keys', () => {
    it('knows exactly the keys the Tools Access screen offers', () => {
        expect(readStringArray('ASSISTANT_TOOL_KEYS').sort()).toEqual(TOOL_OPTIONS.map(option => option.key).sort())
    })

    it('treats the same keys as opt-in only, so its default matches a new assistant in the app', () => {
        expect(readStringArray('OPT_IN_ONLY_ASSISTANT_TOOL_KEYS').sort()).toEqual([...OPT_IN_ONLY_TOOLS].sort())
        const serverDefault = readStringArray('ASSISTANT_TOOL_KEYS').filter(
            key => !readStringArray('OPT_IN_ONLY_ASSISTANT_TOOL_KEYS').includes(key)
        )
        expect(serverDefault.sort()).toEqual([...DEFAULT_ALLOWED_TOOLS].sort())
    })
})
