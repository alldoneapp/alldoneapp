import { setSharedData, setUsersInProject, storeLoggedUser } from '../redux/actions'

// storeLoggedUserProjects was removed from the action set. setSharedData is what
// fills loggedUserProjects and loggedUserProjectsMap now, and it takes a single
// project, so seeding a list means one action per project. Both helpers return
// actions rather than dispatching, so a caller can keep batching them together
// with whatever else it needs to set up.

export const seedProjects = (projects = []) =>
    projects.map((project, index) =>
        setSharedData(
            { id: `seeded-project-${index}`, ...project },
            project.usersData || [],
            project.workstreams || [],
            project.contacts || [],
            project.assistants || []
        )
    )

export const seedProjectUsers = (usersByProject = []) =>
    usersByProject.map((users, index) => setUsersInProject(`seeded-project-${index}`, users))

// Helpers all over the app read the logged user straight out of the store and
// assume the fields the login flow would have filled in - projectIds in
// particular is dereferenced without a guard.
export const seedLoggedUser = (loggedUser = {}) =>
    storeLoggedUser({
        uid: 'seeded-user',
        projectIds: [],
        realProjectIds: [],
        unlockedKeysByGuides: {},
        ...loggedUser,
    })
