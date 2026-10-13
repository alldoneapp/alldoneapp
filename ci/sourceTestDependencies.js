const fs = require('fs')
const path = require('path')
const parser = require('@babel/parser')
const traverse = require('@babel/traverse').default

// Resolve source-reading tests without executing them. Unknown reads retain
// only that suite; known reads select it only when its input changed.
function sourceTestAffected(root, file, inputs) {
    const source = fs.readFileSync(file, 'utf8')
    if (!/readFile|readdir|(?:from\s*|require\s*\(\s*)['"](?:node:)?fs['"]/.test(source)) return false
    const changed = inputs.map(input => path.resolve(root, input))
    let affected = false
    const evaluate = (p, seen = new Set()) => {
        if (!p?.node || seen.has(p.node)) return null
        seen = new Set([...seen, p.node])
        if (p.isStringLiteral()) return p.node.value
        if (p.isIdentifier()) {
            if (p.node.name === '__dirname') return path.dirname(file)
            if (p.node.name === '__filename') return file
            const binding = p.scope.getBinding(p.node.name)
            if (!binding || !binding.constant || !binding.path.isVariableDeclarator()) return null
            return evaluate(binding.path.get('init'), seen)
        }
        if (p.isBinaryExpression({ operator: '+' })) {
            const left = evaluate(p.get('left'), seen),
                right = evaluate(p.get('right'), seen)
            return left === null || right === null ? null : left + right
        }
        if (p.isTemplateLiteral()) {
            const values = p.get('expressions').map(value => evaluate(value, seen))
            if (values.some(value => value === null)) return null
            return p.node.quasis.map((part, index) => part.value.cooked + (values[index] || '')).join('')
        }
        if (p.isCallExpression()) {
            const callee = p.get('callee')
            if (!callee.isMemberExpression() || callee.node.computed) return null
            const object = callee.get('object'),
                method = callee.node.property.name
            if (object.isIdentifier({ name: 'process' }) && method === 'cwd') return root
            if (!object.isIdentifier({ name: 'path' }) || !['join', 'resolve', 'dirname'].includes(method)) return null
            const values = p.get('arguments').map(value => evaluate(value, seen))
            if (values.some(value => value === null)) return null
            if (method === 'resolve') return path.resolve(root, ...values)
            return path[method](...values)
        }
        return null
    }
    try {
        const ast = parser.parse(source, {
            sourceType: 'unambiguous',
            plugins: ['jsx', 'typescript'],
        })
        traverse(ast, {
            CallExpression(p) {
                const callee = p.node.callee
                let method =
                    callee.type === 'Identifier'
                        ? callee.name
                        : callee.type === 'MemberExpression'
                          ? callee.computed
                              ? callee.property.value
                              : callee.property.name
                          : null
                if (callee.type === 'Identifier') {
                    const binding = p.scope.getBinding(callee.name)
                    if (binding?.path.isVariableDeclarator() && binding.path.node.id.type === 'ObjectPattern') {
                        const property = binding.path.node.id.properties.find(item => item.value?.name === callee.name)
                        method = property?.key?.name || method
                    }
                }
                if (callee.type === 'MemberExpression' && callee.computed && !method) {
                    affected = true
                    return
                }
                if (!['readFileSync', 'readdirSync', 'readFile', 'readdir'].includes(method)) return
                const value = evaluate(p.get('arguments.0'))
                if (value === null) {
                    affected = true
                    return
                }
                const target = path.resolve(root, value)
                const relative = path.relative(root, target)
                if (relative.startsWith('..') || path.isAbsolute(relative)) return
                if (
                    changed.some(
                        input =>
                            input === target ||
                            (['readdirSync', 'readdir'].includes(method) && input.startsWith(target + path.sep))
                    )
                )
                    affected = true
            },
        })
    } catch (_) {
        return true
    }
    return affected
}
module.exports = { sourceTestAffected }
