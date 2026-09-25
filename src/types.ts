export type CopyrightStatus = "public_domain" | "licensed" | "permission_granted" | "unknown";

export interface SourceDraft {
  title: string;
  publisher: string;
  denomination: string;
  jurisdiction: string;
  authorityLevel: number;
  canonicalUrl: string;
  copyrightStatus: CopyrightStatus;
  versionLabel: string;
  topic: string;
  pageReference: string;
  content: string;
  originalStoragePath?: string;
  originalFileName?: string;
  importKind?: "pdf" | "web";
  importSectionIndex?: number;
  importSectionCount?: number;
  importTotalCharacters?: number;
}

export interface IngestedDraft {
  sourceId: string;
  sourceVersionId: string;
  chunkCount: number;
  reviewStatus: "draft";
}

/** Metadata that may be shown to source administrators after publication. */
export interface PublishedSource {
  sourceId: string;
  sourceVersionId: string;
  title: string;
  authorityLevel: number;
  publisher?: string;
  versionLabel?: string;
  topic?: string;
  jurisdiction?: string;
  pageReference?: string;
  canonicalUrl?: string;
  publishedAt?: string;
}

export const initialSourceDraft: SourceDraft = {
  title: "",
  publisher: "",
  denomination: "Methodist Church Ghana",
  jurisdiction: "MCG",
  authorityLevel: 4,
  canonicalUrl: "",
  copyrightStatus: "unknown",
  versionLabel: "",
  topic: "",
  pageReference: "",
  content: "",
  originalStoragePath: undefined,
  originalFileName: undefined,
  importKind: undefined,
  importSectionIndex: undefined,
  importSectionCount: undefined,
  importTotalCharacters: undefined,
};
