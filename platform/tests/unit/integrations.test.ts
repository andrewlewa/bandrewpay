import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.DATABASE_PATH = join(mkdtempSync(join(tmpdir(), "integrations-")), "test.db");

const { getDb, closeDb } = await import("../../src/db/index.ts");
const {
  newIntegrationApp,
  getIntegrationApp,
  listIntegrationApps,
  updateIntegrationApp,
  rotateIntegrationAppSecret,
  deleteIntegrationApp,
  maskSecret,
  isAcceptableHttpUrl,
} = await import("../../src/lib/integrations.ts");
getDb();

test("buat aplikasi: id APP-, secret auto >=32 char, tercatat di DB", () => {
  const { app, generatedSecret } = newIntegrationApp({ label: "Toko A" });
  assert.ok(app.id.startsWith("APP-"));
  assert.ok((generatedSecret ?? "").length >= 32);
  assert.equal(app.secret.length >= 32, true);
  assert.equal(app.active, true);
  assert.equal(listIntegrationApps().length, 1);
});

test("callback/redirect default tersimpan & bisa diubah", () => {
  const { app } = newIntegrationApp({
    label: "Toko B",
    callback_url: "https://b.example.com/webhook",
    redirect_url: "https://b.example.com/thanks",
  });
  assert.equal(getIntegrationApp(app.id)?.callback_url, "https://b.example.com/webhook");
  updateIntegrationApp(app.id, { label: "Toko B2", active: false });
  const updated = getIntegrationApp(app.id)!;
  assert.equal(updated.label, "Toko B2");
  assert.equal(updated.active, false);
});

test("rotasi secret mengganti secret & hash", () => {
  const { app } = newIntegrationApp({ label: "Toko C" });
  const oldHash = getIntegrationApp(app.id)!.secret;
  const rotated = rotateIntegrationAppSecret(app.id)!;
  assert.ok(rotated.secret.length >= 32);
  assert.notEqual(rotated.secret, oldHash);
});

test("hapus aplikasi", () => {
  const { app } = newIntegrationApp({ label: "Toko D" });
  assert.equal(deleteIntegrationApp(app.id), true);
  assert.equal(getIntegrationApp(app.id), null);
  assert.equal(deleteIntegrationApp("APP-nonexistent"), false);
});

test("maskSecret menyembunyikan isi; validator URL ketat", () => {
  const m = maskSecret("abcdefghijklmnop");
  assert.ok(m.startsWith("abcd") && m.endsWith("mnop") && m.includes("*"));
  assert.equal(isAcceptableHttpUrl("https://x.com/y"), true);
  assert.equal(isAcceptableHttpUrl("http://localhost:4199/x"), true);
  assert.equal(isAcceptableHttpUrl("ftp://x"), false);
  assert.equal(isAcceptableHttpUrl("not a url"), false);
  assert.equal(isAcceptableHttpUrl(123), false);
});

closeDb();
