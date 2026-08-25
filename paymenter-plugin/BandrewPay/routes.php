<?php

use Illuminate\Support\Facades\Route;
use Paymenter\Extensions\Gateways\BandrewPay\BandrewPay;

/*
|--------------------------------------------------------------------------
| BandrewPay Webhook Route
|--------------------------------------------------------------------------
|
| Dipanggil BandrewPay gateway setelah pembayaran PAID terverifikasi.
| Dilindungi HMAC v2 + timestamp + nonce replay cache (lihat BandrewPay::webhook).
|
| URL webhook: https://{paymenter-url}/extensions/bandrewpay/webhook
|
*/

Route::post(
    '/extensions/bandrewpay/webhook',
    [BandrewPay::class, 'webhook']
)->name('bandrewpay.webhook');
