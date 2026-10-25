'use strict'

// The assistant's artifact tools: names, the one Tools Access key and the OpenAI schemas. Kept free
// of dependencies so the schema list (`Assistant/toolSchemas.js`), the execution gate
// (`assistantHelper.isToolAllowedForExecution`) and the executor all read the same names.
//
// One Tools Access key (`artifacts`) fans out to four tool names, like `browser_automation`: an
// assistant that can create an artifact but not read it back cannot iterate on one, and iterating
// is the point.

const ARTIFACT_TOOL_KEY = 'artifacts'

const ARTIFACT_TOOL_NAMES = ['get_artifacts', 'read_artifact', 'create_artifact', 'update_artifact']

const ARTIFACT_TOOL_NAME_SET = new Set(ARTIFACT_TOOL_NAMES)

function isArtifactToolName(toolName) {
    return ARTIFACT_TOOL_NAME_SET.has(toolName)
}

const fileListSchema = {
    type: 'array',
    description:
        'Text files, each with a relative path and its full content. Links between files are relative ' +
        '(e.g. index.html loads "style.css" or "data/sales.json").',
    items: {
        type: 'object',
        properties: {
            path: {
                type: 'string',
                description: 'Relative file path, e.g. "index.html", "style.css" or "data/sales.json".',
            },
            content: { type: 'string', description: 'The complete content of the file as text.' },
        },
        required: ['path', 'content'],
    },
}

const liveDataSchema = {
    type: 'boolean',
    description:
        'Optional. True lets an HTML page read live project data when it is viewed inside Alldone, with the ' +
        "viewer's own permissions and only items the whole project can see. Load the helper with " +
        '<script src="_alldone/bridge.js"></script>, then await alldone.project(), alldone.members(), ' +
        "alldone.goals() or alldone.tasks({ status: 'open' | 'done', limit, sinceDays }). Tasks have id, title, " +
        'done, created, completed, dueDate, estimation, assigneeId and goalId (dates in ms). Such a page cannot ' +
        'make network requests: fetch, forms and images from other sites are blocked, and scripts load only ' +
        'from the page itself, cdnjs.cloudflare.com, cdn.jsdelivr.net or unpkg.com. Outside Alldone ' +
        'alldone.available is false; show a short note then. Only the owner of an artifact can switch this.',
}

const projectIdSchema = {
    type: 'string',
    description: 'Optional project ID. Defaults to the current project.',
}

const ARTIFACT_TOOL_SCHEMAS = {
    get_artifacts: {
        type: 'function',
        function: {
            name: 'get_artifacts',
            description:
                "Lists the project's artifacts (dashboards, HTML pages, reports, documents and files the project " +
                'produced), newest edit first. Use it to find an artifact before reading or updating it.',
            parameters: {
                type: 'object',
                properties: {
                    projectId: projectIdSchema,
                    query: {
                        type: 'string',
                        description: 'Optional text to match against artifact titles and descriptions.',
                    },
                    limit: {
                        type: 'number',
                        description: 'Maximum number of artifacts to return (default 30, max 100).',
                    },
                },
                required: [],
            },
        },
    },

    read_artifact: {
        type: 'function',
        function: {
            name: 'read_artifact',
            description:
                "Reads an artifact: its files and the text of one file (the artifact's entry file unless a path is " +
                'given). Read an artifact before updating it so edits are made against its current content.',
            parameters: {
                type: 'object',
                properties: {
                    artifactId: { type: 'string', description: 'The artifact ID.' },
                    projectId: projectIdSchema,
                    path: { type: 'string', description: 'Optional file path inside the artifact.' },
                    versionNumber: {
                        type: 'number',
                        description: 'Optional earlier version to read. Defaults to the current version.',
                    },
                },
                required: ['artifactId'],
            },
        },
    },

    create_artifact: {
        type: 'function',
        function: {
            name: 'create_artifact',
            description:
                'Creates an artifact in the project: a dashboard, an HTML page or report, a Markdown document, an ' +
                'SVG, CSV or JSON file. Use it when the user asks for something to look at, open or share rather ' +
                'than a chat answer. An HTML artifact is rendered live: write a complete page and put its data ' +
                'into the page or into files next to it. It runs sandboxed, without cookies, storage or access to ' +
                'Alldone; scripts from public CDNs work. For a dashboard of project tasks or goals that should stay ' +
                'current and show every viewer their own correct numbers, set liveData and read the data at view ' +
                'time instead of writing it into the page. ' +
                'Everybody who can see the artifact can see everything in it. The result includes the artifact URL; ' +
                'give that exact URL to the user. To change an artifact later use update_artifact instead of ' +
                'creating another one.',
            parameters: {
                type: 'object',
                properties: {
                    title: { type: 'string', description: 'Short title shown in the artifacts list.' },
                    description: { type: 'string', description: 'Optional one or two sentences about the artifact.' },
                    files: fileListSchema,
                    isPrivate: {
                        type: 'boolean',
                        description:
                            'Optional. True makes the artifact visible to the requesting user only. An artifact ' +
                            'created from a private thread is always private.',
                    },
                    liveData: liveDataSchema,
                    projectId: projectIdSchema,
                },
                required: ['title', 'files'],
            },
        },
    },

    update_artifact: {
        type: 'function',
        function: {
            name: 'update_artifact',
            description:
                'Writes a new version of an existing artifact. Send only what changes: `edits` replace exact text ' +
                'in existing files (each `find` must occur exactly once), `files` add or fully replace files, and ' +
                '`removePaths` delete files; every other file is kept. Earlier versions stay restorable. Read the ' +
                'artifact first. Title and description can be changed without a new version.',
            parameters: {
                type: 'object',
                properties: {
                    artifactId: { type: 'string', description: 'The artifact ID.' },
                    projectId: projectIdSchema,
                    edits: {
                        type: 'array',
                        description: 'Exact text replacements in existing text files.',
                        items: {
                            type: 'object',
                            properties: {
                                path: { type: 'string', description: 'File path inside the artifact.' },
                                find: {
                                    type: 'string',
                                    description: 'Exact current text to replace; include enough context to be unique.',
                                },
                                replace: { type: 'string', description: 'The new text.' },
                            },
                            required: ['path', 'find', 'replace'],
                        },
                    },
                    files: fileListSchema,
                    removePaths: {
                        type: 'array',
                        description: 'Paths of files to delete from the artifact.',
                        items: { type: 'string' },
                    },
                    title: { type: 'string', description: 'Optional new title.' },
                    description: { type: 'string', description: 'Optional new description.' },
                    changeSummary: {
                        type: 'string',
                        description: 'One short sentence on what changed, shown in the version history.',
                    },
                    liveData: liveDataSchema,
                },
                required: ['artifactId'],
            },
        },
    },
}

module.exports = {
    ARTIFACT_TOOL_KEY,
    ARTIFACT_TOOL_NAMES,
    ARTIFACT_TOOL_SCHEMAS,
    isArtifactToolName,
}
