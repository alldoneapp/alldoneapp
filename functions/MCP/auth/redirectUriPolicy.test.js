'use strict'

// Security audit 2026-11 (NV-34): an MCP client registered with a javascript: redirect URI ran
// script on my.alldone.app after the victim signed in.

const fs = require('fs')
const path = require('path')
const { isAllowedOAuthRedirectUri } = require('./redirectUriPolicy')

describe('isAllowedOAuthRedirectUri', () => {
    test.each([
        'https://claude.ai/api/mcp/auth_callback',
        'https://chatgpt.com/connector_platform_oauth_redirect',
        'http://localhost:6274/oauth/callback',
        'http://127.0.0.1:33418/callback',
        'http://[::1]:8080/cb',
        'cursor://anysphere.cursor-retrieval/oauth/callback',
        'vscode://vscode.github-authentication/did-authenticate',
        'com.example.app:/oauth2redirect',
    ])('allows %s', uri => {
        expect(isAllowedOAuthRedirectUri(uri)).toBe(true)
    })

    test.each([
        'javascript://localhost/%0aalert(document.domain)//',
        'JAVASCRIPT://localhost/%0aalert(1)',
        'javascript:alert(1)',
        'data:text/html,<script>alert(1)</script>',
        'vbscript:msgbox(1)',
        'file:///etc/passwd',
        'blob:https://my.alldone.app/x',
        'http://evil.example/callback',
        'http://localhost.evil.example/cb',
        ' https://claude.ai/cb',
        'https://claude.ai/cb\n',
        'not a url',
        '',
        null,
    ])('refuses %p', uri => {
        expect(isAllowedOAuthRedirectUri(uri)).toBe(false)
    })
})

describe('the MCP server applies it', () => {
    const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8')

    test('at registration, at authorization (including old clients) and before the login redirect', () => {
        const server = read('mcpServerSimple.js')
        expect(server).toMatch(/requestedRedirectUris\.every\(isAllowedOAuthRedirectUri\)/)
        expect(server).toMatch(/if \(!isAllowedOAuthRedirectUri\(redirect_uri\)\) return false/)
        const oauth = read('auth/cloudOAuth.js')
        expect(oauth).toMatch(/if \(!isAllowedOAuthRedirectUri\(auth\.redirectUri\)\)/)
    })
})
