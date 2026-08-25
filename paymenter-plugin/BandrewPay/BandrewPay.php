<?php

namespace Paymenter\Extensions\Gateways\BandrewPay;

use App\Attributes\ExtensionMeta;
use App\Classes\Extension\Extension;
use App\Models\Invoice;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Log;
use GuzzleHttp\Client;

/**
 * BandrewPay — integrasi Paymenter untuk gateway QRIS BandrewPay (Next.js).
 *
 * Perbedaan keamanan vs plugin legacy:
 *  - Request keluar & webhook masuk memakai HMAC v2:
 *      signature = hash_hmac('sha256', "{ts}.{nonce}.{sha256(body)}", secret)
 *    dengan header X-BP-Timestamp / X-BP-Nonce / X-BP-Signature.
 *  - Timestamp divalidasi dalam jendela ±5 menit; nonce disimpan di cache
 *    untuk menolak replay; signature dibandingkan timing-safe.
 *  - Webhook memvalidasi nominal terhadap invoice dan dedup berdasarkan event_id.
 */
#[ExtensionMeta(
    name: 'BandrewPay',
    description: 'Gateway QRIS BandrewPay dengan verifikasi pembayaran otomatis & multi-aplikasi (secret per toko).',
    version: '1.1.0',
    author: 'BandrewPay',
    url: '',
)]
class BandrewPay extends Extension
{
    private const SKEW_MS = 300000; // ±5 menit

    // ----------------------------------------------------------
    //  BOOT
    // ----------------------------------------------------------
    public function boot(): void
    {
        require __DIR__ . '/routes.php';
    }

    // ----------------------------------------------------------
    //  CONFIG
    // ----------------------------------------------------------
    public function getConfig($values = []): array
    {
        return [
            [
                'name'        => 'gateway_url',
                'label'       => 'URL Gateway BandrewPay',
                'type'        => 'text',
                'default'     => 'http://localhost:4100',
                'description' => 'Base URL platform BandrewPay (contoh: https://pay.domainmu.com)',
                'required'    => true,
                'validation'  => 'url',
            ],
            [
                'name'        => 'secret_key',
                'label'       => 'Integration Secret',
                'type'        => 'text',
                'description' => "Secret dari aplikasi terdaftar (dashboard BandrewPay > Aplikasi), atau INTEGRATION_SECRET lama bila tanpa X-BP-Key. Minimal 32 karakter.",
                'required'    => true,
            ],
            [
                'name'        => 'app_key',
                'label'       => 'ID Aplikasi (X-BP-Key) — opsional',
                'type'        => 'text',
                'description' => 'ID aplikasi dari dashboard BandrewPay > Aplikasi (mis. APP-1a2b3c4d5e6f). Wajib jika Anda memakai multi-aplikasi; kosongkan untuk secret global lama.',
                'required'    => false,
            ],
            [
                'name'        => 'redirect_url',
                'label'       => 'Redirect Link Setelah Bayar — opsional',
                'type'        => 'text',
                'validation'  => 'nullable|url',
                'description' => 'Halaman tujuan buyer setelah pembayaran sukses. Kosongkan untuk otomatis ke halaman invoice Paymenter.',
                'required'    => false,
            ],
            [
                'name'        => 'paymenter_url',
                'label'       => 'URL Paymenter (untuk webhook)',
                'type'        => 'text',
                'default'     => '',
                'description' => 'URL publik Paymenter ini. Kosongkan untuk auto-detect.',
                'required'    => false,
            ],
            [
                'name'        => 'currency',
                'label'       => 'Kode Mata Uang',
                'type'        => 'text',
                'default'     => 'IDR',
                'description' => 'Gateway ini hanya menerima IDR.',
                'required'    => false,
            ],
        ];
    }

    public function canUseGateway($total, $currency, $type, $items = []): bool
    {
        return strtoupper((string) $currency) === strtoupper($this->config('currency', 'IDR'));
    }

    // ----------------------------------------------------------
    //  PAY — buat transaksi di gateway, redirect buyer ke halaman bayar
    // ----------------------------------------------------------
    public function pay($invoice, $total)
    {
        $gatewayUrl = rtrim($this->config('gateway_url'), '/');
        $secretKey  = $this->config('secret_key');
        $orderId    = 'INV-' . $invoice->id;
        $amount     = (int) round($total);

        $paymenterBase = rtrim($this->config('paymenter_url') ?: request()->getSchemeAndHttpHost(), '/');
        $callbackUrl   = $paymenterBase . '/extensions/bandrewpay/webhook';

        $user          = $invoice->user;
        $customerName  = $user ? ($user->name ?? 'Customer') : 'Customer';
        $customerEmail = $user ? ($user->email ?? '') : '';

        $body = json_encode([
            'order_id'       => $orderId,
            'amount'         => $amount,
            'currency'       => 'IDR',
            'customer_name'  => $customerName,
            'customer_email' => $customerEmail,
            'callback_url'   => $callbackUrl,
            'redirect_url'   => $this->config('redirect_url') ?: ($paymenterBase . '/invoice/' . $invoice->id),
        ], JSON_UNESCAPED_SLASHES);

        if ($body === false) {
            return redirect()->back()->withErrors(['payment' => 'Gagal menyusun payload.']);
        }

        $headers = array_merge([
            'Accept'       => 'application/json',
            'Content-Type' => 'application/json',
        ], $this->signHeaders($secretKey, $body));

        // Multi-aplikasi: identitas app ikut dikirim agar gateway memakai
        // secret aplikasi tersebut (verifikasi & callback).
        $appKey = trim((string) $this->config('app_key'));
        if ($appKey !== '') {
            $headers['X-BP-Key'] = $appKey;
        }

        try {
            $client   = new Client(['timeout' => 15, 'connect_timeout' => 5]);
            $response = $client->post($gatewayUrl . '/api/v1/payments', [
                'json'    => json_decode($body, true),
                'headers' => $headers,
            ]);
            $data = json_decode($response->getBody()->getContents(), true);
        } catch (\Throwable $e) {
            Log::error('[BandrewPay] create payment gagal', ['invoice_id' => $invoice->id, 'error' => $e->getMessage()]);
            return redirect()->back()->withErrors(['payment' => 'Gagal menghubungi payment gateway.']);
        }

        if (! is_array($data) || ! ($data['success'] ?? false)) {
            Log::warning('[BandrewPay] create payment ditolak gateway', ['invoice_id' => $invoice->id, 'response' => $data]);
            return redirect()->back()->withErrors(['payment' => $data['error'] ?? 'Gagal membuat transaksi.']);
        }

        return $data['data']['payment_url'] ?? null;
    }

    // ----------------------------------------------------------
    //  WEBHOOK — tandai invoice paid setelah verifikasi ketat
    // ----------------------------------------------------------
    public function webhook(Request $request): \Illuminate\Http\JsonResponse
    {
        $rawBody  = $request->getContent();
        $tsHeader = $request->header('X-BP-Timestamp');
        $nonce    = $request->header('X-BP-Nonce');
        $sig      = $request->header('X-BP-Signature');
        $secret   = $this->config('secret_key');

        if (! $tsHeader || ! $nonce || ! $sig || $rawBody === '') {
            return response()->json(['success' => false, 'message' => 'Header signature tidak lengkap'], 400);
        }
        if (! preg_match('/^\d{13}$/', (string) $tsHeader)) {
            return response()->json(['success' => false, 'message' => 'Timestamp tidak valid'], 400);
        }
        if (abs((int) (microtime(true) * 1000) - (int) $tsHeader) > self::SKEW_MS) {
            return response()->json(['success' => false, 'message' => 'Timestamp di luar jendela'], 401);
        }

        // Replay protection: nonce unik per event, cache 11 menit (> window).
        $nonceCacheKey = 'bandrewpay_nonce:' . sha256_hex_compat($tsHeader . '.' . $nonce);
        if (Cache::has($nonceCacheKey)) {
            return response()->json(['success' => false, 'message' => 'Nonce sudah dipakai'], 401);
        }

        $expectedSig = hash_hmac('sha256', $tsHeader . '.' . $nonce . '.' . hash('sha256', $rawBody), $secret);
        if (! hash_equals($expectedSig, strtolower((string) $sig))) {
            Log::warning('[BandrewPay] webhook: signature tidak valid');
            return response()->json(['success' => false, 'message' => 'Signature tidak valid'], 403);
        }

        Cache::put($nonceCacheKey, 1, now()->addMinutes(11));

        $payload = json_decode($rawBody, true);
        if (! is_array($payload)) {
            return response()->json(['success' => false, 'message' => 'Payload bukan JSON'], 400);
        }

        $eventId = (string) ($payload['event_id'] ?? '');
        $orderId = (string) ($payload['order_id'] ?? '');
        $status  = strtolower((string) ($payload['status'] ?? ''));
        $amount  = (int) round((float) ($payload['original_amount'] ?? 0));

        if ($eventId === '' || ! preg_match('/^INV-\d+$/', $orderId)) {
            return response()->json(['success' => false, 'message' => 'order_id/event_id tidak valid'], 400);
        }

        // Dedup berbasis event id (gateway boleh retry delivery yang sama).
        $eventCacheKey = 'bandrewpay_event:' . $eventId;
        if (Cache::has($eventCacheKey)) {
            return response()->json(['success' => true, 'message' => 'Event sudah diproses']);
        }

        if ($payload['event'] !== 'payment.paid' || $status !== 'paid') {
            return response()->json(['success' => true, 'message' => 'Status diabaikan']);
        }

        $invoiceId = (int) substr($orderId, 4);
        $invoice   = Invoice::find($invoiceId);
        if (! $invoice) {
            Log::warning('[BandrewPay] webhook: invoice tidak ditemukan', ['invoice_id' => $invoiceId]);
            return response()->json(['success' => false, 'message' => 'Invoice tidak ditemukan'], 404);
        }

        // Validasi nominal: original_amount harus sama dengan total invoice.
        $invoiceTotal = (int) round((float) $invoice->total);
        if ($amount !== $invoiceTotal) {
            Log::error('[BandrewPay] webhook: nominal mismatch', [
                'invoice_id' => $invoiceId,
                'expected'   => $invoiceTotal,
                'received'   => $amount,
            ]);
            return response()->json(['success' => false, 'message' => 'Nominal tidak cocok'], 422);
        }

        if (strtolower((string) $invoice->status) === 'paid') {
            return response()->json(['success' => true, 'message' => 'Invoice sudah dibayar']);
        }

        try {
            $invoice->update([
                'status'  => 'paid',
                'paid_at' => now(),
            ]);

            if (class_exists(\App\Events\Invoice\InvoicePaid::class)) {
                event(new \App\Events\Invoice\InvoicePaid($invoice));
            } elseif (class_exists(\App\Events\InvoicePaid::class)) {
                event(new \App\Events\InvoicePaid($invoice));
            }

            Cache::put($eventCacheKey, 1, now()->addDay());
            Log::info('[BandrewPay] invoice paid via webhook', ['invoice_id' => $invoiceId, 'event_id' => $eventId]);

            return response()->json(['success' => true, 'message' => 'Invoice berhasil diproses']);
        } catch (\Throwable $e) {
            Log::error('[BandrewPay] gagal update invoice', ['invoice_id' => $invoiceId, 'error' => $e->getMessage()]);
            return response()->json(['success' => false, 'message' => 'Server error'], 500);
        }
    }

    // ----------------------------------------------------------
    //  HMAC v2 helper
    // ----------------------------------------------------------
    private function signHeaders(string $secret, string $body): array
    {
        $ts    = (string) (int) (microtime(true) * 1000);
        $nonce = bin2hex(random_bytes(16));
        $sig   = hash_hmac('sha256', $ts . '.' . $nonce . '.' . hash('sha256', $body), $secret);

        return [
            'X-BP-Timestamp' => $ts,
            'X-BP-Nonce'     => $nonce,
            'X-BP-Signature' => $sig,
        ];
    }
}

/** Fallback jika PHP < 8 tanpa fungsi sha256 helper kustom. */
if (! function_exists('sha256_hex_compat')) {
    function sha256_hex_compat(string $value): string
    {
        return hash('sha256', $value);
    }
}
