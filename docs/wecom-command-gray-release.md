# WeCom Command Gray Release Checklist

Use feature switches and command permissions for rollback. Start with one bot, one chat, and one or two mapped users.

## Gray Scope

- Enable only selected `botId`.
- Grant context ACL to a small set of `wecomUserId` values.
- Keep admin commands enabled only for `admin` role and with confirmation required.
- Enable image generation only after model quota and timeout are configured.

## Verification

- `/help` shows only allowed commands.
- `/ctx list` exposes only authorized context names and ids.
- `/ctx use` clears the current chat session and the next normal message uses the new context.
- Unauthorized `/ctx use` does not clear existing session history.
- `/image` creates a task and returns task query commands.
- `/task result` returns controlled file links only to the owner or manager/admin.

## Rollback

- Disable context switching: set `contextSwitchEnabled=false`.
- Disable image generation: set `imageGenerationEnabled=false`.
- Disable admin commands: set `adminCommandsEnabled=false`.
- Leave existing data in place; static bindings and normal chat continue to work.

## Metrics To Watch

- Command success rate.
- Context switch success rate.
- Permission denied count.
- Generation task failure rate.
- Rate limit count.
- Average task duration and total model cost.
