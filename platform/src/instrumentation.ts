/**
 * Next.js instrumentation hook (stabil di Next 15+).
 * Menyalakan monitor coordinator + job auto-refresh provider
 * SEKALI saat proses server Node hidup.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { startCoordinator } = await import("./lib/monitor/coordinator");
  startCoordinator();
  const { startProviderRefreshJob } = await import("./lib/payments/provider-refresh");
  startProviderRefreshJob();
}
