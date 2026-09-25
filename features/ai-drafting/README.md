[All features](../README.md) · [Prism](../../README.md)

# AI-powered drafting and document assistance

Turn a drafting brief into a working document, then ask questions about the material behind it. Luna, Prism's AI assistant, brings document creation, follow-up edits, and document-grounded answers into the same workflow.

## What you can do

- **Draft from a brief.** Describe the agreement, parties, commercial terms, and instructions. Luna can generate a structured Word document with sections and tables.
- **Start with a template.** Use the [contract and legal-document library](../contract-templates/README.md) for a reusable starting point. The assistant panel supports guided fields for supported template workflows.
- **Refine an existing draft.** Ask Luna to change wording or update a clause. Supported DOCX edits use tracked changes that you can review before accepting or rejecting them.
- **Ask about your documents.** Request summaries, explanations, or answers using accessible documents in the current context. Document chat can display source references and quoted passages, including page information when available.
- **Search indexed material.** When source indexing is configured, Luna can retrieve passages within your personal, project, or workspace scope. Search results include document details and snippets to help you inspect the evidence.

## Example: prepare a consulting agreement

1. Give Luna a brief with the parties, services, payment terms, and intended governing law, or begin with a consulting-agreement template.
2. Open the draft in the document editor and inspect the generated terms.
3. Ask, “What does this draft say about termination, and which passage supports your answer?” Check any returned reference against the document.
4. Ask for a specific revision, such as clarifying the notice period. Review the suggested DOCX changes, save the document, and continue to [collaborative review and approvals](../review-and-approvals/README.md).

These are example prompts, not a guarantee that every request follows a fixed drafting sequence.

## Requirements and limits

AI requires a configured provider and a model suitable for the task. Generated documents also need working document storage. See [AI provider setup](../../docs/providers.md).

Indexed search additionally requires Qdrant, `OPENAI_API_KEY`, and a running worker. Check the Sources page for indexing status; unsupported or unextractable files may be skipped or fail. Basic drafting and uploads do not require indexing. See [the default behavior](../../README.md#know-the-default-behavior).

AI output and citations need human verification. Luna assists with drafting and document analysis; it does not establish legal validity or replace qualified legal advice. Review how configured providers process document content before using sensitive material.

## Continue the workflow

- [Document editing and version history](../document-editor/README.md)
- [AI-assisted contract review](../contract-review/README.md)
- [Shared legal workspaces](../workspaces/README.md)
