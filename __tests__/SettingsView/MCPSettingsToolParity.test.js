const fs = require('fs')
const path = require('path')

import { TOOL_LABEL_BY_KEY } from '../../components/AssistantDetailedView/Customizations/ToolsAccess/toolOptions'

// Settings → MCP can only switch off a tool it lists, so a tool the MCP server serves but the
// settings screen omits cannot be disabled by anyone. Both lists are read from source: the
// settings component pulls in redux and the whole UI, and the server list lives in Functions code.
const ROOT = path.join(__dirname, '..', '..')
const SETTINGS_FILE = 'components/SettingsView/MCP/MCPSettings.js'

function readConstant(file, constantName, open, close) {
    const source = fs.readFileSync(path.join(ROOT, file), 'utf8')
    const match = source.match(new RegExp(`const ${constantName} = \\${open}([\\s\\S]*?)\\n\\${close}`))
    if (!match) throw new Error(`${constantName} not found in ${file}`)
    return match[1]
}

const readStringArray = (file, constantName) =>
    [...readConstant(file, constantName, '[', ']').matchAll(/'([a-z_]+)'/g)].map(entry => entry[1])

const serverTools = readStringArray('functions/MCP/mcpServerSimple.js', 'MCP_DELEGATED_ASSISTANT_TOOLS')
const settingsTools = readStringArray(SETTINGS_FILE, 'MCP_TOOL_KEYS')
const mcpToolLabels = Object.fromEntries(
    [...readConstant(SETTINGS_FILE, 'MCP_TOOL_LABELS', '{', '}').matchAll(/^\s+([a-z_]+): '([^']+)'/gm)].map(entry => [
        entry[1],
        entry[2],
    ])
)

describe('Settings → MCP tool list', () => {
    it('lists every tool the MCP server serves', () => {
        expect(serverTools.filter(tool => !settingsTools.includes(tool))).toEqual([])
    })

    it('lists no tool the MCP server does not serve', () => {
        expect(settingsTools.filter(tool => !serverTools.includes(tool))).toEqual([])
    })

    it('lets each project wiki tool and each browser tool be switched off on its own', () => {
        const tools = [
            'read_knowledge_page',
            'correct_knowledge_page',
            'undo_knowledge_correction',
            'browser_navigate',
            'browser_inspect',
            'browser_click',
            'browser_type',
            'browser_wait',
            'browser_screenshot',
        ]
        for (const tool of tools) {
            expect(serverTools).toContain(tool)
            expect(settingsTools).toContain(tool)
        }
    })

    it('gives every tool a label instead of its raw name', () => {
        expect(settingsTools.filter(tool => !TOOL_LABEL_BY_KEY[tool] && !mcpToolLabels[tool])).toEqual([])
    })

    it('translates every MCP-only label', () => {
        expect(Object.keys(mcpToolLabels).length).toBeGreaterThan(0)
        for (const language of ['en', 'de', 'es']) {
            const translations = require(`../../i18n/translations/${language}.json`)
            const untranslated = Object.values(mcpToolLabels).filter(label => typeof translations[label] !== 'string')
            expect({ language, untranslated }).toEqual({ language, untranslated: [] })
        }
    })
})
