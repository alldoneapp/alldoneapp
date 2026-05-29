/**
 * Docker-free E2B template builder (Build System 2.0).
 *
 * Builds the sandbox image used by the execute_task_in_vm tool, with Node 20 +
 * the Claude Code CLI (and common deliverable tooling) baked in so sandboxes boot
 * ready instead of installing Claude Code on every run.
 *
 * Run with tsx (NOT raw node — e2b v2's bundle needs tsx's ESM/`node:` interop):
 *   cd functions/e2b-template
 *   npm install
 *   E2B_API_KEY=e2b_*** npm run build
 *
 * The build runs remotely on E2B's builders — no local Docker required.
 * On success it prints the template name/ID; set that as E2B_CLAUDE_TEMPLATE in the
 * functions environment so the worker uses it.
 */
import 'dotenv/config'
import { Template } from 'e2b'

const TEMPLATE_NAME = process.env.E2B_TEMPLATE_NAME || 'alldone-claude'

if (!process.env.E2B_API_KEY) {
    console.error('❌ E2B_API_KEY is required. Set it in functions/e2b-template/.env or the shell.')
    process.exit(1)
}

const template = Template()
    .fromImage('e2bdev/code-interpreter:latest')
    // Node 20 + Claude Code CLI
    .runCmd('curl -fsSL https://deb.nodesource.com/setup_20.x | bash -')
    .runCmd('apt-get install -y nodejs')
    .runCmd('npm install -g @anthropic-ai/claude-code')
    // Common tooling for the document / data task types
    .runCmd('apt-get update && apt-get install -y --no-install-recommends pandoc')
    .runCmd('pip3 install --no-cache-dir pandas openpyxl python-docx python-pptx || true')
    // Fail the build if the CLI didn't install
    .runCmd('claude --version')

console.log(`🏗️  Building E2B template "${TEMPLATE_NAME}" (Docker-free, remote build)…`)

const info = await Template.build(template, TEMPLATE_NAME, {
    cpuCount: 2,
    memoryMB: 1024,
    onBuildLogs: (entry: any) => console.log(entry?.message ?? entry),
})

console.log('\n✅ Built E2B template:', info)
console.log(`\nNext: set E2B_CLAUDE_TEMPLATE="${TEMPLATE_NAME}" in the functions environment.`)
