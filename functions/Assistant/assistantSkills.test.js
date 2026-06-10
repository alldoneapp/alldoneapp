const {
    isValidSkillName,
    isVmOnlySkill,
    buildSkillMarkdown,
    buildSkillsIndexBlock,
    getSandboxSkillsDir,
} = require('./assistantSkills')
const { parseRepoUrl, parseSkillFrontmatter } = require('./assistantSkillsImport')

describe('isValidSkillName', () => {
    it('accepts spec-compliant slugs', () => {
        expect(isValidSkillName('frontend-design')).toBe(true)
        expect(isValidSkillName('pdf')).toBe(true)
        expect(isValidSkillName('skill2-v3')).toBe(true)
    })

    it('rejects invalid slugs', () => {
        expect(isValidSkillName('')).toBe(false)
        expect(isValidSkillName('Frontend')).toBe(false)
        expect(isValidSkillName('-leading')).toBe(false)
        expect(isValidSkillName('trailing-')).toBe(false)
        expect(isValidSkillName('double--hyphen')).toBe(false)
        expect(isValidSkillName('has space')).toBe(false)
        expect(isValidSkillName('a'.repeat(65))).toBe(false)
        expect(isValidSkillName(null)).toBe(false)
    })
})

describe('isVmOnlySkill', () => {
    it('is true only when bundled files exist', () => {
        expect(isVmOnlySkill({ files: [{ relativePath: 'scripts/x.py' }] })).toBe(true)
        expect(isVmOnlySkill({ files: [] })).toBe(false)
        expect(isVmOnlySkill({})).toBe(false)
        expect(isVmOnlySkill(null)).toBe(false)
    })
})

describe('buildSkillMarkdown', () => {
    it('produces frontmatter plus body', () => {
        const markdown = buildSkillMarkdown({
            name: 'my-skill',
            description: 'Does things: with "quotes"',
            body: '# Heading\n\nInstructions.',
        })
        expect(markdown.startsWith('---\nname: my-skill\n')).toBe(true)
        expect(markdown).toContain('description: "Does things: with \\"quotes\\""')
        expect(markdown.endsWith('# Heading\n\nInstructions.')).toBe(true)
    })
})

describe('buildSkillsIndexBlock', () => {
    it('lists one line per skill and instructs to call load_skill', () => {
        const block = buildSkillsIndexBlock([
            { name: 'a-skill', description: 'When doing A' },
            { name: 'b-skill', description: 'When doing B' },
        ])
        expect(block).toContain('- a-skill: When doing A')
        expect(block).toContain('- b-skill: When doing B')
        expect(block).toContain('load_skill')
    })
})

describe('getSandboxSkillsDir', () => {
    it('maps agents to their native discovery dirs', () => {
        expect(getSandboxSkillsDir('claude')).toBe('/home/user/.claude/skills')
        expect(getSandboxSkillsDir('codex')).toBe('/home/user/.agents/skills')
        expect(getSandboxSkillsDir(undefined)).toBe('/home/user/.claude/skills')
    })
})

describe('parseRepoUrl', () => {
    it('parses owner/repo shorthand and github URLs', () => {
        expect(parseRepoUrl('anthropics/skills')).toEqual({ owner: 'anthropics', repo: 'skills' })
        expect(parseRepoUrl('https://github.com/anthropics/skills')).toEqual({
            owner: 'anthropics',
            repo: 'skills',
        })
        expect(parseRepoUrl('https://github.com/openai/skills.git')).toEqual({ owner: 'openai', repo: 'skills' })
        expect(parseRepoUrl('https://github.com/owner/repo/tree/main/sub')).toEqual({ owner: 'owner', repo: 'repo' })
    })

    it('rejects non-github inputs', () => {
        expect(parseRepoUrl('https://gitlab.com/owner/repo')).toBe(null)
        expect(parseRepoUrl('not a repo')).toBe(null)
        expect(parseRepoUrl(undefined)).toBe(null)
    })
})

describe('parseSkillFrontmatter', () => {
    it('parses name and description and returns the body', () => {
        const { frontmatter, body } = parseSkillFrontmatter(
            '---\nname: my-skill\ndescription: Use when testing\nlicense: MIT\n---\n\n# Body here\n'
        )
        expect(frontmatter.name).toBe('my-skill')
        expect(frontmatter.description).toBe('Use when testing')
        expect(body).toBe('\n# Body here\n')
    })

    it('strips surrounding quotes and joins folded continuation lines', () => {
        const { frontmatter } = parseSkillFrontmatter(
            '---\nname: quoted\ndescription: "A long description\n  that continues indented"\n---\nBody'
        )
        expect(frontmatter.name).toBe('quoted')
        expect(frontmatter.description).toContain('A long description')
        expect(frontmatter.description).toContain('that continues indented')
    })

    it('returns null frontmatter when none exists', () => {
        const { frontmatter, body } = parseSkillFrontmatter('# Just markdown')
        expect(frontmatter).toBe(null)
        expect(body).toBe('# Just markdown')
    })
})
