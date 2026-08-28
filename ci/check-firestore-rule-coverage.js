#!/usr/bin/env node

'use strict'

const fs = require('fs')
const path = require('path')
const parser = require('@babel/parser')

const REPO_ROOT = path.join(__dirname, '..')
const SOURCE_ROOTS = ['App.js', 'components', 'hooks', 'redux', 'utils']
const EXCLUDED_PARTS = new Set(['node_modules', 'HelperScripts', '__tests__', 'firebase_tool', 'migration'])

// These paths are returned from helpers before being passed to collection()/doc(),
// so the call-site AST only sees an identifier. Listing them here keeps that
// deliberate indirection visible and reviewable.
const INDIRECT_CLIENT_COLLECTIONS = [
    'assistantSkillImportJobs',
    'assistantSkillImports',
    'assistantSkills',
    'assistantTasks',
    'assistants',
    'chatObjects',
    'goals',
    'items',
    'noteItems',
    'users',
]

function listJavaScriptFiles(target) {
    const absolute = path.join(REPO_ROOT, target)
    if (!fs.existsSync(absolute)) return []
    const stat = fs.statSync(absolute)
    if (stat.isFile()) return absolute.endsWith('.js') ? [absolute] : []

    const files = []
    for (const entry of fs.readdirSync(absolute, { withFileTypes: true })) {
        if (EXCLUDED_PARTS.has(entry.name)) continue
        const child = path.join(absolute, entry.name)
        if (entry.isDirectory()) files.push(...listJavaScriptFiles(path.relative(REPO_ROOT, child)))
        else if (entry.isFile() && entry.name.endsWith('.js') && !entry.name.endsWith('.test.js')) files.push(child)
    }
    return files
}

function staticPathFromNode(node) {
    if (!node) return null
    if (node.type === 'StringLiteral') return node.value
    if (node.type === 'TemplateLiteral' && node.quasis.length > 0) return node.quasis[0].value.cooked
    return null
}

function callName(callee) {
    if (callee?.type === 'Identifier') return callee.name
    if (callee?.type === 'MemberExpression' && !callee.computed && callee.property?.type === 'Identifier') {
        return callee.property.name
    }
    return null
}

function walk(node, visit) {
    if (!node || typeof node !== 'object') return
    visit(node)
    for (const [key, value] of Object.entries(node)) {
        if (key === 'loc' || key === 'start' || key === 'end') continue
        if (Array.isArray(value)) value.forEach(child => walk(child, visit))
        else if (value && typeof value === 'object' && typeof value.type === 'string') walk(value, visit)
    }
}

function collectionFromPath(value) {
    if (typeof value !== 'string') return null
    const normalized = value.replace(/^\/+/, '')
    const first = normalized.split('/')[0]
    return /^[A-Za-z][A-Za-z0-9_-]*$/.test(first) ? first : null
}

function scanClientCollections() {
    const collections = new Set(INDIRECT_CLIENT_COLLECTIONS)
    const files = SOURCE_ROOTS.flatMap(listJavaScriptFiles)

    for (const file of files) {
        const source = fs.readFileSync(file, 'utf8')
        let ast
        try {
            ast = parser.parse(source, {
                sourceType: 'unambiguous',
                plugins: ['jsx', 'flow', 'classProperties', 'objectRestSpread', 'optionalChaining', 'dynamicImport'],
            })
        } catch (error) {
            throw new Error(`Could not parse ${path.relative(REPO_ROOT, file)}: ${error.message}`)
        }

        walk(ast, node => {
            if (node.type !== 'CallExpression') return
            const name = callName(node.callee)
            if (!['collection', 'doc', 'readDocumentDirectlyFromServer'].includes(name)) return

            const isModularCall = node.callee.type === 'Identifier' && ['collection', 'doc'].includes(name)
            const pathArgument = node.arguments[isModularCall ? 1 : 0]
            const staticPath = staticPathFromNode(pathArgument)
            // `collection('info').doc('version')` is a relative id, not a
            // top-level `version` collection. Root document paths contain `/`.
            if (name === 'doc' && staticPath && !staticPath.includes('/')) return
            const collection = collectionFromPath(staticPath)
            if (collection) collections.add(collection)
        })
    }

    return Array.from(collections).sort()
}

function scanRuleCollections() {
    const source = fs.readFileSync(path.join(REPO_ROOT, 'firestore.rules'), 'utf8')
    return Array.from(source.matchAll(/match\s+\/([A-Za-z][A-Za-z0-9_-]*)/g), match => match[1]).sort()
}

function checkCoverage() {
    const clientCollections = scanClientCollections()
    const ruleCollections = new Set(scanRuleCollections())
    const missing = clientCollections.filter(collection => !ruleCollections.has(collection))
    return { clientCollections, missing }
}

if (require.main === module) {
    const result = checkCoverage()
    if (result.missing.length > 0) {
        console.error(`Firestore client collections missing an explicit rules match: ${result.missing.join(', ')}`)
        process.exitCode = 1
    } else {
        console.log(`Firestore rule coverage OK for ${result.clientCollections.length} client collections.`)
    }
}

module.exports = { checkCoverage, scanClientCollections, scanRuleCollections }
