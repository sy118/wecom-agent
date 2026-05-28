# Generation Tasks Notes

The generation task layer is intentionally shared by image, PPT, document, spreadsheet, and archive work.

## Reusable Flow

1. A command or API creates a `generation_tasks` record with `task_type`, owner, chat metadata, input payload, and optional `preview_summary`.
2. The task runner picks up the task by type and calls a registered processor.
3. The processor writes one or more files through the generated file service.
4. File records receive short-lived access tokens and expiration timestamps.
5. Users retrieve status and results through `/task status <id>` and `/task result <id>`.
6. Audit logs record task success and failure.

## PPT Extension

A future PPT processor should reuse the same path:

- `task_type`: `ppt`
- `input_payload`: topic, outline, brand/style options, image references, and slide count
- `preview_summary`: title plus expected slide count
- output files: at least one `.pptx`, optionally preview images or a PDF export
- permissions: owner or manager/admin can query results
- delivery: controlled `/api/generated-files/<token>` links

This keeps PPT generation out of the normal chat path and avoids blocking per-chat message queues.
