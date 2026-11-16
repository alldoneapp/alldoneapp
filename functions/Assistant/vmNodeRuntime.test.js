const fs = require('fs')
const os = require('os')
const path = require('path')
const crypto = require('crypto')
const { execFileSync, spawnSync } = require('child_process')
const { VM_NODE_VERSION, buildVmNodeRuntimeCommand, ensureVmNodeRuntime } = require('./vmNodeRuntime')

describe('VM Node runtime bootstrap', () => {
    let testDir
    let prefix
    let userHome
    let toolDir
    let archive
    let downloads

    const writeTool = (file, script) => {
        fs.mkdirSync(path.dirname(file), { recursive: true })
        fs.writeFileSync(file, `#!/usr/bin/env bash\nset -e\n${script}\n`, { mode: 0o755 })
    }

    function runBootstrap(overrides = {}) {
        return spawnSync('bash', ['--noprofile', '--norc', '-c', buildVmNodeRuntimeCommand({ prefix, userHome })], {
            encoding: 'utf8',
            env: {
                ...process.env,
                PATH: `${toolDir}:/usr/bin:/bin:/usr/sbin:/sbin`,
                FIXTURE_ARCHIVE: archive,
                DOWNLOAD_LOG: downloads,
                ...overrides,
            },
        })
    }

    beforeEach(() => {
        // Include a quote and a space to exercise the remote shell quoting too.
        testDir = fs.mkdtempSync(path.join(os.tmpdir(), "vm-node's runtime-"))
        prefix = path.join(testDir, 'prefix')
        userHome = path.join(testDir, 'home')
        toolDir = path.join(testDir, 'tools')
        archive = path.join(testDir, 'node.tar.gz')
        downloads = path.join(testDir, 'downloads.log')
        fs.mkdirSync(userHome)
        const runtime = path.join(testDir, 'distribution')
        writeTool(path.join(runtime, 'bin/node'), `printf 'v${VM_NODE_VERSION}\\n'`)
        writeTool(path.join(runtime, 'bin/npm'), 'node --version >/dev/null\nprintf "10.9.4\\n"')
        writeTool(path.join(runtime, 'bin/npx'), 'exit 0')
        execFileSync('tar', ['-czf', archive, '-C', testDir, 'distribution'])
        // Only flock is unavailable on macOS. The rest of the install, archive
        // extraction, checksum verification and executable selection are real.
        writeTool(path.join(toolDir, 'flock'), 'exit 0')
        writeTool(path.join(toolDir, 'uname'), 'printf "x86_64\\n"')
        writeTool(path.join(toolDir, 'node'), 'printf "v22.23.4\\n"')
        writeTool(
            path.join(toolDir, 'curl'),
            `printf '%s\\n' "$*" >> "$DOWNLOAD_LOG"
if [ "\${DOWNLOAD_FAIL:-0}" = 1 ]; then exit 22; fi
while [ "$#" -gt 0 ]; do
    case "$1" in
        https://*) url="$1" ;;
        -o) shift; output="$1" ;;
    esac
    shift
done
if [[ "$url" == */SHASUMS256.txt ]]; then
    printf '%s  node-v${VM_NODE_VERSION}-linux-x64.tar.gz\\n' "$FIXTURE_CHECKSUM" > "$output"
else
    cp "$FIXTURE_ARCHIVE" "$output"
fi`
        )
        process.env.FIXTURE_CHECKSUM = crypto.createHash('sha256').update(fs.readFileSync(archive)).digest('hex')
    })

    afterEach(() => {
        delete process.env.FIXTURE_CHECKSUM
        fs.rmSync(testDir, { recursive: true, force: true })
    })

    test('keeps the deployed VM pin aligned with the repository', () => {
        expect(VM_NODE_VERSION).toBe(fs.readFileSync(path.join(__dirname, '../../.nvmrc'), 'utf8').trim())
    })

    test('replaces the old template runtime, including in a new login shell', () => {
        fs.writeFileSync(path.join(userHome, '.bash_profile'), `export PATH="${toolDir}:$PATH"\n`)
        const result = runBootstrap()
        expect(result.stderr).toBe('')
        expect(result.status).toBe(0)
        expect(result.stdout).toContain(`VM_NODE_READY v${VM_NODE_VERSION}`)
        const login = spawnSync(
            'bash',
            ['--noprofile', '--norc', '-c', '. "$1/.bash_profile"; node --version', '--', userHome],
            {
                encoding: 'utf8',
                env: { ...process.env, PATH: '/usr/bin:/bin' },
            }
        )
        expect(login.status).toBe(0)
        expect(login.stdout.trim()).toBe(`v${VM_NODE_VERSION}`)
        expect(fs.readFileSync(downloads, 'utf8')).toContain(`https://nodejs.org/dist/v${VM_NODE_VERSION}/`)
    })

    test('reuses the verified runtime offline and repairs PATH links on resume', () => {
        expect(runBootstrap().status).toBe(0)
        fs.unlinkSync(path.join(prefix, 'bin/node'))
        const result = runBootstrap({ DOWNLOAD_FAIL: '1' })
        expect(result.status).toBe(0)
        expect(result.stdout).toContain(`VM_NODE_READY v${VM_NODE_VERSION}`)
        expect(result.stdout).not.toContain('VM_NODE_INSTALLING')
        expect(fs.readFileSync(downloads, 'utf8').trim().split('\n')).toHaveLength(2)
        const profile = fs.readFileSync(path.join(userHome, '.profile'), 'utf8')
        expect(profile.split('export PATH=')).toHaveLength(2)
    })

    test.each(['checksum', 'download'])(
        "fails closed on a %s failure instead of using the template's Node",
        failure => {
            const result = runBootstrap(
                failure === 'checksum' ? { FIXTURE_CHECKSUM: '0'.repeat(64) } : { DOWNLOAD_FAIL: '1' }
            )
            expect(result.status).not.toBe(0)
            expect(result.stdout).not.toContain('VM_NODE_READY')
            expect(fs.existsSync(path.join(prefix, 'bin/node'))).toBe(false)
            expect(fs.readdirSync(path.join(prefix, 'share/alldone-node'))).toEqual(['install.lock'])
        }
    )

    test('checks the runtime on every invocation and propagates bootstrap failure', async () => {
        const run = jest.fn(async () => ({}))
        const sandbox = { commands: { run } }
        await ensureVmNodeRuntime(sandbox)
        await ensureVmNodeRuntime(sandbox)
        expect(run).toHaveBeenCalledTimes(2)
        expect(run).toHaveBeenCalledWith(buildVmNodeRuntimeCommand(), { timeoutMs: 5 * 60 * 1000 })
        run.mockRejectedValueOnce(new Error('download failed'))
        await expect(ensureVmNodeRuntime(sandbox)).rejects.toThrow('download failed')
    })
})
