import { DEFAULT_POST_LOGIN_URL, resolveLoginBootstrap } from './loginBootstrap'

describe('resolveLoginBootstrap', () => {
    it.each(['/', '/login', '/login/callback'])(
        'keeps the normal login path off the anonymous project-preview read for %s',
        pathname => {
            expect(resolveLoginBootstrap(pathname, '?ignored=1')).toEqual({
                initialUrl: DEFAULT_POST_LOGIN_URL,
                shouldLoadProjectPreview: false,
            })
        }
    )

    it('preserves a shared-resource URL and enables its project preview', () => {
        expect(resolveLoginBootstrap('/projects/project-1/notes/note-1', '?share=1')).toEqual({
            initialUrl: '/projects/project-1/notes/note-1?share=1',
            shouldLoadProjectPreview: true,
        })
    })
})
