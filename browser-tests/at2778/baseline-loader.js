const { execFileSync } = require('node:child_process')
const path = require('node:path')
module.exports = function () {
    return execFileSync(
        'git',
        ['show', `ac1f17f11a87b6c2cb6e9dd1dc18ca5063c03b5b:${path.relative(this.rootContext, this.resourcePath)}`],
        { encoding: 'utf8' }
    )
}
