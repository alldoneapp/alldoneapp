#!/usr/bin/env node
'use strict'

// Inspect committed source without loading application modules or credentials.
const { execFileSync } = require('child_process')
const fs = require('fs')
const path = require('path')
const { createHash } = require('crypto')
const loadTool = name => {
    const installed = path.join(__dirname, 'function-scope-tools/node_modules', name)
    return require(fs.existsSync(installed) ? installed : name)
}
const parser = loadTool('@babel/parser')
const traverse = loadTool('@babel/traverse').default
const INDEX = 'functions/index.js'
const hash = value => createHash('sha256').update(value).digest('hex')
const normalize = node =>
    JSON.stringify(node, (key, value) =>
        [
            'start',
            'end',
            'loc',
            'extra',
            'leadingComments',
            'innerComments',
            'trailingComments',
            'comments',
            'tokens',
        ].includes(key)
            ? undefined
            : value
    )
const nonRuntime = file =>
    /(^|\/)(__tests__|__mocks__|__fixtures__)(\/|$)|\.(test|spec)\.[cm]?[jt]sx?$|(^|\/)(README|CHANGELOG|AGENTS|CLAUDE)(\.[^/]*)?\.md$/i.test(
        file
    )
const globalFile = file =>
    /^functions\/(package(?:-lock)?\.json|npm-shrinkwrap\.json|\.npmrc|firebaseConfig\.js|env_functions[^/]*\.json|service_accounts\/)/.test(
        file
    )
const staticString = node =>
    node?.type === 'StringLiteral'
        ? node.value
        : node?.type === 'TemplateLiteral' && node.expressions.length === 0
          ? node.quasis[0].value.cooked
          : null
const parse = (source, file = '') =>
    parser.parse(source, {
        sourceType: 'unambiguous',
        plugins: ['jsx', ...(/\.tsx?$/.test(file) ? ['typescript'] : [])],
    })

function gitTree(root, ref, blobs = new Map()) {
    const git = args =>
        execFileSync('git', ['-C', root, ...args], {
            encoding: 'utf8',
            maxBuffer: 30 * 1024 * 1024,
        })
    const sha = git(['rev-parse', '--verify', `${ref}^{commit}`]).trim()
    const entries = new Map(
        git(['ls-tree', '-r', '-z', sha])
            .split('\0')
            .filter(Boolean)
            .map(entry => {
                const [metadata, file] = entry.split('\t')
                return [file, metadata.split(' ')[2]]
            })
    )
    return {
        sha,
        files: new Set(entries.keys()),
        read(file) {
            const blob = entries.get(file)
            if (!blob) return null
            // Most dependencies are identical across the two commits. Read each
            // immutable blob once rather than spawning git again for the old tree.
            if (!blobs.has(blob)) blobs.set(blob, git(['cat-file', 'blob', blob]))
            return blobs.get(blob)
        },
    }
}

function resolveImport(tree, file, specifier) {
    if (!specifier.startsWith('.')) return [] // npm packages are covered by package/lockfile changes.
    const base = path.posix.normalize(path.posix.join(path.posix.dirname(file), specifier))
    if (base.startsWith('../')) throw new Error(`Import leaves repository: ${file}`)
    const candidates = [
        base,
        `${base}.js`,
        `${base}.cjs`,
        `${base}.mjs`,
        `${base}.jsx`,
        `${base}.ts`,
        `${base}.tsx`,
        `${base}.json`,
    ]
    const manifest = `${base}/package.json`
    if (tree.files.has(manifest)) {
        const main = JSON.parse(tree.read(manifest)).main || 'index.js'
        candidates.push(path.posix.join(base, main), path.posix.join(base, `${main}.js`))
    }
    candidates.push(
        `${base}/index.js`,
        `${base}/index.jsx`,
        `${base}/index.ts`,
        `${base}/index.tsx`,
        `${base}/index.json`
    )
    const resolved = candidates.find(candidate => tree.files.has(candidate))
    // Generated environment/credential JSON is not tracked. Retain its path;
    // changes to setup/configuration force a full deploy independently.
    if (!resolved && /\.json$/.test(base)) return [base]
    if (!resolved) throw new Error(`Cannot resolve ${specifier} from ${file}`)
    return tree.files.has(manifest) ? [manifest, resolved] : [resolved]
}

function modulePackageFile(tree, file) {
    let directory = path.posix.dirname(file)
    for (;;) {
        const manifest = path.posix.join(directory, 'package.json')
        if (tree.files.has(manifest)) return manifest
        if (directory === '.') return null
        directory = path.posix.dirname(directory)
    }
}

// TaskService/NoteService have browser-only fallback imports that otherwise pull
// the frontend into the backend graph. Only prune provably unreachable branches:
// never evaluate source with the scanner process's env/globals or execute it.
function hasCommonJsRequire(tree, file, ast) {
    if (!/\.(cjs|js)$/.test(file) || ast.program.sourceType !== 'script') return false
    const manifest = modulePackageFile(tree, file)
    if (!file.endsWith('.cjs') && manifest && JSON.parse(tree.read(manifest)).type === 'module') return false

    let stable = true
    const checkWrite = target => {
        if (target.getBindingIdentifiers().require && !target.scope.getBinding('require')) stable = false
    }
    traverse(ast, {
        AssignmentExpression: p => checkWrite(p.get('left')),
        UpdateExpression: p => checkWrite(p.get('argument')),
        ForInStatement: p => checkWrite(p.get('left')),
        ForOfStatement: p => checkWrite(p.get('left')),
        WithStatement() {
            stable = false
        },
        CallExpression(p) {
            if (p.get('callee').isIdentifier({ name: 'eval' }) && !p.scope.getBinding('eval')) stable = false
        },
    })
    return stable
}

const UNKNOWN_RUNTIME_VALUE = Symbol('unknown runtime value')
function runtimeValue(p, commonJsRequire) {
    if (p.isStringLiteral() || p.isBooleanLiteral() || p.isNumericLiteral()) return p.node.value
    if (p.isNullLiteral()) return null
    if (p.isUnaryExpression()) {
        const argument = p.get('argument')
        if (
            p.node.operator === 'typeof' &&
            commonJsRequire &&
            argument.isIdentifier({ name: 'require' }) &&
            !argument.scope.getBinding('require')
        )
            return 'function'
        if (p.node.operator === '!') {
            const value = runtimeValue(argument, commonJsRequire)
            if (value !== UNKNOWN_RUNTIME_VALUE) return !value
        }
    }
    if (p.isBinaryExpression()) {
        const left = runtimeValue(p.get('left'), commonJsRequire)
        const right = runtimeValue(p.get('right'), commonJsRequire)
        if (left !== UNKNOWN_RUNTIME_VALUE && right !== UNKNOWN_RUNTIME_VALUE) {
            switch (p.node.operator) {
                case '===':
                    return left === right
                case '!==':
                    return left !== right
                case '==':
                    return left == right
                case '!=':
                    return left != right
            }
        }
    }
    if (p.isLogicalExpression()) {
        const left = runtimeValue(p.get('left'), commonJsRequire)
        if (left !== UNKNOWN_RUNTIME_VALUE) {
            if (p.node.operator === '&&' && !left) return left
            if (p.node.operator === '||' && left) return left
            if (p.node.operator === '??' && left != null) return left
            return runtimeValue(p.get('right'), commonJsRequire)
        }
    }
    return UNKNOWN_RUNTIME_VALUE
}

function traverseRuntime(nodePath, visitors, commonJsRequire) {
    nodePath.traverse({
        ...visitors,
        enter(p) {
            const parent = p.parentPath
            if (
                (parent.isIfStatement() || parent.isConditionalExpression()) &&
                (p.key === 'consequent' || p.key === 'alternate')
            ) {
                const value = runtimeValue(parent.get('test'), commonJsRequire)
                if (value !== UNKNOWN_RUNTIME_VALUE && Boolean(value) !== (p.key === 'consequent')) p.skip()
            } else if (parent.isLogicalExpression() && p.key === 'right') {
                const value = runtimeValue(parent.get('left'), commonJsRequire)
                if (
                    value !== UNKNOWN_RUNTIME_VALUE &&
                    ((parent.node.operator === '&&' && !value) ||
                        (parent.node.operator === '||' && value) ||
                        (parent.node.operator === '??' && value != null))
                )
                    p.skip()
            }
        },
    })
}

function importsFor(nodePath, tree, file, commonJsRequire) {
    // Package type determines the runtime branches even for shared files outside
    // functions/. A format change must invalidate those callers too.
    const manifest = modulePackageFile(tree, file)
    const imports = new Set(manifest ? [manifest] : [])
    let uncertain = false
    const add = node => {
        const specifier = staticString(node)
        if (specifier === null) {
            uncertain = true
            return
        }
        try {
            resolveImport(tree, file, specifier).forEach(file => imports.add(file))
        } catch (_) {
            uncertain = true
        }
    }
    const visitors = {
        CallExpression(p) {
            if (
                (p.node.callee.type === 'Identifier' && p.node.callee.name === 'require') ||
                p.node.callee.type === 'Import'
            )
                add(p.node.arguments[0])
        },
        ImportDeclaration(p) {
            add(p.node.source)
        },
        ExportNamedDeclaration(p) {
            if (p.node.source) add(p.node.source)
        },
        ExportAllDeclaration(p) {
            add(p.node.source)
        },
    }
    traverseRuntime(nodePath, visitors, commonJsRequire)
    if (visitors[nodePath.node.type]) visitors[nodePath.node.type](nodePath)
    return { imports, uncertain }
}

function buildGraph(tree) {
    const ast = parse(tree.read(INDEX))
    const commonJsRequire = hasCommonJsRequire(tree, INDEX, ast)
    const statements = new Map()
    const exports = new Map()
    const globals = []
    const top = p => {
        while (p.parentPath && !p.parentPath.isProgram()) p = p.parentPath
        return p.node
    }
    traverse(ast, {
        Program(program) {
            program.get('body').forEach(p => {
                const statement = p.node
                const assignment = p.isExpressionStatement() ? statement.expression : null
                const left = assignment?.type === 'AssignmentExpression' ? assignment.left : null
                const isExport =
                    left?.type === 'MemberExpression' &&
                    left.object.type === 'Identifier' &&
                    left.object.name === 'exports'
                const name = isExport ? (left.computed ? staticString(left.property) : left.property.name) : null
                if (isExport && (!name || !/^[A-Za-z_$][\w$]*$/.test(name))) throw new Error('Dynamic function export')
                const info = {
                    ...importsFor(p, tree, INDEX, commonJsRequire),
                    dependencies: new Set(),
                    signature: hash(normalize(statement)),
                }
                traverseRuntime(
                    p,
                    {
                        ReferencedIdentifier(reference) {
                            const binding = reference.scope.getBinding(reference.node.name)
                            if (binding && binding.scope.path.isProgram()) info.dependencies.add(top(binding.path))
                        },
                    },
                    commonJsRequire
                )
                statements.set(statement, info)
                if (name) {
                    if (exports.has(name)) throw new Error(`Repeated function export: ${name}`)
                    exports.set(name, statement)
                } else if (
                    (p.isVariableDeclaration() &&
                        p.node.declarations.some(declaration => {
                            const init = declaration.init
                            return (
                                init &&
                                ![
                                    'StringLiteral',
                                    'NumericLiteral',
                                    'BooleanLiteral',
                                    'NullLiteral',
                                    'FunctionExpression',
                                    'ArrowFunctionExpression',
                                ].includes(init.type) &&
                                !(init.type === 'CallExpression' && init.callee.name === 'require')
                            )
                        })) ||
                    (!p.isVariableDeclaration() &&
                        !p.isFunctionDeclaration() &&
                        !p.isClassDeclaration() &&
                        !p.isImportDeclaration())
                ) {
                    globals.push(statement)
                }
            })
            program.traverse({
                ReferencedIdentifier(p) {
                    if (p.scope.getBinding(p.node.name)) return
                    if (p.node.name === 'exports') {
                        const member = p.parentPath
                        const assignment = member.parentPath
                        if (
                            !member.isMemberExpression() ||
                            !assignment.isAssignmentExpression() ||
                            assignment.node.left !== member.node ||
                            ![...exports.values()].includes(top(assignment))
                        )
                            throw new Error('Unsupported function export reference')
                    }
                    if (
                        p.node.name === 'module' &&
                        p.parentPath.isMemberExpression() &&
                        (p.parent.computed ? staticString(p.parent.property) : p.parent.property.name) === 'exports'
                    )
                        throw new Error('Unsupported module.exports')
                },
                AssignmentExpression(p) {
                    const left = p.node.left
                    const root = left?.type === 'MemberExpression' ? left.object : null
                    const writesExports = root?.type === 'Identifier' && root.name === 'exports'
                    const writesModule =
                        root?.type === 'Identifier' &&
                        root.name === 'module' &&
                        (left.computed ? staticString(left.property) : left.property.name) === 'exports'
                    if (writesModule || (writesExports && ![...exports.values()].includes(top(p))))
                        throw new Error('Unsupported function export assignment')
                },
            })
            program.stop()
        },
    })
    if (!exports.size) throw new Error('No static function exports')
    const modules = new Map()
    const moduleInfo = file => {
        if (modules.has(file)) return modules.get(file)
        const info = { imports: new Set(), uncertain: false }
        modules.set(file, info)
        if (!/\.[cm]?[jt]sx?$/.test(file)) return info
        try {
            const moduleAst = parse(tree.read(file), file)
            const commonJsRequire = hasCommonJsRequire(tree, file, moduleAst)
            traverse(moduleAst, {
                Program(p) {
                    Object.assign(info, importsFor(p, tree, file, commonJsRequire))
                    p.stop()
                },
            })
        } catch (_) {
            info.uncertain = true
        }
        return info
    }
    const functions = new Map()
    for (const [name, statement] of exports) {
        const visited = new Set()
        const files = new Set()
        let uncertain = false
        const visitFile = file => {
            if (files.has(file)) return
            files.add(file)
            const info = moduleInfo(file)
            uncertain ||= info.uncertain
            info.imports.forEach(visitFile)
        }
        const visitStatement = node => {
            if (visited.has(node)) return
            visited.add(node)
            const info = statements.get(node)
            if (!info) throw new Error('Unresolved entrypoint binding')
            uncertain ||= info.uncertain
            info.imports.forEach(visitFile)
            info.dependencies.forEach(visitStatement)
        }
        globals.forEach(visitStatement)
        visitStatement(statement)
        functions.set(name, {
            files,
            uncertain,
            signature: hash(
                [...statements.keys()]
                    .filter(node => visited.has(node))
                    .map(node => statements.get(node).signature)
                    .join(',')
            ),
        })
    }
    return functions
}

function functionDeploymentEnvironment(tree) {
    const yaml = loadTool('js-yaml')
    const source = tree.read('.gitlab-ci.yml')
    const config = source ? yaml.safeLoad(source) || {} : {}
    const fields = ['image', 'before_script', 'script', 'variables', 'services', 'extends', 'inherit']
    const pick = job => Object.fromEntries(fields.filter(key => job?.[key] !== undefined).map(key => [key, job[key]]))
    return JSON.stringify({
        variables: config.variables,
        include: config.include,
        defaults: pick(config.default),
        jobs: ['deploy:cloud:functions:production', 'deploy:cloud:functions:staging'].map(name => pick(config[name])),
    })
}

function selectDeployment({ before, after, changed, force = false }) {
    const current = buildGraph(after)
    const names = [...current.keys()].sort()
    const full = reason => ({ mode: 'full', names, reason })
    if (!before || force) return full(force ? 'Explicit full deployment requested' : 'No verified deployment baseline')
    const relevant = changed.filter(file => {
        if (!before || !/\.[cm]?[jt]sx?$|\.json$/.test(file)) return true
        const oldSource = before.read(file),
            newSource = after.read(file)
        if (oldSource == null || newSource == null) return true
        try {
            const semantic = source =>
                /\.json$/.test(file) ? JSON.stringify(JSON.parse(source)) : normalize(parse(source, file).program)
            return semantic(oldSource) !== semantic(newSource)
        } catch (_) {
            return true
        }
    })
    if (relevant.includes('.gitlab-ci.yml')) {
        try {
            if (functionDeploymentEnvironment(before) !== functionDeploymentEnvironment(after))
                return full('Functions deployment environment changed')
        } catch (_) {
            return full('Cannot verify Functions deployment configuration')
        }
    }
    if (relevant.some(globalFile)) return full('Runtime, dependencies or shared environment configuration changed')
    if (relevant.includes('firebase.json')) {
        const config = tree => JSON.stringify(JSON.parse(tree.read('firebase.json') || '{}').functions)
        if (config(before) !== config(after)) return full('Firebase Functions configuration changed')
    }
    if (
        relevant.some(file =>
            ['ci/assertFirebaseFunctionsDeployed.js', 'ci/Dockerfile_functions', 'ci/Dockerfile_firebase'].includes(
                file
            )
        )
    )
        return full('Deployment environment or completion guard changed')
    let previous
    try {
        previous = buildGraph(before)
    } catch (_) {
        return full('Cannot analyze the deployed entrypoint')
    }
    if ([...previous.keys()].some(name => !current.has(name)))
        return full('Removed or renamed function exports require reconciliation')
    const allDependencies = new Set([...previous.values(), ...current.values()].flatMap(value => [...value.files]))
    // An unreferenced runtime file could be loaded through fs, eval or a dynamic
    // path. Do not silently omit it just because static imports cannot prove ownership.
    const runtimeFiles = relevant.filter(file => allDependencies.has(file) || !nonRuntime(file))
    const unknownAssets = runtimeFiles.filter(
        file => file.startsWith('functions/') && file !== INDEX && !allDependencies.has(file)
    )
    if (unknownAssets.length) return full(`Unmapped runtime assets: ${unknownAssets.join(', ')}`)
    const runtimeChanges = runtimeFiles.filter(file => file.startsWith('functions/') || allDependencies.has(file))
    const uncertainChanges = runtimeFiles.some(file => file.startsWith('functions/') || /\.[cm]?[jt]sx?$/.test(file))
    const selected = []
    const reasons = {}
    for (const [name, next] of current) {
        const old = previous.get(name)
        const affected = runtimeChanges.filter(file => next.files.has(file) || old?.files.has(file))
        if (
            !old ||
            old.signature !== next.signature ||
            affected.length ||
            (uncertainChanges && (next.uncertain || old?.uncertain))
        ) {
            selected.push(name)
            reasons[name] = !old
                ? ['New function']
                : old.signature !== next.signature
                  ? ['Entrypoint or shared entrypoint helper changed']
                  : affected.length
                    ? affected
                    : ['Unresolved dynamic dependency; deploy conservatively']
        }
    }
    return {
        mode: selected.length ? 'partial' : 'none',
        names: selected.sort(),
        reasons,
        reason: selected.length ? 'Functions affected by committed source changes' : 'No runtime function changes',
    }
}

function makePlan(root, base, head, force = false) {
    const blobs = new Map()
    const after = gitTree(root, head, blobs)
    let before = null
    if (base) {
        try {
            before = gitTree(root, base, blobs)
        } catch (_) {}
    }
    const changed = before
        ? execFileSync('git', ['-C', root, 'diff', '--name-only', '--no-renames', '-z', before.sha, after.sha], {
              encoding: 'utf8',
          })
              .split('\0')
              .filter(Boolean)
        : []
    const selection = selectDeployment({ before, after, changed, force })
    return {
        version: 1,
        head: after.sha,
        base: before?.sha || null,
        ...selection,
    }
}

if (require.main === module) {
    try {
        const [base, head, output] = process.argv.slice(2)
        if (!head || !output) throw new Error('Usage: selectFunctionsDeployment.js <base-or-empty> <head> <output>')
        const plan = makePlan(
            process.env.CI_PROJECT_DIR || path.resolve(__dirname, '..'),
            base,
            head,
            process.env.FUNCTIONS_DEPLOY_ALL === '1'
        )
        fs.writeFileSync(output, JSON.stringify(plan, null, 2) + '\n')
        console.log(`Functions scope: ${plan.mode}, ${plan.names.length} functions. ${plan.reason}`)
        if (plan.mode === 'partial') console.log(plan.names.join(', '))
        if (plan.mode === 'none') process.exitCode = 76
    } catch (error) {
        console.error(`Cannot safely select Functions deployment: ${error.message}`)
        process.exitCode = 1
    }
}
module.exports = {
    buildGraph,
    selectDeployment,
    makePlan,
    nonRuntime,
    gitTree,
    functionDeploymentEnvironment,
}
