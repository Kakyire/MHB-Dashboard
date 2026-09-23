export type CopyrightStatus = "public_domain" | "licensed" | "permission_granted";

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
}

export interface IngestedDraft {
  sourceId: string;
  sourceVersionId: string;
  chunkCount: number;
  reviewStatus: "draft";
}

export const initialSourceDraft: SourceDraft = {
  title: "",
  publisher: "Methodist Church Ghana",
  denomination: "Methodist Church Ghana",
  jurisdiction: "MCG",
  authorityLevel: 4,
  canonicalUrl: "",
  copyrightStatus: "permission_granted",
  versionLabel: "2026 edition",
  topic: "history",
  pageReference: "",
  content: "",
};
