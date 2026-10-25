'use strict'
const fs = require('fs')

function validatePlan(plan, availableNames, head) {
    if (plan.version !== 1 || !['full', 'partial', 'none'].includes(plan.mode) || !Array.isArray(plan.names))
        throw new Error('Invalid Functions deployment plan')
    if (head && plan.head !== head) throw new Error('Functions deployment plan belongs to another commit')
    const available = new Set(availableNames)
    if (new Set(plan.names).size !== plan.names.length || plan.names.some(name => !available.has(name)))
        throw new Error('Functions deployment plan contains duplicate or unknown functions')
    if ((plan.mode === 'none') !== (plan.names.length === 0))
        throw new Error('Empty or inconsistent Functions selection')
    if (plan.mode === 'full' && plan.names.length !== available.size)
        throw new Error('Incomplete full Functions selection')
    return plan
}

function readPlan(file, availableNames, head) {
    if (!availableNames.length) throw new Error('No static Functions exports found')
    // Missing artifacts may cause extra work, never a false successful no-op.
    if (!fs.existsSync(file))
        return { version: 1, head, mode: 'full', names: availableNames, reason: 'Missing scope artifact' }
    return validatePlan(JSON.parse(fs.readFileSync(file, 'utf8')), availableNames, head)
}
module.exports = { readPlan, validatePlan }
