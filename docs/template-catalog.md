# Template packs and licensing

Prism ships **61 templates: seven HTML templates and 54 DOCX templates**. This catalog counts bundled templates, not distinct contract types or jurisdiction-specific variants. Additional operator imports are not included.

> Templates are starting material only. They have not been certified for any transaction or jurisdiction. A qualified lawyer must review the selected form, facts, execution requirements, filing requirements, and current law.

## Bundled HTML templates

[`backend/data/seed-packs/templates/v1/core-neutral/pack.json`](../backend/data/seed-packs/templates/v1/core-neutral/pack.json) declares these seven templates:

- Mutual NDA Agreement.
- Employment Contract.
- Service Level Agreement.
- Privacy Policy Template.
- Partnership Agreement.
- Commercial Lease.
- Consulting Agreement.

Each form offers a governing-law choice from Delaware, New York, California, Texas, England and Wales, Singapore, and Hong Kong. This choice does not localize the rest of the form or establish compliance with the selected law.

## Bundled DOCX templates

The 54 DOCX templates cover property and leasing, corporate resolutions, founder and equity arrangements, intellectual property, legal notices, and arbitration. They are owned by FuturixAI-and-Quantum-Works and licensed under AGPL-3.0-only.

The [permission record](template-license.md) documents the owner's September 14, 2026 authorization. The [provenance manifest](template-provenance.json) records a pinned source URL and SHA-256 checksum for every file. The imported packages are unchanged, and three byte-identical sample copies were excluded.

The following groupings describe the inventory. In the application, all 54 imported DOCX templates use the **FuturixAI Legal Templates** category.

### Property, leasing, and powers of attorney (20)

- `backend/data/seed-packs/docx/v1/futurixai-legal/01_Rent_Agreement_Template.docx`
- `backend/data/seed-packs/docx/v1/futurixai-legal/02_Residential_Lease_Deed_Template.docx`
- `backend/data/seed-packs/docx/v1/futurixai-legal/03_Commercial_Lease_Deed_Template.docx`
- `backend/data/seed-packs/docx/v1/futurixai-legal/04_Lease_Extension_Agreement_Template.docx`
- `backend/data/seed-packs/docx/v1/futurixai-legal/05_Lease_Renewal_Agreement_Template.docx`
- `backend/data/seed-packs/docx/v1/futurixai-legal/06_Lease_Termination_Notice_Template.docx`
- `backend/data/seed-packs/docx/v1/futurixai-legal/07_Sale_Agreement_Template.docx`
- `backend/data/seed-packs/docx/v1/futurixai-legal/08_Agreement_to_Sell_Template.docx`
- `backend/data/seed-packs/docx/v1/futurixai-legal/09_Sale_Deed_Template.docx`
- `backend/data/seed-packs/docx/v1/futurixai-legal/10_Gift_Deed_Template.docx`
- `backend/data/seed-packs/docx/v1/futurixai-legal/11_Release_Deed_Template.docx`
- `backend/data/seed-packs/docx/v1/futurixai-legal/12_Relinquishment_Deed_Template.docx`
- `backend/data/seed-packs/docx/v1/futurixai-legal/13_Partition_Deed_Template.docx`
- `backend/data/seed-packs/docx/v1/futurixai-legal/14_Family_Settlement_Deed_Template.docx`
- `backend/data/seed-packs/docx/v1/futurixai-legal/15_Mortgage_Deed_Template.docx`
- `backend/data/seed-packs/docx/v1/futurixai-legal/16_Simple_Mortgage_Agreement_Template.docx`
- `backend/data/seed-packs/docx/v1/futurixai-legal/17_Equitable_Mortgage_Declaration_Template.docx`
- `backend/data/seed-packs/docx/v1/futurixai-legal/18_Power_of_Attorney_for_Property_Template.docx`
- `backend/data/seed-packs/docx/v1/futurixai-legal/19_Special_POA_for_Sale_of_Property_Template.docx`
- `backend/data/seed-packs/docx/v1/futurixai-legal/20_General_POA_for_Property_Management_Template.docx`

### Corporate resolutions and meeting notices (5)

- `backend/data/seed-packs/docx/v1/futurixai-legal/21_Board_Meeting_Notice_Template.docx`
- `backend/data/seed-packs/docx/v1/futurixai-legal/22_Board_Resolution_Template.docx`
- `backend/data/seed-packs/docx/v1/futurixai-legal/23_Ordinary_Resolution_Template.docx`
- `backend/data/seed-packs/docx/v1/futurixai-legal/24_Special_Resolution_Template.docx`
- `backend/data/seed-packs/docx/v1/futurixai-legal/25_Shareholder_Resolution_Sheet_Template.docx`

### Founders, equity, ESOP, and intellectual property (14)

- `backend/data/seed-packs/docx/v1/futurixai-legal/Drag_Along_Agreement_Template.docx`
- `backend/data/seed-packs/docx/v1/futurixai-legal/ESOP_Exercise_Notice_Template.docx`
- `backend/data/seed-packs/docx/v1/futurixai-legal/ESOP_Grant_Letter_Template.docx`
- `backend/data/seed-packs/docx/v1/futurixai-legal/ESOP_Policy_Template.docx`
- `backend/data/seed-packs/docx/v1/futurixai-legal/Equity_Split_Agreement_Template.docx`
- `backend/data/seed-packs/docx/v1/futurixai-legal/Founder_Agreement_Template.docx`
- `backend/data/seed-packs/docx/v1/futurixai-legal/Founders_IP_Assignment_Template.docx`
- `backend/data/seed-packs/docx/v1/futurixai-legal/Investor_Rights_Agreement_Template.docx`
- `backend/data/seed-packs/docx/v1/futurixai-legal/ROFO_Agreement_Template.docx`
- `backend/data/seed-packs/docx/v1/futurixai-legal/ROFR_Agreement_Template.docx`
- `backend/data/seed-packs/docx/v1/futurixai-legal/Share_Subscription_Agreement_Template.docx`
- `backend/data/seed-packs/docx/v1/futurixai-legal/Sweat_Equity_Agreement_Template.docx`
- `backend/data/seed-packs/docx/v1/futurixai-legal/Tag_Along_Agreement_Template.docx`
- `backend/data/seed-packs/docx/v1/futurixai-legal/Technology_Assignment_Agreement_Template.docx`

### Legal notices and arbitration (15)

- `backend/data/seed-packs/docx/v1/futurixai-legal/Legal_Notice_Breach_of_Contract_Template.docx`
- `backend/data/seed-packs/docx/v1/futurixai-legal/Legal_Notice_Cheque_Bounce_Sec138_NI_Act_Template.docx`
- `backend/data/seed-packs/docx/v1/futurixai-legal/Legal_Notice_Copyright_Infringement_Template.docx`
- `backend/data/seed-packs/docx/v1/futurixai-legal/Legal_Notice_Defamation_Template.docx`
- `backend/data/seed-packs/docx/v1/futurixai-legal/Legal_Notice_Non_Payment_of_Rent_Template.docx`
- `backend/data/seed-packs/docx/v1/futurixai-legal/Legal_Notice_Payment_Recovery_Template.docx`
- `backend/data/seed-packs/docx/v1/futurixai-legal/Legal_Notice_Recovery_of_Loan_Template.docx`
- `backend/data/seed-packs/docx/v1/futurixai-legal/Legal_Notice_Termination_of_Services_Template.docx`
- `backend/data/seed-packs/docx/v1/futurixai-legal/Legal_Notice_Trademark_Infringement_Template.docx`
- `backend/data/seed-packs/docx/v1/futurixai-legal/Legal_Notice_for_Refund_Template.docx`
- `backend/data/seed-packs/docx/v1/futurixai-legal/Legal_Notice_to_Employee_Template.docx`
- `backend/data/seed-packs/docx/v1/futurixai-legal/Legal_Notice_to_Employer_Template.docx`
- `backend/data/seed-packs/docx/v1/futurixai-legal/Notice_Invoking_Arbitration_Sec21_AC_Act_Template.docx`
- `backend/data/seed-packs/docx/v1/futurixai-legal/Notice_for_Termination_of_Contract_Template.docx`
- `backend/data/seed-packs/docx/v1/futurixai-legal/Public_Notice_Format_Template.docx`

## Seed all 61 bundled templates

The setup step seeds both packs automatically. The Compose backend and the Render pre-deploy command run it, and host development runs it through `npm run setup --workspace @prism/backend`. See [Develop Prism on the host](../README.md#develop-prism-on-the-host).

To rerun only the template seeds, apply the migrations and configure document storage first. Run both template seeds from the repository root:

```sh
npm run seed:templates --workspace @prism/backend
npm run seed:bundled-docx --workspace @prism/backend
```

The first command seeds the seven HTML templates. The second validates and seeds all 54 bundled DOCX templates, including their previews, placeholder fields, and source packages.

The seeds use separate stable keys. Rerunning them updates the same system-template records without creating duplicates; it can overwrite local changes to those bundled records. Templates imported through the operator command use a separate key namespace.

The DOCX seed needs enabled document storage for the library's document-creation workflow. Use local storage in development or an S3-compatible object store in production. A storage-disabled import does not make source packages available to all template workflows. The [deployment guide](deployment.md#tutorial-deploy-the-render-blueprint) covers hosted deployments.

Validate the bundled inputs without writing database rows or uploading objects:

```sh
npm run seed:templates --workspace @prism/backend -- --dry-run
npm run seed:bundled-docx --workspace @prism/backend -- --dry-run
```

`npm run seed:validate` includes both validations. These checks verify that the inputs can be parsed; they do not certify the legal text.

## Import operator-owned DOCX templates

You can extend a deployment with templates that you own or have permission to use. Keep these files outside the retired `backend/Templates` and `backend/sampleTemplates` directories, and do not commit them unless the repository provenance policy covers them.

1. Confirm the rights required for the intended use, including redistribution if you will publish the files.
2. Put the files in a dedicated operator directory and configure working document storage.
3. Validate the directory before writing database rows.

   ```sh
   npm run seed:docx-templates --workspace @prism/backend -- --dry-run /absolute/path/to/licensed-docx
   ```

4. Seed the validated directory.

   ```sh
   npm run seed:docx-templates --workspace @prism/backend -- /absolute/path/to/licensed-docx
   ```

The command requires the directory argument and imports every `.docx` file directly inside that directory under the **Operator DOCX Templates** category. It uploads the source packages to the configured document store. These operator imports do not change the published bundled count.

## Track a cleared DOCX template

Operator-owned DOCX files do not need to enter Git. If a publisher chooses to track one, add a complete entry to [`docs/template-provenance.json`](template-provenance.json). Each entry requires:

- `path`, the repository-relative DOCX path.
- `source`, the source citation.
- `author`, the named author or rights holder.
- `license`, the applicable license.
- `redistributionGrant`, the evidence that permits redistribution.
- `attribution`, the required attribution text or `None`.

The approved bundled pack also records each file's `sha256` checksum and links its grant to [`docs/template-license.md`](template-license.md). Its historical source citations are preserved as provenance, not application branding.

The publication check rejects tracked DOCX files without complete provenance. It still rejects every DOCX file in the retired directories, even when provenance metadata exists.

## Legal limits

A pack label helps operators organize content. A jurisdiction label describes the law that the text appears designed around. Neither label checks the facts, parties, capacity, formalities, tax, registration, filing, stamping, local amendments, or later changes in law.

Seeding proves only that Prism can parse and store a template. It is not a legal review.
