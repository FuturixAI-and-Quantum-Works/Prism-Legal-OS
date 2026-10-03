import { getAppConfig } from "../../config.js";
import { verifyDownload } from "../../lib/downloadTokens.js";
import { downloadFile } from "../../lib/storage.js";
import { buildContentDisposition } from "../../storage/contentDisposition.js";
import { verifyLocalRead } from "../../storage/localSignedRead.js";
import { accessAuthority } from "../access/access.composition.js";
import { createProductionDriveAccess } from "../drive/drive.access.js";
import { DownloadsAuthorizationPolicy } from "./downloads.policy.js";
import { DrizzleDownloadsRepository } from "./downloads.repository.js";
import { createDownloadsRouter } from "./downloads.routes.js";
import { DownloadsService } from "./downloads.service.js";

const repository = new DrizzleDownloadsRepository();
const drive = createProductionDriveAccess();
const policy = new DownloadsAuthorizationPolicy(
  repository,
  {
    async canReadDocument(document, actor) {
      return (
        await accessAuthority.decide({
          actor,
          resource: { kind: "document", id: document.id },
          action: "read_document",
        })
      ).allowed;
    },
  },
  drive.filePolicy,
);
const service = new DownloadsService(policy, {
  verifyDownloadToken: verifyDownload,
  verifyLocalToken(token) {
    const signed = verifyLocalRead(token, getAppConfig().secrets.downloadSigning);
    return signed
      ? {
          path: signed.ref,
          filename: signed.filename,
          disposition: signed.disposition,
        }
      : null;
  },
  read: downloadFile,
});

export const downloadsRouter = createDownloadsRouter(service, buildContentDisposition);
