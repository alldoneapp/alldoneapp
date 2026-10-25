const fs = require('fs')
const path = require('path')

// Settings → MCP can only switch off a tool it lists, so a tool the MCP server serves but the
// settings screen omits cannot be disabled by anyone. Both lists are read from source: the
// settings component pulls in redux and the whole UI, and the server list lives in Functions code.
const ROOT = path.join(__dirname, '..', '..')

function readStringArray(file, constantName) {
    const source = fs.readFileSync(path.join(ROOT, file), 'utf8')
    const match = source.match(new RegExp(`const ${constantName} = \\[([\\s\\S]*?)\\n\\]`))
    if (!match) throw new Error(`${constantName} not found in ${file}`)
    return [...match[1].matchAll(/'([a-z_]+)'/g)].map(entry => entry[1])
}

// Served over MCP but not yet switchable in Settings. Shrink this list; never grow it.
const NOT_YET_IN_SETTINGS = [
    'browser_navigate',
    'browser_inspect',
    'browser_click',
    'browser_type',
    'browser_wait',
    'browser_screenshot',
]

const serverTools = readStringArray('functions/MCP/mcpServerSimple.js', 'MCP_DELEGATED_ASSISTANT_TOOLS')
const settingsTools = readStringArray('components/SettingsView/MCP/MCPSettings.js', 'MCP_TOOL_KEYS')

describe('Settings → MCP tool list', () => {
    it('lists every tool the MCP server serves', () => {
        const missing = serverTools.filter(tool => !settingsTools.includes(tool) && !NOT_YET_IN_SETTINGS.includes(tool))
        expect(missing).toEqual([])
    })

    it('lists no tool the MCP server does not serve', () => {
        expect(settingsTools.filter(tool => !serverTools.includes(tool))).toEqual([])
    })

    it('keeps the exceptions honest', () => {
        expect(NOT_YET_IN_SETTINGS.filter(tool => settingsTools.includes(tool) || !serverTools.includes(tool))).toEqual(
            []
        )
    })

    it('lets each project wiki tool be switched off on its own', () => {
        for (const tool of ['read_knowledge_page', 'correct_knowledge_page', 'undo_knowledge_correction']) {
            expect(serverTools).toContain(tool)
            expect(settingsTools).toContain(tool)
        }
    })

    it('has a translated label for each wiki tool', () => {
        const labels = ['Read wiki page', 'Correct wiki page', 'Undo wiki correction']
        for (const language of ['en', 'de', 'es']) {
            const translations = require(`../../i18n/translations/${language}.json`)
            for (const label of labels) expect(translations[label]).toEqual(expect.any(String))
        }
    })
})
