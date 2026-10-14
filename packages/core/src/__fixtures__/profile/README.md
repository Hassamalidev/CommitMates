# Profile fixtures

Responses in the shape GitHub documents for the GraphQL `repositoryOwner` query, the public
events API and the repository contents API. They describe an invented account,
`fixture-user-1`, and contain no real person's data.

They were written by hand, not recorded: recording needs `GITHUB_SERVER_TOKEN`, which did
not exist when these tests were written (docs/HUMAN_TODO.md). Re-record them with
`pnpm fixtures:record` once a token is available, and keep the sanitized logins.
