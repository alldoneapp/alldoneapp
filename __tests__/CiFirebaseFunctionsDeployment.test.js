'use strict'

const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')
const os = require('os')
const yaml = require('js-yaml')

const {
    assertCompletedDeployment,
    deployedFunctionNames,
    exportedFunctionNames,
    findMissingFunctions,
} = require('../ci/assertFirebaseFunctionsDeployed')

describe('Firebase Functions deployment verification', () => {
    const source = `
exports.moveTaskToProjectSecondGen = onCall({}, handler)
exports.runManualTaskProjectMove = onTaskDispatched({}, worker)
`

    it('accepts the JSON envelope emitted by firebase functions:list', () => {
        const payload = {
            status: 'success',
            result: [{ id: 'moveTaskToProjectSecondGen' }, { id: 'runManualTaskProjectMove' }],
        }

        expect(findMissingFunctions(source, payload)).toEqual([])
        expect([...deployedFunctionNames(payload)]).toEqual(['moveTaskToProjectSecondGen', 'runManualTaskProjectMove'])
    })

    it('fails closed when a partially successful deploy omitted the task worker', () => {
        const payload = { status: 'success', result: [{ id: 'moveTaskToProjectSecondGen' }] }

        expect(findMissingFunctions(source, payload)).toEqual(['runManualTaskProjectMove'])
    })

    it('recognizes every static export in the real Functions entry point', () => {
        const indexSource = fs.readFileSync(path.resolve(__dirname, '../functions/index.js'), 'utf8')
        const names = exportedFunctionNames(indexSource)

        expect(names).toContain('moveTaskToProjectSecondGen')
        expect(names).toContain('runManualTaskProjectMove')
        expect(new Set(names).size).toBe(names.length)
    })

    it('rejects an unexpected list payload instead of treating it as an empty success', () => {
        expect(() => deployedFunctionNames({ status: 'success' })).toThrow(
            'Firebase functions:list returned an unexpected payload'
        )
    })

    it('rejects the incident where the old voice worker still exists but never finished updating', () => {
        const voiceSource = 'exports.runWhatsAppRealtimeCall = onTaskDispatched({}, worker)'
        expect(findMissingFunctions(voiceSource, [{ id: 'runWhatsAppRealtimeCall' }])).toEqual([])
        expect(() =>
            assertCompletedDeployment(
                voiceSource,
                [
                    'i functions: updating Node.js 22 (2nd Gen) function runWhatsAppRealtimeCall(europe-west1)...',
                    'Quota Exceeded. Waiting to retry...',
                    'Deploy complete!',
                ].join('\n')
            )
        ).toThrow('No completed deployment result for: runWhatsAppRealtimeCall')
    })

    it('accepts completed updates, creations and hash-verified skips with CLI colors', () => {
        const log = [
            '\x1b[32mfunctions[moveTaskToProjectSecondGen(europe-west1)]\x1b[39m Successful update operation.',
            'functions[runManualTaskProjectMove(europe-west1)] Skipped (No changes detected)',
            'Deploy complete!',
        ].join('\n')
        expect(() => assertCompletedDeployment(source, log)).not.toThrow()
        expect(() => assertCompletedDeployment(source, log.replace('update', 'create'))).not.toThrow()
    })

    it('does not mistake a deletion or an unfinished deploy for successful delivery', () => {
        const log = [
            'functions[moveTaskToProjectSecondGen(europe-west1)] Successful update operation.',
            'functions[runManualTaskProjectMove(europe-west1)] Successful delete operation.',
            'Deploy complete!',
        ].join('\n')
        expect(() => assertCompletedDeployment(source, log)).toThrow('runManualTaskProjectMove')
        expect(() =>
            assertCompletedDeployment(source, log.replace('delete', 'update').replace('Deploy complete!', ''))
        ).toThrow('without confirming that the deploy completed')
    })

    it('accepts transient quota warnings only after every function eventually completes', () => {
        const log = [
            'Quota Exceeded. Waiting to retry...',
            'functions[moveTaskToProjectSecondGen(europe-west1)] Successful update operation.',
            'functions[runManualTaskProjectMove(europe-west1)] Successful update operation.',
            'Deploy complete!',
        ].join('\n')
        expect(() => assertCompletedDeployment(source, log)).not.toThrow()
    })

    it.each(['production', 'staging'])('preserves a failed Firebase exit through log capture in %s', environment => {
        const config = yaml.load(fs.readFileSync(path.resolve(__dirname, '../.gitlab-ci.yml'), 'utf8'))
        const job = config[`deploy:cloud:functions:${environment}`]
        const deploy = job.script.find(line => line.includes('firebase deploy'))
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'firebase-deploy-'))
        try {
            fs.writeFileSync(path.join(dir, 'firebase'), '#!/bin/sh\necho "failed deploy"\nexit 17\n', { mode: 0o755 })
            const run = spawnSync('bash', ['-c', deploy], {
                encoding: 'utf8',
                env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, CI_PROJECT_DIR: dir },
            })
            expect(run.status).toBe(17)
            expect(fs.readFileSync(path.join(dir, 'functions-deploy.log'), 'utf8')).toContain('failed deploy')
            const verification = job.script.findIndex(line => line.includes('assertFirebaseFunctionsDeployed.js'))
            expect(verification).toBeGreaterThan(job.script.indexOf(deploy))
            expect(job.script[verification]).toContain('$CI_PROJECT_DIR/functions-deploy.log')
            if (environment === 'production') {
                expect(job.script.findIndex(line => line.includes('deployScope.sh record'))).toBeGreaterThan(
                    verification
                )
            }
        } finally {
            fs.rmSync(dir, { recursive: true, force: true })
        }
    })

    it('reruns Functions deployment when the completion guard changes', () => {
        const patterns = fs
            .readFileSync(path.resolve(__dirname, '../ci/deploy-scope/functions-production.paths'), 'utf8')
            .split('\n')
            .map(line => line.replace(/#.*/, '').trim())
            .filter(Boolean)
        expect(patterns.some(pattern => new RegExp(pattern).test('ci/assertFirebaseFunctionsDeployed.js'))).toBe(true)
    })
})
