/**
 * Cloudflare Worker - VAESA ERP API Proxy
 * Ẩn API keys khỏi extension source code
 *
 * Environment Variables (set in Cloudflare dashboard):
 *   ERP_AUTH_KEY    - Auth key cho list endpoints
 *   ORDER_AUTH_KEY  - Auth key cho order create endpoint
 *   ERP_BASE_URL    - https://vaesa.foxia.vn
 */

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': 'https://pancake.vn',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// Allowed list endpoints (whitelist)
const LIST_ENDPOINTS = [
  '/api/vaesa/congtycon/list',
  '/api/vaesa/res_country/list',
  '/api/vaesa/stock_warehouse/list',
  '/api/vaesa/loaidonhang/list',
  '/api/vaesa/nguondaily/list',
  '/api/vaesa/utm_source/list',
  '/api/vaesa/res_users/list',
  '/api/vaesa/product_product/list',
];

export default {
  async fetch(request, env) {
    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }

    // Only allow POST
    if (request.method !== 'POST') {
      return jsonResponse({ error: 'Method not allowed' }, 405);
    }

    const url = new URL(request.url);
    const path = url.pathname;

    try {
      // Route: /api/list/* → forward to ERP list endpoints
      if (path.startsWith('/api/list/')) {
        return await handleList(request, env, path);
      }

      // Route: /api/order/create → forward to order create endpoint
      if (path === '/api/order/create') {
        return await handleOrderCreate(request, env);
      }

      return jsonResponse({ error: 'Not found' }, 404);
    } catch (err) {
      return jsonResponse({ error: err.message }, 500);
    }
  }
};

/**
 * Handle list API requests
 * /api/list/congtycon → /api/vaesa/congtycon/list
 * /api/list/product_product → /api/vaesa/product_product/list
 */
async function handleList(request, env, path) {
  // Extract resource name: /api/list/congtycon → congtycon
  const resource = path.replace('/api/list/', '');
  if (!resource) {
    return jsonResponse({ error: 'Missing resource name' }, 400);
  }

  const erpPath = `/api/vaesa/${resource}/list`;

  // Whitelist check
  if (!LIST_ENDPOINTS.includes(erpPath)) {
    return jsonResponse({ error: 'Invalid endpoint' }, 403);
  }

  const body = await request.text();

  const erpResponse = await fetch(`${env.ERP_BASE_URL}${erpPath}`, {
    method: 'POST',
    headers: {
      'Authorization': env.ERP_AUTH_KEY,
      'Content-Type': 'application/json',
    },
    body: body || '{}',
  });

  const data = await erpResponse.text();
  return new Response(data, {
    status: erpResponse.status,
    headers: {
      ...CORS_HEADERS,
      'Content-Type': 'application/json',
    },
  });
}

/**
 * Handle order create requests
 * /api/order/create → /api/vaesa/sale_order/create
 */
async function handleOrderCreate(request, env) {
  const body = await request.text();

  const erpResponse = await fetch(`${env.ERP_BASE_URL}/api/vaesa/sale_order/create`, {
    method: 'POST',
    headers: {
      'Authorization': env.ORDER_AUTH_KEY,
      'Content-Type': 'application/json',
      'Cookie': 'frontend_lang=vi_VN',
    },
    body,
  });

  const data = await erpResponse.text();
  return new Response(data, {
    status: erpResponse.status,
    headers: {
      ...CORS_HEADERS,
      'Content-Type': 'application/json',
    },
  });
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...CORS_HEADERS,
      'Content-Type': 'application/json',
    },
  });
}
