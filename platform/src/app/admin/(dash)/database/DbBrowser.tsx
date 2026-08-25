"use client";

import { useCallback, useEffect, useState } from "react";

const ENTITIES = [
  { key: "transactions", label: "Transactions" },
  { key: "payment_events", label: "Payment Events" },
  { key: "claims", label: "Claims" },
  { key: "callback_deliveries", label: "Callbacks" },
  { key: "webhook_events", label: "Webhook Events" },
  { key: "users", label: "Users" },
  { key: "sessions", label: "Sessions" },
  { key: "login_attempts", label: "Login Attempts" },
  { key: "audit_logs", label: "Audit Logs" },
  { key: "monitor_viewers", label: "Monitor Viewers" },
];

type RowsState = {
  rows: Array<Record<string, unknown>>;
  total: number;
  deletable: boolean;
};

function csrfToken(): string {
  const match = document.cookie.match(/(?:^|;\s*)bp_csrf=([^;]+)/);
  return match?.[1] ?? "";
}

export default function DbBrowser() {
  const [entity, setEntity] = useState("transactions");
  const [q, setQ] = useState("");
  const [state, setState] = useState<RowsState | null>(null);
  const [loading, setLoading] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: "50" });
      if (q) params.set("q", q);
      const res = await fetch(`/api/admin/db/${entity}?${params}`, { cache: "no-store" });
      const json = await res.json();
      if (json.success) {
        setState({ rows: json.data.rows, total: json.data.total, deletable: json.data.deletable });
      } else {
        setState(null);
        setNote(json.error ?? "Gagal memuat.");
      }
    } catch {
      setNote("Jaringan bermasalah.");
    } finally {
      setLoading(false);
    }
  }, [entity, q]);

  useEffect(() => {
    void load();
  }, [load]);

  const deleteRow = async (id: string) => {
    if (!window.confirm(`Hapus baris ${id} dari ${entity}? Tindakan ini tercatat di audit log.`)) return;
    const res = await fetch(`/api/admin/db/${entity}?id=${encodeURIComponent(id)}&confirm=${entity}`, {
      method: "DELETE",
      headers: { "x-csrf-token": csrfToken() },
    });
    const json = await res.json();
    setNote(json.success ? `Baris dihapus.` : json.error ?? "Hapus gagal.");
    void load();
  };

  const columns = state?.rows[0] ? Object.keys(state.rows[0]) : [];

  return (
    <div className="bp-stagger space-y-4">
      <div className="flex flex-wrap gap-1.5">
        {ENTITIES.map((e) => (
          <button
            key={e.key}
            onClick={() => setEntity(e.key)}
            className={`rounded-lg px-3 py-1.5 text-xs ${
              entity === e.key ? "bg-[rgba(249,115,22,0.14)] text-[var(--color-accent)]" : "btn-ghost text-[var(--color-muted)]"
            }`}
          >
            {e.label}
          </button>
        ))}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void load();
        }}
        className="flex gap-2"
      >
        <input className="input-dark !w-72 !py-1.5 text-sm" placeholder="Cari…" value={q} onChange={(e) => setQ(e.target.value)} />
        <button className="btn-ghost rounded-lg px-3 text-sm">Cari</button>
        <button type="button" onClick={() => void load()} className="btn-ghost rounded-lg px-3 text-sm">Muat Ulang</button>
        {state && <span className="self-center text-xs text-[var(--color-muted)]">{state.total} baris</span>}
      </form>

      {note && <p className="rounded-lg bg-white/5 px-3 py-2 text-xs">{note}</p>}

      <div className="glass overflow-x-auto p-0">
        {loading ? (
          <p className="py-8 text-center text-sm text-[var(--color-muted)]">Memuat…</p>
        ) : !state || state.rows.length === 0 ? (
          <p className="py-8 text-center text-sm text-[var(--color-muted)]">Tidak ada data.</p>
        ) : (
          <table className="table-dark w-full">
            <thead>
              <tr>
                {columns.map((c) => <th key={c}>{c}</th>)}
                {state.deletable && <th>Aksi</th>}
              </tr>
            </thead>
            <tbody>
              {state.rows.map((row, i) => (
                <tr key={i} className="hover:bg-white/[0.03]">
                  {columns.map((c) => (
                    <td key={c} title={String(row[c] ?? "")}>
                      {row[c] === null || row[c] === undefined ? "—" : String(row[c])}
                    </td>
                  ))}
                  {state.deletable && (
                    <td>
                      <button
                        onClick={() => deleteRow(String(row.id ?? row.viewer_id))}
                        className="rounded border border-[rgba(239,68,68,0.4)] px-2 py-0.5 text-[11px] text-[var(--color-danger)] hover:bg-[rgba(239,68,68,0.08)]"
                      >
                        Hapus
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
