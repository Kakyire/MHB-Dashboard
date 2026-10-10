import { useEffect, useState } from "react";
import { httpsCallable } from "firebase/functions";
import { functions, requireAppCheckToken } from "./firebase";

type Report = { id: string; request_id: string; answer_excerpt: string; reason_code: string; details: string | null; created_at: string };
type Deletion = { id: string; firebase_uid: string; status: string; revenuecat_status: string; mixpanel_status: string; created_at: string };
type Queue = { reports: Report[]; deletions: Deletion[] };

export function ReleaseQueue() {
  const [queue, setQueue] = useState<Queue>({ reports: [], deletions: [] });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [evidence, setEvidence] = useState<Record<string, string>>({});

  async function refresh() {
    if (!functions) return;
    setLoading(true);
    try {
      await requireAppCheckToken();
      const { data } = await httpsCallable<void, Queue>(functions, "listWesleyReleaseRequests", { limitedUseAppCheckTokens: true })();
      setQueue(data);
      setError(null);
    } catch { setError("The review queue could not load. Check your access and try again."); }
    finally { setLoading(false); }
  }

  useEffect(() => { void refresh(); }, []);

  async function update(id: string, kind: "report" | "deletion", action: "resolve" | "retry") {
    if (!functions) return;
    setBusyId(id);
    try {
      await requireAppCheckToken();
      await httpsCallable(functions, "resolveWesleyReleaseRequest", { limitedUseAppCheckTokens: true })({ id, kind, action, evidence: evidence[id] ?? "" });
      await refresh();
    } catch { setError("The action did not finish. Keep this request open, check provider completion, and retry. Resolution requires a note of at least 10 characters."); }
    finally { setBusyId(null); }
  }

  return <>
    <div className="page-heading"><div><p className="eyebrow">RELEASE SAFEGUARDS</p><h1>Reports and deletion requests</h1><p>Owner: <a href="mailto:kakyireinc@gmail.com">kakyireinc@gmail.com</a>. Review this queue each working day. Urgent safety reports take priority.</p></div><button onClick={() => void refresh()} disabled={loading}>Refresh</button></div>
    {error && <p role="alert" className="error-message">{error}</p>}
    <h2>Answer reports ({queue.reports.length})</h2>
    <p>Inspect the approved source and reported answer. Correct or retire sources when needed and verify a corrected response. Resolving invalidates the stored answer. An excerpt may come from the reporting client if the original answer was not retained.</p>
    {!loading && queue.reports.length === 0 && <p>No open reports.</p>}
    {queue.reports.map(report => <article className="review-card release-request" key={report.id}>
      <h3>{report.reason_code.replaceAll("_", " ")}</h3>
      <p>Received {new Date(report.created_at).toLocaleString()} · Request {report.request_id}</p>
      <blockquote style={{ whiteSpace: "pre-wrap" }}>{report.answer_excerpt}</blockquote>
      {report.details && <p>{report.details}</p>}
      <label>Investigation and corrective action<textarea maxLength={1000} value={evidence[report.id] ?? ""} onChange={event => setEvidence({ ...evidence, [report.id]: event.target.value })} /></label>
      <button disabled={busyId !== null || (evidence[report.id] ?? "").trim().length < 10} onClick={() => void update(report.id, "report", "resolve")}>Record action and resolve</button>
    </article>)}
    <h2>Account deletion requests ({queue.deletions.length})</h2>
    <p>Local data and Firebase deletion are retried automatically. Complete Mixpanel erasure through its privacy tools using the Firebase UID and associated distinct/device IDs. Verify RevenueCat erasure, including aliases, and any applicable provider retention. A RevenueCat deletion request is asynchronous. Do not mark a request complete until provider erasure is confirmed. Apple subscriptions are managed by the user through Apple.</p>
    {!loading && queue.deletions.length === 0 && <p>No pending deletions.</p>}
    {queue.deletions.map(request => <article className="review-card release-request" key={request.id}>
      <h3>Deletion {request.id}</h3>
      <p>Firebase UID: <code>{request.firebase_uid}</code></p>
      <p>Local: {request.status} · RevenueCat: {request.revenuecat_status} · Mixpanel: {request.mixpanel_status}</p>
      <button disabled={busyId !== null} onClick={() => void update(request.id, "deletion", "retry")}>Retry automatic deletion</button>
      <label>Evidence of completed vendor erasure (ticket IDs; no secrets)<textarea maxLength={1000} value={evidence[request.id] ?? ""} onChange={event => setEvidence({ ...evidence, [request.id]: event.target.value })} /></label>
      <button disabled={busyId !== null || request.status !== "vendor_pending" || (evidence[request.id] ?? "").trim().length < 10} onClick={() => void update(request.id, "deletion", "resolve")}>Confirm both vendor completions</button>
    </article>)}
    <p>Each queue shows the oldest 100 open requests. Refresh after processing to load the next group. Delete identifiers and notes from local exports after handling them.</p>
  </>;
}
