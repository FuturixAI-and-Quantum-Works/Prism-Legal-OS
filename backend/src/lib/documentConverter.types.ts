export type DocumentConversionRequest =
  | Readonly<{ kind: "doc-to-pdf"; content: Buffer }>
  | Readonly<{ kind: "docx-to-pdf"; content: Buffer }>
  | Readonly<{ kind: "html-to-pdf"; html: string }>;

export type DocumentConversionKind = DocumentConversionRequest["kind"];
export type DocumentConverterAdapterKind = "libreoffice" | "chromium";

export type DocumentConverterCapabilities = Readonly<{
  conversions: readonly DocumentConversionKind[];
  maxInputBytes: number;
  maxOutputBytes: number;
  adapters: readonly Readonly<{
    kind: DocumentConverterAdapterKind;
    conversions: readonly DocumentConversionKind[];
    concurrency: number;
    maxQueued: number;
  }>[];
}>;

export type DocumentConverterHealth = Readonly<{
  status: "healthy" | "degraded" | "unhealthy" | "closing" | "closed";
  active: number;
  queued: number;
  adapters: readonly Readonly<{
    kind: DocumentConverterAdapterKind;
    status: "healthy" | "unhealthy" | "closing" | "closed";
    active: number;
    queued: number;
    detail?: string;
  }>[];
  capabilities: DocumentConverterCapabilities;
}>;

export type DocumentConverter = Readonly<{
  capabilities: DocumentConverterCapabilities;
  convert: (request: DocumentConversionRequest, signal: AbortSignal) => Promise<Buffer>;
  health: () => Promise<DocumentConverterHealth>;
  close: () => Promise<void>;
}>;

export type DocumentConverterConfig = Readonly<{
  libreOfficePath: string;
  maxInputBytes: number;
  maxOutputBytes: number;
  timeoutMs: number;
  concurrency: number;
  maxQueuedPerAdapter: number;
}>;

export type LibreOfficeRunInput = Readonly<{
  executable: string;
  inputPath: string;
  outputDirectory: string;
  profileDirectory: string;
  signal: AbortSignal;
}>;

export type ChromiumRequest = Readonly<{
  url: () => string;
  abort: () => Promise<void>;
  continue: () => Promise<void>;
}>;

export type ChromiumPage = Readonly<{
  setJavaScriptEnabled: (enabled: boolean) => Promise<void>;
  setRequestInterception: (enabled: boolean) => Promise<void>;
  onRequest: (handler: (request: ChromiumRequest) => void) => void;
  setContent: (html: string) => Promise<void>;
  pdf: () => Promise<Uint8Array>;
}>;

export type ChromiumBrowser = Readonly<{
  newPage: () => Promise<ChromiumPage>;
  close: () => Promise<void>;
}>;

export type ChromiumLaunchInput = Readonly<{
  userDataDirectory: string;
  signal: AbortSignal;
}>;

export type DocumentConverterDependencies = Readonly<{
  runLibreOffice: (input: LibreOfficeRunInput) => Promise<void>;
  launchChromium: (input: ChromiumLaunchInput) => Promise<ChromiumBrowser>;
  probeLibreOffice?: (executable: string, signal: AbortSignal) => Promise<void>;
  probeChromium?: (signal: AbortSignal) => Promise<void>;
  temporaryRoot?: string;
}>;
