## Problem

`fetchAttachmentText` in `src/lib/legistar.server.ts` decides how to parse an attachment by checking `url.toLowerCase().endsWith(".docx" | ".pdf" | ".doc")`. McKinney's Legistar links are `View.ashx?M=F&ID=...&GUID=...` with no extension, so every attachment falls through to `return null` — including DOCX, PDF, and DOC.

## Fix

Replace URL-extension sniffing with response-driven detection inside `fetchAttachmentText`:

1. After `fetch(url)`, read:
   - `Content-Type` header (e.g. `application/pdf`, `application/vnd.openxmlformats-officedocument.wordprocessingml.document`, `application/msword`)
   - `Content-Disposition` filename (e.g. `filename="StaffReport.docx"`) as a secondary hint
2. Read the body once into `Uint8Array`, then check magic bytes:
   - `%PDF` (`0x25 50 44 46`) → PDF
   - `PK\x03\x04` (`0x50 4B 03 04`) → ZIP container. Confirm it's DOCX by checking the central directory for `word/document.xml` (we already `unzipSync` — just gate the docx branch on that entry existing instead of trusting the extension). If it's a ZIP but not DOCX (e.g. an `.xlsx`/`.zip`), return null.
   - `\xD0\xCF\x11\xE0` (CFB header) → legacy `.doc` (also covers `.xls`/`.ppt`; accept as `doc` since strings-extraction is format-agnostic and Gemini can still try)
3. Resolution order: magic bytes win, content-type is the tiebreaker, filename/extension is last resort. This keeps us correct when servers send `application/octet-stream`.
4. Keep the existing parsing branches (`pdf`, `docx`, `doc`) — only the detection step changes. Same `ExtractedAttachment` return shape.

## Files

- `src/lib/legistar.server.ts` — rewrite the detection block at the top of `fetchAttachmentText`; extract a small `detectKind(buf, headers, url)` helper for clarity.

## Out of scope

No changes to `agenda.functions.ts`, UI, or DB. After this lands, the existing "Re-read staff report" button will pick up DOCX attachments that previously returned null.
