"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

export default function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const json = await res.json();
      if (json.success) {
        router.push(params.get("next")?.startsWith("/admin") ? params.get("next")! : "/admin");
        router.refresh();
      } else {
        setError(json.error ?? "Login gagal.");
      }
    } catch {
      setError("Jaringan bermasalah.");
    } finally {
      setBusy(false);
    }
  };

  return (
    // method+action eksplisit: bila JS gagal hydrate, submit tetap POST ke API
    // (native urlencoded -> redirect 303), TIDAK PERNAH GET dengan password di URL.
    <form method="post" action="/api/admin/login" onSubmit={submit} className="space-y-4">
      <input
        className="input-dark"
        type="text"
        name="username"
        autoComplete="username"
        placeholder="Username"
        value={username}
        onChange={(e) => setUsername(e.target.value)}
        required
      />
      <input
        className="input-dark"
        type="password"
        name="password"
        autoComplete="current-password"
        placeholder="Password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        required
      />
      {error && (
        <p className="rounded-lg bg-[rgba(239,68,68,0.12)] px-3 py-2 text-xs text-[var(--color-danger)]">{error}</p>
      )}
      <button type="submit" disabled={busy} className="btn-accent w-full rounded-xl py-2.5 text-sm">
        {busy ? "Memproses…" : "Masuk"}
      </button>
    </form>
  );
}
