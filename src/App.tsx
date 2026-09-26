import { useCallback, useEffect, useMemo, useState } from "react";
import { onAuthStateChanged, signInWithPopup, signOut, type User } from "firebase/auth";
import { httpsCallable } from "firebase/functions";
import { auth, firebaseConfigurationError, functions, googleProvider } from "./firebase";
import { initialSourceDraft, type CopyrightStatus, type IngestedDraft, type PublishedSource, type SourceDraft } from "./types";

type Screen = "library" | "new" | "review";
type RequestState = "idle" | "importing" | "creating" | "publishing" | "published";
type Theme = "light" | "dark";
type IngestSourceDraft = Pick<SourceDraft, "title" | "authorityLevel" | "content"> & {
  publisher?: string;
  denomination?: string;
  jurisdiction?: string;
  canonicalUrl?: string;
  copyrightStatus?: CopyrightStatus;
  versionLabel?: string;
  topic?: string;
  pageReference?: string;
  originalStoragePath?: string;
};
type SourceImportRequest =
  | { kind: "pdf"; fileName: string; base64: string; sectionIndex?: number }
  | { kind: "url"; url: string; sectionIndex?: number };
type ImportedSource = {
  content: string;
  canonicalUrl?: string;
  originalStoragePath: string;
  fileName: string;
  kind: "pdf" | "web";
  suggestedTitle?: string;
  sectionIndex: number;
  sectionCount: number;
  totalCharacters: number;
};
const SOURCE_INGESTION_TIMEOUT_MS = 9 * 60 * 1_000;

type PublishedSourcesResponse = { sources: PublishedSource[] };

const authorityLabels: Record<number, string> = {
  5: "5 — Official MCG primary publication",
  4: "4 — Official MCG or diocesan publication",
  3: "3 — Approved Methodist historical source",
  2: "2 — Recognised scholarly source",
  1: "1 — Supporting material",
};

function readableError(error: unknown): string {
  if (typeof error === "object" && error && "message" in error && typeof error.message === "string") {
    if (error.message.includes("permission-denied")) return "Your account is not approved as a Wesley source administrator.";
    if (error.message.includes("failed-precondition")) return "App Check is not configured for this dashboard yet.";
    return error.message.replace(/^.*?:\s*/, "").replace(/\s*\[\d{3}\]\s*$/, "");
  }
  return "Something went wrong. Nothing was published.";
}

function sourceIsValid(source: SourceDraft): boolean {
  return source.title.trim().length >= 3
    && source.authorityLevel >= 1
    && source.authorityLevel <= 5
    && source.content.trim().length >= 100
    && source.content.length <= 80_000;
}

function initialTheme(): Theme {
  try {
    const savedTheme = window.localStorage.getItem("wesley-dashboard-theme");
    if (savedTheme === "light" || savedTheme === "dark") return savedTheme;
  } catch {
    // A blocked storage area should not prevent the dashboard from opening.
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function App() {
  const [screen, setScreen] = useState<Screen>("library");
  const [user, setUser] = useState<User | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [authLoading, setAuthLoading] = useState(true);
  const [source, setSource] = useState<SourceDraft>(initialSourceDraft);
  const [draftSnapshot, setDraftSnapshot] = useState<SourceDraft | null>(null);
  const [ingestedDraft, setIngestedDraft] = useState<IngestedDraft | null>(null);
  const [publishCopyrightStatus, setPublishCopyrightStatus] = useState<Exclude<CopyrightStatus, "unknown"> | "">("");
  const [requestState, setRequestState] = useState<RequestState>("idle");
  const [publishedSources, setPublishedSources] = useState<PublishedSource[]>([]);
  const [libraryState, setLibraryState] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [theme, setTheme] = useState<Theme>(initialTheme);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    try {
      window.localStorage.setItem("wesley-dashboard-theme", theme);
    } catch {
      // The selected theme remains active for this visit when storage is unavailable.
    }
  }, [theme]);

  function toggleTheme(): void {
    setTheme((currentTheme) => currentTheme === "dark" ? "light" : "dark");
  }

  useEffect(() => {
    if (!auth) {
      setAuthLoading(false);
      return undefined;
    }
    return onAuthStateChanged(auth, async (nextUser) => {
      setUser(nextUser);
      setIsAdmin(Boolean(nextUser && (await nextUser.getIdTokenResult()).claims.wesley_admin === true));
      setAuthLoading(false);
    });
  }, []);

  const contentWordCount = useMemo(
    () => source.content.trim() ? source.content.trim().split(/\s+/).length : 0,
    [source.content],
  );

  const loadPublishedSources = useCallback(async (): Promise<void> => {
    if (!functions) return;
    setLibraryState("loading");
    try {
      const list = httpsCallable<void, PublishedSourcesResponse>(functions, "listPublishedWesleySources");
      const { data } = await list();
      setPublishedSources(data.sources);
      setLibraryState("ready");
    } catch {
      setLibraryState("error");
    }
  }, []);

  useEffect(() => {
    if (!isAdmin) {
      setPublishedSources([]);
      return;
    }
    void loadPublishedSources();
  }, [isAdmin, loadPublishedSources]);

  async function signIn(): Promise<void> {
    if (!auth) return;
    setError(null);
    try {
      const credential = await signInWithPopup(auth, googleProvider);
      const token = await credential.user.getIdTokenResult(true);
      setIsAdmin(token.claims.wesley_admin === true);
    } catch (signInError) {
      setError(readableError(signInError));
    }
  }

  async function activateInitialAdmin(): Promise<void> {
    if (!auth || !functions) return;
    setError(null);
    try {
      const activate = httpsCallable<void, { activated: true }>(functions, "activateInitialWesleyAdmin");
      await activate();
      if (!auth.currentUser) throw new Error("No signed-in user was found.");
      const token = await auth.currentUser.getIdTokenResult(true);
      setIsAdmin(token.claims.wesley_admin === true);
    } catch (activationError) {
      setError(readableError(activationError));
    }
  }

  async function signOutDashboard(): Promise<void> {
    if (auth) await signOut(auth);
  }

  function updateSource<Key extends keyof SourceDraft>(key: Key, value: SourceDraft[Key]): void {
    setSource((current) => ({ ...current, [key]: value }));
    setError(null);
  }

  function beginReview(): void {
    if (!sourceIsValid(source)) {
      setError("Add a source title, authority level, and 100–80,000 characters of reviewed source text before continuing.");
      return;
    }
    setDraftSnapshot({ ...source, canonicalUrl: source.canonicalUrl.trim() });
    setError(null);
    setScreen("review");
  }

  async function importSource(request: SourceImportRequest): Promise<void> {
    if (!functions) return;
    setRequestState("importing");
    setError(null);
    try {
      const call = httpsCallable<SourceImportRequest, ImportedSource>(functions, "importWesleySource");
      const { data } = await call(request);
      setSource((current) => ({
        ...current,
        title: current.title || data.suggestedTitle || current.title,
        canonicalUrl: data.canonicalUrl ?? current.canonicalUrl,
        content: data.content,
        originalStoragePath: data.originalStoragePath,
        originalFileName: data.fileName,
        importKind: data.kind,
        importSectionIndex: data.sectionIndex,
        importSectionCount: data.sectionCount,
        importTotalCharacters: data.totalCharacters,
      }));
      setRequestState("idle");
    } catch (importError) {
      setRequestState("idle");
      setError(readableError(importError));
    }
  }

  async function createDraft(): Promise<void> {
    if (!draftSnapshot || !functions) return;
    setRequestState("creating");
    setError(null);
    try {
      const call = httpsCallable<IngestSourceDraft, IngestedDraft>(functions, "ingestWesleySource", {
        timeout: SOURCE_INGESTION_TIMEOUT_MS,
      });
      const { data } = await call({
        title: draftSnapshot.title,
        authorityLevel: draftSnapshot.authorityLevel,
        content: draftSnapshot.content,
        copyrightStatus: "unknown",
        ...(draftSnapshot.publisher.trim() ? { publisher: draftSnapshot.publisher.trim() } : {}),
        ...(draftSnapshot.denomination.trim() ? { denomination: draftSnapshot.denomination.trim() } : {}),
        ...(draftSnapshot.jurisdiction.trim() ? { jurisdiction: draftSnapshot.jurisdiction.trim() } : {}),
        ...(draftSnapshot.versionLabel.trim() ? { versionLabel: draftSnapshot.versionLabel.trim() } : {}),
        ...(draftSnapshot.canonicalUrl ? { canonicalUrl: draftSnapshot.canonicalUrl } : {}),
        ...(draftSnapshot.topic.trim() ? { topic: draftSnapshot.topic.trim() } : {}),
        ...(draftSnapshot.pageReference.trim() ? { pageReference: draftSnapshot.pageReference.trim() } : {}),
        ...(draftSnapshot.originalStoragePath ? { originalStoragePath: draftSnapshot.originalStoragePath } : {}),
      });
      setIngestedDraft(data);
      setRequestState("idle");
    } catch (createError) {
      setRequestState("idle");
      setError(readableError(createError));
    }
  }

  async function publishDraft(): Promise<void> {
    if (!ingestedDraft || !functions) return;
    if (!publishCopyrightStatus) {
      setError("Choose the usage basis before publishing this source.");
      return;
    }
    setRequestState("publishing");
    setError(null);
    try {
      const publish = httpsCallable<{ sourceVersionId: string; copyrightStatus: Exclude<CopyrightStatus, "unknown"> }, { published: true }>(functions, "publishWesleySourceVersion");
      await publish({ sourceVersionId: ingestedDraft.sourceVersionId, copyrightStatus: publishCopyrightStatus });
      setRequestState("published");
      void loadPublishedSources();
    } catch (publishError) {
      setRequestState("idle");
      setError(readableError(publishError));
    }
  }

  function startAnotherSource(): void {
    setSource(initialSourceDraft);
    setDraftSnapshot(null);
    setIngestedDraft(null);
    setPublishCopyrightStatus("");
    setRequestState("idle");
    setError(null);
    setScreen("new");
  }

  if (firebaseConfigurationError || !auth || !functions) {
    return <ConfigurationNotice detail={firebaseConfigurationError ?? "Firebase configuration is incomplete."} theme={theme} onToggleTheme={toggleTheme} />;
  }
  if (authLoading) return <main className="loading-page">Opening Wesley Sources…</main>;
  if (!user) return <SignIn onSignIn={signIn} error={error} theme={theme} onToggleTheme={toggleTheme} />;
  if (!isAdmin) return <AccessDenied email={user.email ?? "this account"} onActivate={activateInitialAdmin} onSignOut={signOutDashboard} theme={theme} onToggleTheme={toggleTheme} />;

  return (
    <main className="app-shell">
      <header className="topbar">
        <button className="brand" onClick={() => setScreen("library")} aria-label="Wesley Sources home">
          <span className="brand-mark" aria-hidden="true">W</span>
          <span><strong>Wesley Sources</strong><small>MHB staff workspace</small></span>
        </button>
        <div className="account">
          <ThemeToggle theme={theme} onToggle={toggleTheme}/>
          <span>{user.email ?? "Wesley administrator"}</span>
          <button className="text-button" onClick={signOutDashboard}>Sign out</button>
        </div>
      </header>

      <div className="workspace">
        <nav className="side-nav" aria-label="Primary navigation">
          <button className={screen === "library" ? "active" : ""} onClick={() => setScreen("library")}>Source library</button>
          <button className={screen === "new" || screen === "review" ? "active" : ""} onClick={startAnotherSource}>Add a source</button>
          <p className="nav-note">Only approved source versions can answer Wesley questions.</p>
        </nav>

        <section className="content" aria-live="polite">
          {screen === "library" && <Library sources={publishedSources} state={libraryState} onAdd={startAnotherSource} onRefresh={loadPublishedSources} />}
          {screen === "new" && (
            <SourceForm
              source={source}
              wordCount={contentWordCount}
              requestState={requestState}
              onChange={updateSource}
              onImport={importSource}
              onReview={beginReview}
              error={error}
            />
          )}
          {screen === "review" && draftSnapshot && (
            <ReviewSource
              source={draftSnapshot}
              ingestedDraft={ingestedDraft}
              requestState={requestState}
              error={error}
              onBack={() => { setError(null); setScreen("new"); }}
              onCreateDraft={createDraft}
              onPublish={publishDraft}
              publishCopyrightStatus={publishCopyrightStatus}
              onPublishCopyrightStatusChange={setPublishCopyrightStatus}
              onStartAnother={startAnotherSource}
            />
          )}
        </section>
      </div>
    </main>
  );
}

function ThemeToggle({ theme, onToggle, floating = false }: { theme: Theme; onToggle: () => void; floating?: boolean }) {
  const isDark = theme === "dark";
  return <button className={floating ? "theme-toggle floating" : "theme-toggle"} onClick={onToggle} aria-label={`Switch to ${isDark ? "light" : "dark"} mode`} title={`Switch to ${isDark ? "light" : "dark"} mode`}>
    <span aria-hidden="true">{isDark ? "☀" : "◐"}</span><span>{isDark ? "Light" : "Dark"}</span>
  </button>;
}

function SignIn({ onSignIn, error, theme, onToggleTheme }: { onSignIn: () => Promise<void>; error: string | null; theme: Theme; onToggleTheme: () => void }) {
  return <main className="auth-page"><section className="auth-card">
    <ThemeToggle theme={theme} onToggle={onToggleTheme} floating/>
    <span className="brand-mark large" aria-hidden="true">W</span>
    <p className="eyebrow">MHB STAFF WORKSPACE</p>
    <h1>Curate Wesley’s trusted library.</h1>
    <p>Draft and publish reviewed Methodist sources. Public MHB users cannot access this workspace.</p>
    {error && <p className="error-message" role="alert">{error}</p>}
    <button className="primary-button full" onClick={onSignIn}>Sign in with Google</button>
  </section></main>;
}

function AccessDenied({ email, onActivate, onSignOut, theme, onToggleTheme }: { email: string; onActivate: () => Promise<void>; onSignOut: () => Promise<void>; theme: Theme; onToggleTheme: () => void }) {
  const isInitialAdmin = email.toLowerCase() === "kakyireinc@gmail.com";
  return <main className="auth-page"><section className="auth-card">
    <ThemeToggle theme={theme} onToggle={onToggleTheme} floating/>
    <p className="eyebrow">ACCESS RESTRICTED</p>
    <h1>This account is not a Wesley source administrator.</h1>
    <p>{email} is signed in, but does not have the required <code>wesley_admin</code> role.</p>
    {isInitialAdmin && <button className="primary-button full" onClick={onActivate}>Activate administrator access</button>}
    <button className="secondary-button full" onClick={onSignOut}>Use another account</button>
  </section></main>;
}

function ConfigurationNotice({ detail, theme, onToggleTheme }: { detail: string; theme: Theme; onToggleTheme: () => void }) {
  return <main className="auth-page"><section className="auth-card">
    <ThemeToggle theme={theme} onToggle={onToggleTheme} floating/>
    <p className="eyebrow">SETUP REQUIRED</p>
    <h1>Connect this dashboard to Firebase.</h1>
    <p>Copy <code>.env.example</code> to <code>.env.local</code>, add the Firebase web app configuration, then restart the development server.</p>
    <p className="error-message">{detail}</p>
  </section></main>;
}

function Library({ sources, state, onAdd, onRefresh }: { sources: PublishedSource[]; state: "loading" | "ready" | "error"; onAdd: () => void; onRefresh: () => Promise<void> }) {
  const [query, setQuery] = useState("");
  const matchingSources = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    if (!normalizedQuery) return sources;
    return sources.filter((source) => [source.title, source.publisher, source.versionLabel, source.topic, source.jurisdiction, source.canonicalUrl]
      .filter((value): value is string => Boolean(value))
      .some((value) => value.toLocaleLowerCase().includes(normalizedQuery)));
  }, [query, sources]);

  return <>
    <div className="page-heading"><div><p className="eyebrow">SOURCE GOVERNANCE</p><h1>Published sources</h1><p>Review the live library before preparing a source, so the team can avoid uploading or publishing the same material twice.</p></div><button className="primary-button" onClick={onAdd}>Add a source</button></div>
    <section className="library-panel" aria-labelledby="published-sources-heading">
      <div className="library-toolbar"><div><h2 id="published-sources-heading">{state === "loading" ? "Loading published sources…" : `${sources.length} published ${sources.length === 1 ? "source" : "sources"}`}</h2><p>Only approved versions are listed here.</p></div><button className="secondary-button" onClick={() => void onRefresh()} disabled={state === "loading"}>{state === "loading" ? "Refreshing…" : "Refresh list"}</button></div>
      <label className="library-search">Search published sources<input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Title, publisher, topic, URL…" disabled={state === "loading"}/></label>
      {state === "error" && <p className="library-message">The published-source list is unavailable. Try refreshing before adding a source.</p>}
      {state === "ready" && matchingSources.length === 0 && <p className="library-message">{sources.length === 0 ? "No sources have been published yet." : "No published sources match that search."}</p>}
      {matchingSources.length > 0 && <div className="published-source-list">{matchingSources.map((source) => <PublishedSourceRow key={source.sourceVersionId} source={source}/>)}</div>}
    </section>
    <div className="status-grid library-guidance">
      <article><span className="status-dot draft"/><strong>Draft first</strong><p>Text and metadata remain private while you check them.</p></article>
      <article><span className="status-dot review"/><strong>Review carefully</strong><p>Confirm authority, rights, extraction quality, and page references.</p></article>
      <article><span className="status-dot published"/><strong>Publish deliberately</strong><p>Only published versions can support a Wesley answer.</p></article>
    </div>
    <section className="callout"><h2>Start with primary sources.</h2><p>Use official Methodist Church Ghana publications, diocesan materials, approved constitutions, and licensed historical works. Do not add social posts, anonymous documents, or text without a valid right to use it.</p></section>
  </>;
}

function PublishedSourceRow({ source }: { source: PublishedSource }) {
  return <article className="published-source">
    <div><h3>{source.title}</h3><p>{[source.publisher, source.versionLabel, source.jurisdiction].filter(Boolean).join(" · ") || "Citation details not supplied"}</p></div>
    <div className="published-source-meta"><span className="authority-tag">Level {source.authorityLevel}</span>{source.topic && <span>{source.topic}</span>}{source.pageReference && <span>{source.pageReference}</span>}{source.publishedAt && <span>Published {formatPublishedDate(source.publishedAt)}</span>}</div>
    {source.canonicalUrl && <a href={source.canonicalUrl} target="_blank" rel="noreferrer">View original source</a>}
  </article>;
}

function formatPublishedDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(date);
}

function SourceForm({ source, wordCount, requestState, onChange, onImport, onReview, error }: {
  source: SourceDraft;
  wordCount: number;
  requestState: RequestState;
  onChange: <Key extends keyof SourceDraft>(key: Key, value: SourceDraft[Key]) => void;
  onImport: (request: SourceImportRequest) => Promise<void>;
  onReview: () => void;
  error: string | null;
}) {
  const [importMethod, setImportMethod] = useState<"paste" | "url" | "pdf">("paste");
  const [sourceUrl, setSourceUrl] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const importing = requestState === "importing";

  async function importFromPdf(sectionIndex = 0): Promise<void> {
    if (!selectedFile) return;
    if (selectedFile.size > 5 * 1024 * 1024) return;
    const base64 = await fileAsBase64(selectedFile);
    await onImport({ kind: "pdf", fileName: selectedFile.name, base64, sectionIndex });
  }

  async function selectImportedSection(sectionIndex: number): Promise<void> {
    if (source.importKind === "pdf") {
      await importFromPdf(sectionIndex);
      return;
    }
    const url = sourceUrl.trim() || source.canonicalUrl;
    if (url) await onImport({ kind: "url", url, sectionIndex });
  }

  return <>
    <div className="page-heading compact"><div><p className="eyebrow">NEW SOURCE</p><h1>Prepare a reviewed source.</h1><p>Start with a public link, a PDF, or reviewed pasted text. You always confirm the extracted result before Wesley can use it.</p></div></div>
    <div className="workflow-steps" aria-label="Source workflow"><span className="current">1. Prepare</span><span>2. Review</span><span>3. Publish</span></div>
    {error && <p className="error-message" role="alert">{error}</p>}
    <form className="source-form" onSubmit={(event) => { event.preventDefault(); onReview(); }}>
      <fieldset><legend>Bring in source material</legend><p className="field-help">PDFs and link snapshots are stored privately. The maximum file size is 5 MB; scanned PDFs need selectable text (OCR) before import.</p>
        <div className="import-tabs" role="tablist" aria-label="Source input method">
          <button type="button" role="tab" aria-selected={importMethod === "paste"} className={importMethod === "paste" ? "active" : ""} onClick={() => setImportMethod("paste")}>Paste text</button>
          <button type="button" role="tab" aria-selected={importMethod === "url"} className={importMethod === "url" ? "active" : ""} onClick={() => setImportMethod("url")}>Import link</button>
          <button type="button" role="tab" aria-selected={importMethod === "pdf"} className={importMethod === "pdf" ? "active" : ""} onClick={() => setImportMethod("pdf")}>Upload PDF</button>
        </div>
        {importMethod === "url" && <div className="import-control"><label>Public HTTPS source link<input type="url" value={sourceUrl} onChange={(event) => setSourceUrl(event.target.value)} placeholder="https://example.org/history" /></label><button type="button" className="secondary-button" disabled={!sourceUrl.trim() || importing} onClick={() => onImport({ kind: "url", url: sourceUrl.trim(), sectionIndex: 0 })}>{importing ? "Extracting…" : "Extract link"}</button></div>}
        {importMethod === "pdf" && <div className="import-control"><label>PDF file<input type="file" accept="application/pdf,.pdf" onChange={(event) => setSelectedFile(event.target.files?.[0] ?? null)} /></label><div><button type="button" className="secondary-button" disabled={!selectedFile || selectedFile.size > 5 * 1024 * 1024 || importing} onClick={() => importFromPdf()}>{importing ? "Extracting…" : "Extract PDF"}</button>{selectedFile && <p className={selectedFile.size > 5 * 1024 * 1024 ? "file-warning" : "file-note"}>{selectedFile.name} · {(selectedFile.size / 1024 / 1024).toFixed(1)} MB{selectedFile.size > 5 * 1024 * 1024 ? " — exceeds 5 MB" : ""}</p>}</div></div>}
        {source.originalStoragePath && <p className="import-success">A private {source.importKind === "pdf" ? "PDF" : "link snapshot"} is attached{source.originalFileName ? `: ${source.originalFileName}` : ""}. You may edit the extracted text below before review.</p>}
        {(source.importSectionCount ?? 1) > 1 && <div className="section-picker"><label>Reviewed section<select value={source.importSectionIndex ?? 0} disabled={importing || (source.importKind === "pdf" && !selectedFile)} onChange={(event) => selectImportedSection(Number(event.target.value))}>{Array.from({ length: source.importSectionCount ?? 1 }, (_, index) => <option key={index} value={index}>Part {index + 1} of {source.importSectionCount}</option>)}</select></label><p>This source has {(source.importTotalCharacters ?? 0).toLocaleString()} characters. Select and publish each reviewed part separately; Wesley never indexes unseen text.</p>{source.importKind === "pdf" && !selectedFile && <p className="file-warning">Choose the same PDF again to select another part.</p>}</div>}
      </fieldset>
      <fieldset><legend>Source details</legend><div className="field-grid two"><Field label="Source title" required value={source.title} onChange={(value) => onChange("title", value)} placeholder="History of the Methodist Church Ghana"/><label>Authority level <span className="required">*</span><select value={source.authorityLevel} onChange={(event) => onChange("authorityLevel", Number(event.target.value))}>{Object.entries(authorityLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></div><details className="optional-details"><summary>Add citation details <span className="optional">optional</span></summary><div className="field-grid two"><Field label="Publisher" value={source.publisher} onChange={(value) => onChange("publisher", value)} placeholder="Methodist Church Ghana"/><Field label="Edition or version" value={source.versionLabel} onChange={(value) => onChange("versionLabel", value)} placeholder="2026 edition"/><Field label="Topic" value={source.topic} onChange={(value) => onChange("topic", value)} placeholder="history, governance, doctrine…"/><Field label="Jurisdiction" value={source.jurisdiction} onChange={(value) => onChange("jurisdiction", value)} placeholder="MCG"/><Field label="Page or chapter reference" value={source.pageReference} onChange={(value) => onChange("pageReference", value)} placeholder="Chapter 2, pages 18–29"/><label>Official source URL <span className="optional">optional</span><input type="url" value={source.canonicalUrl} onChange={(event) => onChange("canonicalUrl", event.target.value)} placeholder="https://…"/></label></div></details></fieldset>
      <fieldset><legend>Reviewed source text <span className="required">*</span></legend><p className="field-help">Keep headings and page markers where possible. The original text is stored privately and does not become public merely by being ingested.</p><label className="sr-only" htmlFor="source-content">Source text</label><textarea id="source-content" value={source.content} onChange={(event) => onChange("content", event.target.value)} placeholder="Paste approved, reviewed source text here…" rows={18}/><div className="character-count"><span>{wordCount.toLocaleString()} words</span><span>{source.content.length.toLocaleString()} / 80,000 characters</span></div></fieldset>
      <div className="form-footer"><p>You will confirm the source’s right to use when you publish. Only published sources can support Wesley answers.</p><button className="primary-button" type="submit">Review source</button></div>
    </form>
  </>;
}

function fileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("The selected PDF could not be read."));
    reader.onload = () => {
      const value = typeof reader.result === "string" ? reader.result : "";
      const marker = ";base64,";
      const index = value.indexOf(marker);
      if (index === -1) { reject(new Error("The selected PDF could not be read.")); return; }
      resolve(value.slice(index + marker.length));
    };
    reader.readAsDataURL(file);
  });
}

function Field({ label, value, onChange, placeholder, required = false }: { label: string; value: string; onChange: (value: string) => void; placeholder: string; required?: boolean }) {
  return <label>{label}{required && <span className="required"> *</span>}<input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} required={required}/></label>;
}

function ReviewSource({ source, ingestedDraft, requestState, error, onBack, onCreateDraft, onPublish, publishCopyrightStatus, onPublishCopyrightStatusChange, onStartAnother }: {
  source: SourceDraft;
  ingestedDraft: IngestedDraft | null;
  requestState: RequestState;
  error: string | null;
  onBack: () => void;
  onCreateDraft: () => Promise<void>;
  onPublish: () => Promise<void>;
  publishCopyrightStatus: Exclude<CopyrightStatus, "unknown"> | "";
  onPublishCopyrightStatusChange: (value: Exclude<CopyrightStatus, "unknown"> | "") => void;
  onStartAnother: () => void;
}) {
  const published = requestState === "published";
  return <>
    <div className="page-heading compact"><div><p className="eyebrow">{published ? "PUBLISHED" : ingestedDraft ? "DRAFT READY" : "REVIEW SOURCE"}</p><h1>{published ? "This source is now available to Wesley." : "Check this source before it reaches Wesley."}</h1><p>{published ? "A new approved version is now eligible to support cited answers." : "Review the metadata and text selection. You will confirm the source’s usage basis immediately before publishing."}</p></div></div>
    <div className="workflow-steps" aria-label="Source workflow"><span>1. Prepare</span><span className={ingestedDraft ? "" : "current"}>2. Review</span><span className={ingestedDraft ? "current" : ""}>3. Publish</span></div>
    {error && <p className="error-message" role="alert">{error}</p>}
    <article className="review-card"><div className="review-head"><div><h2>{source.title}</h2><p>{[source.publisher, source.versionLabel].filter(Boolean).join(" · ") || "Citation details not supplied"}</p></div><span className={published ? "pill published" : "pill draft"}>{published ? "Published" : ingestedDraft ? "Draft" : "Not yet saved"}</span></div><dl className="metadata"><div><dt>Topic</dt><dd>{source.topic || "Not specified"}</dd></div><div><dt>Jurisdiction</dt><dd>{source.jurisdiction}</dd></div><div><dt>Authority</dt><dd>{authorityLabels[source.authorityLevel]}</dd></div><div><dt>Usage basis</dt><dd>{published ? publishCopyrightStatus.replace("_", " ") : "Choose at publish"}</dd></div><div><dt>Reference</dt><dd>{source.pageReference || "Not specified"}</dd></div><div><dt>Original URL</dt><dd>{source.canonicalUrl || "Not supplied"}</dd></div></dl><div className="source-preview"><h3>Text preview</h3><p>{source.content.slice(0, 1_200)}{source.content.length > 1_200 ? "…" : ""}</p></div></article>
    {!ingestedDraft && <div className="review-actions"><button className="secondary-button" onClick={onBack}>Edit source</button><button className="primary-button" onClick={onCreateDraft} disabled={requestState === "creating"}>{requestState === "creating" ? "Creating private draft…" : "Create private draft"}</button></div>}
    {ingestedDraft && !published && <section className="publish-panel"><div><p className="eyebrow">DRAFT CREATED</p><h2>{ingestedDraft.chunkCount} retrieval sections are ready for review.</h2><p>The original text remains private. Publishing makes these approved sections eligible for Wesley answers.</p><code>Version {ingestedDraft.sourceVersionId}</code></div><div className="publish-control"><label>Usage basis <span className="required">*</span><select value={publishCopyrightStatus} onChange={(event) => onPublishCopyrightStatusChange(event.target.value as Exclude<CopyrightStatus, "unknown"> | "")}><option value="">Choose before publishing</option><option value="permission_granted">Permission granted</option><option value="licensed">Licensed</option><option value="public_domain">Public domain</option></select></label><p>Confirm MHB has the right to store and use this text.</p><button className="primary-button" onClick={onPublish} disabled={requestState === "publishing" || !publishCopyrightStatus}>{requestState === "publishing" ? "Publishing…" : "Publish reviewed source"}</button></div></section>}
    {published && <div className="review-actions"><button className="primary-button" onClick={onStartAnother}>Add another source</button></div>}
  </>;
}
