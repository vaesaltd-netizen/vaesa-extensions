/**
 * Pancake CRM Extension - Background Service Worker
 * Handles API calls to bypass CORS restrictions
 */

// Configuration
const CONFIG = {
  // Google Sheet API for ads mapping
  SHEET_API_URL: 'https://script.google.com/macros/s/AKfycbw3zvxoVF_76VlCDBJnAlWjDyNNrTr9XkA3DqcoWOdyPbULSx0rAVh1mVBJvBdILuM/exec',
  // CRM API for sending customer data
  CRM_API_URL: 'https://vaesa.soly.com.vn/duongdankhachhang/5',
  // Vaesa ERP API for dropdown data (production)
  ERP_API_URL: 'https://vaesa.foxia.vn',
  ERP_AUTH_KEY: '23c9fc77e06a4a645d8c31fefaf1e0abd81c23c5'
};

// Cache for ads mapping - fetched once, used for instant lookup
let adsMapping = null;
let adsMappingLoading = false;

const ADS_CACHE_KEY = 'adsMapping';
const ADS_CACHE_TTL = 6 * 60 * 60 * 1000; // 6 tiếng

async function loadAdsMappingFromStorage() {
  try {
    const result = await chrome.storage.local.get(ADS_CACHE_KEY);
    const cached = result[ADS_CACHE_KEY];
    if (cached && cached.data && (Date.now() - cached.timestamp < ADS_CACHE_TTL)) {
      adsMapping = cached.data;
      console.log('[Pancake CRM] Ads mapping loaded from local cache:', Object.keys(adsMapping).length, 'entries');
      return true;
    }
  } catch (e) {
    console.error('[Pancake CRM] loadAdsMappingFromStorage error:', e);
  }
  return false;
}

async function saveAdsMappingToStorage(data) {
  try {
    await chrome.storage.local.set({
      [ADS_CACHE_KEY]: { data, timestamp: Date.now() }
    });
    console.log('[Pancake CRM] Ads mapping saved to local cache');
  } catch (e) {
    console.error('[Pancake CRM] saveAdsMappingToStorage error:', e);
  }
}

// Cache for ERP dropdown data
let erpSettingsCache = null;
let erpSettingsLoading = false;

/**
 * Listen for messages from content script
 */
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'getSettings') {
    fetchSettings().then(sendResponse);
    return true; // Keep channel open for async response
  }

  if (request.action === 'getAdsNote') {
    fetchAdsNote(request.adsId).then(sendResponse);
    return true;
  }

  if (request.action === 'preloadAdsMapping') {
    fetchAllAdsMapping().then(sendResponse);
    return true;
  }

  if (request.action === 'refreshAdsMapping') {
    adsMapping = null;
    chrome.storage.local.remove(ADS_CACHE_KEY);
    fetchAllAdsMapping().then(sendResponse);
    return true;
  }

  if (request.action === 'sendToCRM') {
    sendToCRM(request.payload).then(sendResponse);
    return true;
  }
});

// Preload ads mapping when service worker starts
(async () => {
  const fromCache = await loadAdsMappingFromStorage();
  if (!fromCache) fetchAllAdsMapping();
})();

/**
 * Fetch dropdown settings from Vaesa ERP API
 * Fetches: Countries, Companies, UTM Sources, Users
 */
async function fetchSettings() {
  // Return cached data if available
  if (erpSettingsCache) {
    return { success: true, data: erpSettingsCache };
  }

  // Prevent multiple simultaneous fetches
  if (erpSettingsLoading) {
    await new Promise(resolve => {
      const checkInterval = setInterval(() => {
        if (!erpSettingsLoading) {
          clearInterval(checkInterval);
          resolve();
        }
      }, 100);
    });
    return { success: true, data: erpSettingsCache || {} };
  }

  erpSettingsLoading = true;
  console.log('[Pancake CRM] Fetching settings from ERP API...');

  try {
    // Fetch all 4 dropdown data in parallel
    const [countriesRes, companiesRes, sourcesRes, usersRes] = await Promise.all([
      fetchERPList('/api/vaesa/res_country/list', [], 500),
      fetchERPList('/api/vaesa/congtycon/list', [], 100),
      fetchERPList('/api/vaesa/utm_source/list', [], 500),
      fetchERPList('/api/vaesa/res_users/list', [['active', '=', true]], 500)
    ]);

    // Transform to dropdown format: { id, name }
    erpSettingsCache = {
      countries: countriesRes.map(item => ({ id: item.id, name: item.name })),
      companies: companiesRes.map(item => ({ id: item.id, name: item.name })),
      sources: sourcesRes.map(item => ({ id: item.id, name: item.name })),
      users: usersRes.map(item => ({ id: item.id, name: item.name }))
    };

    console.log('[Pancake CRM] ERP settings loaded:', {
      countries: erpSettingsCache.countries.length,
      companies: erpSettingsCache.companies.length,
      sources: erpSettingsCache.sources.length,
      users: erpSettingsCache.users.length
    });

    return { success: true, data: erpSettingsCache };
  } catch (error) {
    console.error('[Pancake CRM] fetchSettings error:', error);
    return { success: false, error: error.message };
  } finally {
    erpSettingsLoading = false;
  }
}

/**
 * Fetch list from Vaesa ERP API
 * @param {string} endpoint - API endpoint path
 * @param {Array} domain - Odoo domain filter
 * @param {number} limit - Max records to fetch
 */
async function fetchERPList(endpoint, domain = [], limit = 100) {
  const response = await fetch(`${CONFIG.ERP_API_URL}${endpoint}`, {
    method: 'POST',
    headers: {
      'Authorization': CONFIG.ERP_AUTH_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'call',
      params: { domain, limit, offset: 0 },
      id: Date.now()
    })
  });

  if (!response.ok) {
    throw new Error(`ERP API error: ${response.status}`);
  }

  const data = await response.json();
  return data.result?.items || [];
}

/**
 * Fetch all ads mapping from Google Sheet (batch fetch for performance)
 * Called once, cached in memory for instant lookup
 */
async function fetchAllAdsMapping() {
  // Return memory cache if available
  if (adsMapping) {
    return { success: true, data: adsMapping };
  }

  // Try load from chrome.storage.local first
  const fromCache = await loadAdsMappingFromStorage();
  if (fromCache) {
    return { success: true, data: adsMapping };
  }

  // Prevent multiple simultaneous fetches
  if (adsMappingLoading) {
    await new Promise(resolve => {
      const checkInterval = setInterval(() => {
        if (!adsMappingLoading) {
          clearInterval(checkInterval);
          resolve();
        }
      }, 100);
    });
    return { success: true, data: adsMapping || {} };
  }

  adsMappingLoading = true;
  try {
    const response = await fetch(`${CONFIG.SHEET_API_URL}?action=adsAll`);
    adsMapping = await response.json();
    console.log('[Pancake CRM] Ads mapping fetched from sheet:', Object.keys(adsMapping).length, 'entries');
    await saveAdsMappingToStorage(adsMapping);
    return { success: true, data: adsMapping };
  } catch (error) {
    console.error('fetchAllAdsMapping error:', error);
    return { success: false, error: error.message, data: {} };
  } finally {
    adsMappingLoading = false;
  }
}

/**
 * Get ads note from cached mapping (instant lookup)
 */
async function fetchAdsNote(adsId) {
  // Ensure mapping is loaded
  if (!adsMapping) {
    await fetchAllAdsMapping();
  }

  const note = adsMapping?.[adsId] || '';
  return { success: true, note };
}

/**
 * Extract short error message from CRM response
 * Input: "Tạo thất bại khách hàng. Lỗi: null value in column \"quocgia_id\" of relation... DETAIL: ..."
 * Output: "Thiếu trường: quocgia_id" hoặc short message
 */
function extractShortError(fullError) {
  if (!fullError) return 'Lỗi không xác định';

  const str = String(fullError);

  // Pattern: null value in column "xxx"
  const nullMatch = str.match(/null value in column [\\"]?([^"\\\s]+)[\\"]?/i);
  if (nullMatch) {
    const field = nullMatch[1];
    // Map field names to Vietnamese
    const fieldMap = {
      'quocgia_id': 'Quốc gia',
      'congtycon_id': 'Công ty con',
      'nguonkhachhang_id': 'Nguồn khách hàng',
      'nhanvienkinhdoanh_id': 'Nhân viên kinh doanh',
      'tenkhachhang': 'Tên khách hàng',
      'sodienthoai': 'Số điện thoại'
    };
    const fieldName = fieldMap[field] || field;
    return `Thiếu trường: ${fieldName}`;
  }

  // Pattern: "Lỗi: xxx" - extract just the error part before DETAIL
  const errorMatch = str.match(/Lỗi:\s*([^\\n]+?)(?:\s*DETAIL:|$)/i);
  if (errorMatch) {
    let msg = errorMatch[1].trim();
    // Truncate if too long
    if (msg.length > 80) msg = msg.substring(0, 80) + '...';
    return msg;
  }

  // Truncate long messages
  if (str.length > 100) {
    return str.substring(0, 100) + '...';
  }

  return str;
}

/**
 * Send customer data to CRM API
 */
async function sendToCRM(payload) {
  console.log('[Pancake CRM] Sending to CRM:', CONFIG.CRM_API_URL);
  console.log('[Pancake CRM] Payload:', JSON.stringify(payload, null, 2));

  try {
    const response = await fetch(CONFIG.CRM_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    console.log('[Pancake CRM] Response status:', response.status, response.statusText);

    // Parse response body (could be JSON with error message)
    const responseText = await response.text();
    let responseData;
    try {
      responseData = JSON.parse(responseText);
    } catch (e) {
      responseData = { message: responseText };
    }

    console.log('[Pancake CRM] Response body:', responseText);

    if (!response.ok) {
      // Extract detailed error message from API response
      const errorMsg = extractShortError(responseData?.message || responseData?.error || `HTTP ${response.status}`);
      console.error('[Pancake CRM] Error:', errorMsg);
      return { success: false, error: errorMsg };
    }

    // Check if API returns success:false in body (like CRM does)
    if (responseData?.success === false || responseData?.success === 'false') {
      const errorMsg = extractShortError(responseData?.message || responseData?.error || 'Lỗi không xác định');
      console.error('[Pancake CRM] API error:', errorMsg);
      return { success: false, error: errorMsg };
    }

    console.log('[Pancake CRM] Success');
    return { success: true, data: responseData };
  } catch (error) {
    console.error('[Pancake CRM] sendToCRM error:', error);
    return { success: false, error: error.message };
  }
}
