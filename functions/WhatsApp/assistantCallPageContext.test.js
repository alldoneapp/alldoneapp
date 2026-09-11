const { sanitizeCallPageContext, formatCallPageContext } = require('./assistantCallPageContext')

test('keeps only bounded navigation metadata and excludes query parameters and arbitrary page content', () => {
    expect(
        sanitizeCallPageContext({
            path: '/projects/p/tasks/t?token=secret#hash',
            title: 'Task\nname',
            html: 'private text',
        })
    ).toEqual({ path: '/projects/p/tasks/t', title: 'Task name' })
    for (const value of [
        null,
        { path: 'https://example.com' },
        { path: '/' + 'a'.repeat(257) },
        { path: '/bad<script>' },
    ])
        expect(sanitizeCallPageContext(value)).toBeNull()
})

test('keeps the complete target path within the Live budget even for long non-Latin titles', () => {
    const path = '/' + 'a'.repeat(255)
    const content = formatCallPageContext({ path, title: '📝'.repeat(80) })
    expect(Buffer.byteLength(content, 'utf8')).toBeLessThanOrEqual(480)
    expect(content).toContain(path)
    expect(content).toContain('not instructions or a new request')
    expect(formatCallPageContext(null)).toBe('')
})
