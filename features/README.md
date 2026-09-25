# Prism features

[Back to Prism](../README.md)

Draft, review, and approve legal documents in one AI-powered workspace. These guides explain what each feature helps you do, how to use it, and what your deployment needs.

| Feature                                                                  | Start here when you want to…                                                    |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| [AI-powered drafting and document assistance](ai-drafting/README.md)     | Create a draft with Luna or ask questions grounded in your documents.           |
| [61 contract and legal-document templates](contract-templates/README.md) | Begin with a reusable Word or HTML form and guided fields.                      |
| [AI-assisted contract review](contract-review/README.md)                 | Check a document against your review criteria and investigate potential issues. |
| [Multi-document tabular review](tabular-review/README.md)                | Extract and compare key terms across a collection of documents.                 |
| [Custom review playbooks](review-playbooks/README.md)                    | Build reusable rulebooks for consistent reviews.                                |
| [Document editing and version history](document-editor/README.md)        | Edit a draft, save a version, or export a Word or PDF file.                     |
| [Collaborative review and approvals](review-and-approvals/README.md)     | Discuss changes, resolve comments, and move a draft through approval.           |
| [Shared legal workspaces](workspaces/README.md)                          | Keep primary documents, supporting material, and collaborators together.        |

## A typical workflow

1. Create a workspace and add the documents your team needs.
2. Start from a template or describe a draft to Luna. Use document assistance to explore supporting material.
3. Apply a review playbook to a contract, or extract terms across several documents in a tabular review.
4. Edit the draft, save a version, and work through comments with your collaborators.
5. Send the draft for approval and export the document when it is ready.

These are connected capabilities, not an automatic legal decision-making process. Review the output, confirm the facts, and obtain qualified legal advice for the intended use.

## Set up the capabilities you need

- Follow the [quick start](../README.md#quick-start) to run Prism.
- Configure an [AI provider](../docs/providers.md) for drafting, document assistance, and AI analysis.
- Set `OPENAI_API_KEY` for indexed source search. Compose runs Qdrant for you. Basic uploads do not require it.
- Run the worker for compliance analysis, tabular generation, indexing, and email delivery.
- Use the [template catalog](../docs/template-catalog.md) for the bundled inventory, seeding, and licensed DOCX imports.

For production setup and service requirements, see [deployment operations](../docs/deployment.md).
