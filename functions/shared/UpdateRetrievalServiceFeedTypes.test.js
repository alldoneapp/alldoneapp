'use strict'

// Every feed type the web app routes to an object (components/Feeds/Utils/FeedsConstants.js,
// FEED_<KIND>_TYPES) must be known to get_updates too, or an entry written through MCP or by an
// assistant is invisible to the agents reading Updates. The web constants are ES modules, so they
// are read as text here.

const fs = require('fs')
const path = require('path')
const { EVENT_TYPE_TO_OBJECT_TYPE } = require('./UpdateRetrievalService')

const WEB_CONSTANTS = path.join(__dirname, '../../components/Feeds/Utils/FeedsConstants.js')
const KINDS = {
    TASK: 'tasks',
    PROJECT: 'projects',
    CONTACT: 'contacts',
    USER: 'users',
    NOTE: 'notes',
    GOAL: 'goals',
    SKILL: 'skills',
    ASSISTANT: 'assistants',
    ARTIFACT: 'artifacts',
}

function readWebFeedTypes() {
    const source = fs.readFileSync(WEB_CONSTANTS, 'utf8')
    const values = {}
    for (const match of source.matchAll(/export const (FEED_[A-Z0-9_]+) = ('([^']+)'|(\d+))\s*$/gm)) {
        values[match[1]] = match[3] !== undefined ? match[3] : Number(match[4])
    }
    const lists = {}
    for (const match of source.matchAll(
        /export const (FEED_[A-Z]+_TYPES|FEED_[A-Z_]+_ACTIVITY_TYPES) = \[([^\]]*)\]/g
    )) {
        lists[match[1]] = match[2]
    }
    const expand = body =>
        body
            .split(/[\s,]+/)
            .map(token => token.trim())
            .filter(token => /^(\.\.\.)?FEED_[A-Z0-9_]+$/.test(token))
            .flatMap(token => (token.startsWith('...') ? expand(lists[token.slice(3)] || '') : [token]))
    return { values, lists, expand }
}

describe('get_updates knows every feed type the app shows', () => {
    const { values, lists, expand } = readWebFeedTypes()

    Object.entries(KINDS).forEach(([kind, objectType]) => {
        it(`FEED_${kind}_TYPES map to ${objectType}`, () => {
            const listName = `FEED_${kind}_TYPES`
            expect(lists[listName]).toBeDefined()
            const missing = expand(lists[listName])
                .filter(name => name in values)
                .filter(name => EVENT_TYPE_TO_OBJECT_TYPE.get(values[name]) !== objectType)
            expect(missing).toEqual([])
        })
    })
})
