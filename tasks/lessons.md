# lessons

- when the repo has a real frontend app, keep the app inside `frontend/` and leave the repo root as orchestration/docs/config only. don't let convenience turn the root into a fake app directory again.
- if a route should only exist for signed-in users, gate it explicitly at the route layer and preserve intent through auth. don't let anonymous fallthrough create fake "works sometimes" navigation.
- when cleaning up visuals during a merge, verify whether a weird-looking landing element is intentional product direction before deleting it. hero pieces like the `ascii` landing effect are allowed to be opinionated on purpose.
