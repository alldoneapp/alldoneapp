'use strict'

// Names and schemas of the project wiki's assistant tools, kept free of dependencies so that the
// tool schema registry (Assistant/toolSchemas.js) can include them without loading Firestore code.
// What the tools do and when a run gets them: knowledgeBaseAssistant.js.

const {
    KNOWLEDGE_DOCUMENT_INSTRUCTIONS_MAX_CHARS,
    KNOWLEDGE_DOCUMENT_TITLE_MAX_CHARS,
    KNOWLEDGE_PAGE_SUMMARY_MAX_CHARS,
    KNOWLEDGE_PAGE_TITLE_MAX_CHARS,
} = require('./knowledgeBaseModel')

const READ_KNOWLEDGE_PAGE_TOOL = 'read_knowledge_page'
const CORRECT_KNOWLEDGE_PAGE_TOOL = 'correct_knowledge_page'
const UNDO_KNOWLEDGE_CORRECTION_TOOL = 'undo_knowledge_correction'
const ADD_KNOWLEDGE_DOCUMENT_TOOL = 'add_knowledge_document'
const REMOVE_KNOWLEDGE_DOCUMENT_TOOL = 'remove_knowledge_document'
const KNOWLEDGE_BASE_TOOL_NAMES = [
    READ_KNOWLEDGE_PAGE_TOOL,
    CORRECT_KNOWLEDGE_PAGE_TOOL,
    UNDO_KNOWLEDGE_CORRECTION_TOOL,
    ADD_KNOWLEDGE_DOCUMENT_TOOL,
    REMOVE_KNOWLEDGE_DOCUMENT_TOOL,
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
                "Start project-knowledge research here, before searching tasks, notes or chats. Choose the project the question concerns, even when this chat is in another project. If its ID is unknown, use get_user_projects. For another project, pass projectId without a slug for its index, then pass the SAME projectId with a returned page slug to read the page. Without projectId it defaults to this conversation's project. The wiki is compiled from shared project sources and added documents; if no relevant page exists, fall back to original sources.",
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
    [ADD_KNOWLEDGE_DOCUMENT_TOOL]: {
        type: 'function',
        function: {
            name: ADD_KNOWLEDGE_DOCUMENT_TOOL,
            description: `Add a file the user uploaded in this conversation to the project wiki, when they ask you to put it, or what it says, into the wiki. Works for PowerPoint (.pptx), Excel (.xlsx), Word (.docx), PDF and text files. The server reads the whole file; you do not pass its content. Within minutes the wiki integrates what the document says into its pages, updating what it supersedes, and cites it. Everyone in the project can then read what the wiki takes from it, so only add a file when the user asked for it.`,
            parameters: {
                type: 'object',
                properties: {
                    messageId: {
                        type: 'string',
                        description:
                            'Optional: the id of the message the file is attached to, from list_recent_chat_media. Leave it out for a file on the current message or one sent recently in this thread.',
                    },
                    fileName: {
                        type: 'string',
                        description:
                            'Optional: the file name as shown in the conversation, to pick one file when several were sent.',
                    },
                    title: {
                        type: 'string',
                        description: `Optional: a short title for the document (at most ${KNOWLEDGE_DOCUMENT_TITLE_MAX_CHARS} characters). Defaults to the file name.`,
                    },
                    instructions: {
                        type: 'string',
                        description: `Optional: what the user wants the wiki to take from the document, in their own words, e.g. "only the pricing" (at most ${KNOWLEDGE_DOCUMENT_INSTRUCTIONS_MAX_CHARS} characters).`,
                    },
                    projectId: {
                        type: 'string',
                        description:
                            'Optional: the ID of the project whose wiki gets the document. Defaults to the project of this conversation; pass another one when the user names it or the document clearly belongs there.',
                    },
                },
                required: [],
            },
        },
    },
    [REMOVE_KNOWLEDGE_DOCUMENT_TOOL]: {
        type: 'function',
        function: {
            name: REMOVE_KNOWLEDGE_DOCUMENT_TOOL,
            description: `Take a document added with ${ADD_KNOWLEDGE_DOCUMENT_TOOL} out of the project wiki. Every page that used it is rebuilt from its other sources, so nothing the document said stays in the wiki. ${READ_KNOWLEDGE_PAGE_TOOL} without a slug lists the documents.`,
            parameters: {
                type: 'object',
                properties: {
                    documentId: {
                        type: 'string',
                        description: `The documentId ${ADD_KNOWLEDGE_DOCUMENT_TOOL} returned or ${READ_KNOWLEDGE_PAGE_TOOL} lists.`,
                    },
                    projectId: projectIdProperty,
                },
                required: ['documentId'],
            },
        },
    },
}

module.exports = {
    READ_KNOWLEDGE_PAGE_TOOL,
    CORRECT_KNOWLEDGE_PAGE_TOOL,
    UNDO_KNOWLEDGE_CORRECTION_TOOL,
    ADD_KNOWLEDGE_DOCUMENT_TOOL,
    REMOVE_KNOWLEDGE_DOCUMENT_TOOL,
    KNOWLEDGE_BASE_TOOL_NAMES,
    KNOWLEDGE_CORRECTION_MAX_CHARS,
    KNOWLEDGE_BASE_TOOL_SCHEMAS,
}
