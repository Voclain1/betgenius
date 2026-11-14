"use client";
import { useState } from "react";
export function RecoveryControls({ enabled }: { enabled: boolean }) {
  const [action, setAction] = useState("REFRESH_ODDS"),
    [id, setId] = useState(""),
    [reason, setReason] = useState(""),
    [preview, setPreview] = useState<any>(null),
    [authorized, setAuthorized] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function run(dryRun: boolean) {
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/admin/prediction-ops", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          predictionId: id,
          reason,
          dryRun,
          ...(!dryRun
            ? {
                expectedKey: preview?.key,
                authorizePublishedChange: authorized,
              }
            : {}),
        }),
      });
      const data = await r.json();
      if (!r.ok)
        throw new Error(
          typeof data.error === "string" ? data.error : "Request rejected",
        );
      setPreview(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unavailable");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="card space-y-3">
      <h2 className="text-xl font-bold">Controlled recovery</h2>
      <p className="text-sm text-gray-400">
        Dry runs do not write or contact the provider. Manual execution is{" "}
        {enabled ? "enabled" : "disabled"}. Nothing approves or publishes a
        prediction. Historical corrections remain in the prediction review
        tools.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <label>
          Action
          <select
            className="input w-full"
            value={action}
            onChange={(e) => {
              setAction(e.target.value);
              setPreview(null);
              setAuthorized(false);
            }}
          >
            <option value="REFRESH_ODDS">Refresh cached odds</option>
            <option value="RETRY_SETTLEMENT">
              Retry one pending settlement
            </option>
          </select>
        </label>
        <label>
          Prediction id
          <input
            className="input w-full"
            value={id}
            onChange={(e) => {
              setId(e.target.value);
              setPreview(null);
              setAuthorized(false);
            }}
          />
        </label>
        <label className="sm:col-span-2">
          Audit reason
          <input
            className="input w-full"
            minLength={8}
            maxLength={500}
            value={reason}
            onChange={(e) => {
              setReason(e.target.value);
              setPreview(null);
              setAuthorized(false);
            }}
          />
        </label>
      </div>
      <button
        className="btn-secondary"
        disabled={busy || !id || reason.trim().length < 8}
        onClick={() => run(true)}
      >
        Preview recovery
      </button>
      {preview && (
        <>
          <pre className="overflow-auto whitespace-pre-wrap break-words text-xs text-gray-300">
            {JSON.stringify(preview, null, 2)}
          </pre>
          <label className="block text-sm">
            <input
              type="checkbox"
              checked={authorized}
              onChange={(e) => setAuthorized(e.target.checked)}
            />{" "}
            I authorize this bounded cache refresh or pending-outcome
            evaluation.
          </label>
          <button
            className="btn-primary"
            disabled={busy || !enabled || !preview.eligible || !authorized}
            onClick={() => run(false)}
          >
            Execute reviewed recovery
          </button>
        </>
      )}
      {error && <p className="text-sm text-red-300">{error}</p>}
    </section>
  );
}
