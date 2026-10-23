/** @jest-environment node */

const fs = require('fs')
const path = require('path')
const vm = require('vm')

const source = fs.readFileSync(path.join(__dirname, '../../ci/check-runtime.js'), 'utf8')

function runGuard(version, args = [], javaVersion = 'openjdk version "17.0.12"') {
    const errors = []
    const result = { exports: {} }
    let exitCode = null
    try {
        vm.runInNewContext(source, {
            require: () => ({ spawnSync: () => ({ stderr: javaVersion }) }),
            process: {
                versions: { node: version },
                argv: ['node', 'check-runtime.js', ...args],
                platform: 'linux',
                exit: code => {
                    exitCode = code
                    throw new Error('runtime rejected')
                },
            },
            console: { error: message => errors.push(message), log: () => {} },
            module: result,
        })
    } catch (error) {
        if (exitCode === null) throw error
    }
    return { exitCode, errors: errors.join('\n') }
}

test.each(['20.20.2', '22.22.1', '22.23.2', '22.23.3', '24.22.1', 'invalid'])(
    'rejects unsupported or unpatched Node %s before running repository commands',
    version => {
        expect(runGuard(version)).toMatchObject({ exitCode: 1 })
        expect(runGuard(version).errors).toContain('22.23.4 or newer within Node 22')
    }
)

test.each(['22.23.4', '22.23.5', '22.24.0'])(
    'allows the patched Node 22 release and later security updates: %s',
    version => {
        expect(runGuard(version).exitCode).toBeNull()
    }
)

test('the security floor preserves the Java guard used by Firestore emulators', () => {
    expect(runGuard('22.23.4', ['--java']).exitCode).toBeNull()
    expect(runGuard('22.23.4', ['--java'], 'java version "1.8.0_402"')).toMatchObject({ exitCode: 1 })
    expect(runGuard('22.23.4', ['--java'], 'java version "1.8.0_402"').errors).toContain('Java 11+')
})
