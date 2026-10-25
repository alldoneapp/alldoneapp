'use strict'

// Names and schemas of the project wiki's assistant tools, kept free of dependencies so that the
// tool schema registry (Assistant/toolSchemas.js) can include them without loading Firestore code.
// What the tools do and when a run gets them: knowledgeBaseAssistant.js.

const { KNOWLEDGE_PAGE_SUMMARY_MAX_CHARS, KNOWLEDGE_PAGE_TITLE_MAX_CHARS } = require('./knowledgeBaseModel')

const READ_KNOWLEDGE_PAGE_TOOL = 'read_knowledge_page'
const CORRECT_KNOWLEDGE_PAGE_TOOL = 'correct_knowledge_page'
const UNDO_KNOWLEDGE_CORRECTION_TOOL = 'undo_knowledge_correction'
const KNOWLEDGE_BASE_TOOL_NAMES = [
    READ_KNOWLEDGE_PAGE_TOOL,
    CORRECT_KNOWLEDGE_PAGE_TOOL,
    UNDO_KNOWLEDGE_CORRECTION_TOOL,
]

const KNOWLEDGE_CORRECTION_MAX_CHARS = 2000

const projectIdProperty = {
    type: 'string',
    description: "Optional: another project's ID. Defaults to the project of this conversation.",
}

const KNOWLEDGE_BASE_TOOL_SCHEMAS = {
    [READ_KNOWLEDGE_PAGE_TOOL]: {
        type: 'function',
        function: {
            name: READ_KNOWLEDGE_PAGE_TOOL,
            description:
                "Read a page of the project wiki: what the project knows, compiled from its shared tasks, goals, notes and contacts. Pass the page's slug from the wiki index in your instructions. Without a slug it returns the list of all pages.",
            parameters: {
                type: 'object',
                properties: {
                    slug: { type: 'string', description: 'The page slug from the wiki index, e.g. "customers".' },
                    projectId: projectIdProperty,
                },
                required: [],
            },
        },
    },
    [CORRECT_KNOWLEDGE_PAGE_TOOL]: {
        type: 'function',
        function: {
            name: CORRECT_KNOWLEDGE_PAGE_TOOL,
            description: `Correct a page of the project wiki because the user said it is wrong or incomplete. Read the page with ${READ_KNOWLEDGE_PAGE_TOOL} first. The correction is applied immediately for everyone in the project and later wiki updates will respect it. Change only what the user asked for and never add anything you know from private tasks, notes or chats.`,
            parameters: {
                type: 'object',
                properties: {
                    slug: { type: 'string', description: 'The slug of the page to correct.' },
                    revision: {
                        type: 'number',
                        description: `The revision ${READ_KNOWLEDGE_PAGE_TOOL} returned for the page.`,
                    },
                    correction: {
                        type: 'string',
                        description: `What the user says is wrong and what is right, in their own words (at most ${KNOWLEDGE_CORRECTION_MAX_CHARS} characters). Everyone in the project can read it.`,
                    },
                    body: {
                        type: 'string',
                        description:
                            'The complete corrected page in markdown. Replace what is wrong with what is right rather than keeping both: the page states the current version only, without mentioning the old one or that it was corrected. Keep every [[...]] token of statements that stay, and mark each corrected statement with [[correction:new]].',
                    },
                    title: {
                        type: 'string',
                        description: `Optional new title (at most ${KNOWLEDGE_PAGE_TITLE_MAX_CHARS} characters); the current one is kept otherwise.`,
                    },
                    summary: {
                        type: 'string',
                        description: `Optional new one-sentence summary (at most ${KNOWLEDGE_PAGE_SUMMARY_MAX_CHARS} characters).`,
                    },
                    projectId: projectIdProperty,
                },
                required: ['slug', 'revision', 'correction', 'body'],
            },
        },
    },
    [UNDO_KNOWLEDGE_CORRECTION_TOOL]: {
        type: 'function',
        function: {
            name: UNDO_KNOWLEDGE_CORRECTION_TOOL,
            description: `Take back a correction made with ${CORRECT_KNOWLEDGE_PAGE_TOOL}, restoring the page as it was before. Only possible while the page has not changed since.`,
            parameters: {
                type: 'object',
                properties: {
                    correctionId: {
                        type: 'string',
                        description: `The correctionId ${CORRECT_KNOWLEDGE_PAGE_TOOL} returned.`,
                    },
                    projectId: projectIdProperty,
                },
                required: ['correctionId'],
            },
        },
    },
}

module.exports = {
    READ_KNOWLEDGE_PAGE_TOOL,
    CORRECT_KNOWLEDGE_PAGE_TOOL,
    UNDO_KNOWLEDGE_CORRECTION_TOOL,
    KNOWLEDGE_BASE_TOOL_NAMES,
    KNOWLEDGE_CORRECTION_MAX_CHARS,
    KNOWLEDGE_BASE_TOOL_SCHEMAS,
}
