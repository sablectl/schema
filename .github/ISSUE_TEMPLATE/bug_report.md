---
name: Bug report
about: Something Schema does that it should not, or does not do that it should
labels: bug
---

## What happened

A short description of the behaviour.

## What you expected

## How to reproduce

The command you ran, with any credentials removed:

```sh
schema ...
```

If the problem depends on the database structure, the smallest `CREATE TABLE`
that shows it is more useful than a description of the real one.

## Output

The output, with anything sensitive removed. Schema redacts passwords, but it
cannot know which table or column names you would rather not publish.

```text

```

## Versions

- Schema: `schema --version`
- Node.js: `node --version`
- PostgreSQL: `schema connect` reports the server version
- Operating system:
