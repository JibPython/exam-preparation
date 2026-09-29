<!-- BEGIN:nextjs-agent-rules -->

## Environment variables and secrets

Never read, open, search, print, modify, or otherwise access `.env` or any file containing real credentials or secrets.

Use `.env.example` when you need to determine which environment variables are available.

Never include secret values in source code, logs, tests, documentation, commits, or responses.

If a task requires access to a secret value, stop and ask me instead.
<!-- END:nextjs-agent-rules -->
