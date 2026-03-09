/**
 * Pancake CRM Extension - Content Script
 * Injects floating button and popup form into pancake.vn
 * Features: XHR/Fetch interception, draggable button, form auto-fill
 */

(function() {
  'use strict';

  // State - closure-scoped for security (not exposed to window)
  let currentData = {};
  let settingsData = null;
  let reduxData = null; // Data from Redux store (via injected script)
  let lastConversationId = null; // Track conversation changes

  // LocalStorage key for saved dropdown selections
  const STORAGE_KEY = 'pancake-crm-dropdown-selections';

  // ============================================
  // REDUX DATA EXTRACTION
  // Inject external script to bypass CSP and read from main world's Redux store
  // ============================================

  let injectedScriptReady = false;

  /**
   * Inject the external script into page's main world
   * This bypasses CSP because it's a file, not inline script
   */
  function injectScript() {
    if (document.getElementById('pancake-crm-injected')) return;

    const script = document.createElement('script');
    script.id = 'pancake-crm-injected';
    script.src = chrome.runtime.getURL('injected.js');
    script.onload = function() {
      injectedScriptReady = true;
      console.log('[Pancake CRM] Injected script loaded');
    };
    (document.head || document.documentElement).appendChild(script);
  }

  /**
   * Request data from Redux store
   * Returns Promise with extracted data
   */
  function requestReduxData() {
    return new Promise((resolve) => {
      // Generate unique request ID
      const requestId = 'pcrm_' + Date.now();

      // Listen for response
      const handler = function(e) {
        if (e.detail?.requestId === requestId) {
          window.removeEventListener('pancake-crm-response', handler);
          resolve(e.detail);
        }
      };
      window.addEventListener('pancake-crm-response', handler);

      // Dispatch request event
      window.dispatchEvent(new CustomEvent('pancake-crm-request', {
        detail: { requestId }
      }));

      // Timeout after 500ms
      setTimeout(() => {
        window.removeEventListener('pancake-crm-response', handler);
        resolve({ error: 'Timeout' });
      }, 500);
    });
  }

  // Inject script when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectScript);
  } else {
    injectScript();
  }

  console.log('[Pancake CRM] Extension loaded');

  // ============================================
  // DOM ELEMENTS - Wait for DOM to be ready
  // ============================================

  function initUI() {
    // Prevent duplicate injection
    if (document.getElementById('pancake-crm-btn')) return;

    // SVG Icons (Heroicons)
    const ICONS = {
      scan: '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" /></svg>',
      send: '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" /></svg>',
      logo: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" fill="none"><rect x="2" y="2" width="28" height="28" rx="7" fill="white"/><ellipse cx="12" cy="10" rx="5" ry="2.5" stroke="#0891B2" stroke-width="1.8"/><path d="M7 10v8c0 1.4 2.2 2.5 5 2.5s5-1.1 5-2.5v-8" stroke="#0891B2" stroke-width="1.8"/><path d="M7 14c0 1.4 2.2 2.5 5 2.5s5-1.1 5-2.5" stroke="#0891B2" stroke-width="1.8"/><path d="M19 16l5 0" stroke="#0891B2" stroke-width="2" stroke-linecap="round"/><path d="M22 13l3 3-3 3" stroke="#0891B2" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
      success: '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>',
      error: '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" /></svg>',
      loading: '<div class="pcrm-spinner"></div>',
      openLink: '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" /></svg>'
    };

  // Create floating button
  const btn = document.createElement('button');
  btn.id = 'pancake-crm-btn';
  btn.innerHTML = ICONS.send;
  btn.title = 'Pancake → CRM';
  document.body.appendChild(btn);

  // Create popup - Compact design, no scroll needed
  const popup = document.createElement('div');
  popup.id = 'pancake-crm-popup';
  popup.innerHTML = `
    <button class="pcrm-close" aria-label="Đóng">×</button>

    <div class="pcrm-header">
      <span class="pcrm-logo">${ICONS.logo}</span>
      <div class="pcrm-header-text">
        <h2>Pancake To CRM</h2>
        <span class="pcrm-subtitle">Đồng bộ dữ liệu khách hàng</span>
      </div>
    </div>

    <div class="pcrm-content">
      <div class="pcrm-field">
        <label>Tên Khách Hàng</label>
        <input type="text" id="pcrm-name" readonly placeholder="Chưa có dữ liệu">
      </div>

      <div class="pcrm-field">
        <label>Số Điện Thoại</label>
        <input type="text" id="pcrm-phone" placeholder="Nhập số điện thoại">
      </div>

      <div class="pcrm-field pcrm-field-link">
        <label>ID Hội Thoại</label>
        <input type="text" id="pcrm-facebook" readonly placeholder="Chưa có dữ liệu">
        <button class="pcrm-open" data-target="pcrm-facebook" aria-label="Mở trong tab mới">${ICONS.openLink}</button>
      </div>

      <div class="pcrm-field">
        <label>ID Khách Hàng</label>
        <input type="text" id="pcrm-fbid" readonly placeholder="Chưa có dữ liệu">
      </div>

      <div class="pcrm-field pcrm-field-link">
        <label>Link Page</label>
        <input type="text" id="pcrm-linkpage" readonly placeholder="Chưa có dữ liệu">
        <button class="pcrm-open" data-target="pcrm-linkpage" aria-label="Mở trong tab mới">${ICONS.openLink}</button>
      </div>

      <div class="pcrm-field">
        <label>Ghi Chú</label>
        <input type="text" id="pcrm-note" placeholder="Tự động từ Ads ID">
      </div>

      <div class="pcrm-field">
        <label>Quốc Gia</label>
        <select id="pcrm-country" aria-label="Quốc gia"><option value="">Chọn quốc gia</option></select>
      </div>

      <div class="pcrm-field">
        <label>Công Ty Con</label>
        <select id="pcrm-company" aria-label="Công ty"><option value="">Chọn công ty</option></select>
      </div>

      <div class="pcrm-field pcrm-field-search">
        <label>Nguồn Khách Hàng</label>
        <div class="pcrm-search-wrapper">
          <input type="text" id="pcrm-source-search" placeholder="Tìm hoặc chọn nguồn..." autocomplete="off">
          <button type="button" class="pcrm-dropdown-toggle" id="pcrm-source-toggle" aria-label="Mở danh sách">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>
          </button>
        </div>
        <input type="hidden" id="pcrm-source" value="">
        <div class="pcrm-dropdown" id="pcrm-source-dropdown"></div>
      </div>

      <div class="pcrm-field pcrm-field-search">
        <label>Nhân Viên Kinh Doanh</label>
        <div class="pcrm-search-wrapper">
          <input type="text" id="pcrm-staff-search" placeholder="Tìm hoặc chọn nhân viên..." autocomplete="off">
          <button type="button" class="pcrm-dropdown-toggle" id="pcrm-staff-toggle" aria-label="Mở danh sách">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>
          </button>
        </div>
        <input type="hidden" id="pcrm-staff" value="">
        <div class="pcrm-dropdown" id="pcrm-staff-dropdown"></div>
      </div>

      <div class="pcrm-status" id="pcrm-status"></div>

      <div class="pcrm-actions">
        <button class="pcrm-btn pcrm-btn-scan" id="pcrm-scan">
          ${ICONS.scan} Quét
        </button>
        <button class="pcrm-btn pcrm-btn-send" id="pcrm-send">
          ${ICONS.send} Gửi
        </button>
      </div>
    </div>
  `;
  document.body.appendChild(popup);

  // Elements
  const closeBtn = popup.querySelector('.pcrm-close');
  const scanBtn = document.getElementById('pcrm-scan');
  const sendBtn = document.getElementById('pcrm-send');
  const statusEl = document.getElementById('pcrm-status');

  /**
   * Position popup relative to button - responsive positioning
   */
  function positionPopup() {
    const btnRect = btn.getBoundingClientRect();
    const viewportW = window.innerWidth;
    const viewportH = window.innerHeight;
    const margin = 12;

    // Get popup width based on viewport (matches CSS media queries)
    let popupWidth = 340;
    if (viewportH <= 580) popupWidth = 280;
    else if (viewportH <= 700) popupWidth = 300;

    // Try position to the left of button first
    let left = btnRect.left - popupWidth - margin;
    let top = btnRect.top;

    // If popup goes off left edge, position below button instead
    if (left < margin) {
      left = Math.max(margin, Math.min(btnRect.left, viewportW - popupWidth - margin));
      top = btnRect.bottom + margin;
    }

    // Keep within viewport vertically
    if (top < margin) top = margin;

    popup.style.top = top + 'px';
    popup.style.left = left + 'px';
  }

  // Click button: toggle popup (open/close)
  btn.addEventListener('click', async (e) => {
    if (btn.classList.contains('dragging')) return;

    // Toggle: if open or closing, close it
    if (popup.classList.contains('show') || popup.classList.contains('closing')) {
      closePopup();
      return;
    }

    // Position and show popup
    positionPopup();
    popup.classList.add('show');

    // Load settings if not loaded
    if (!settingsData) {
      loadSettings();
    }

    // Auto-scan data
    await scanPancakeData();
  });

  closeBtn.addEventListener('click', () => {
    closePopup();
  });

  /**
   * Close popup with animation
   */
  function closePopup() {
    if (!popup.classList.contains('show')) return;

    popup.classList.remove('show');
    popup.classList.add('closing');

    // Wait for animation to complete before hiding
    popup.addEventListener('animationend', function handler() {
      popup.classList.remove('closing');
      popup.removeEventListener('animationend', handler);
    }, { once: true });
  }

  // Close popup when clicking outside
  document.addEventListener('click', (e) => {
    if (!popup.contains(e.target) && e.target !== btn && popup.classList.contains('show')) {
      // Don't close if clicking inside popup
    }
  });

  // Make button draggable
  makeDraggable(btn);

  // Scan button
  scanBtn.addEventListener('click', scanPancakeData);

  // Send button
  sendBtn.addEventListener('click', sendToCRM);

  // Open link buttons - delegate event
  popup.addEventListener('click', (e) => {
    const openBtn = e.target.closest('.pcrm-open');
    if (!openBtn) return;

    const targetId = openBtn.dataset.target;
    const input = document.getElementById(targetId);
    if (!input || !input.value) return;

    // Open URL in new tab
    window.open(input.value, '_blank');
  });

  /**
   * Load settings from Google Sheet
   */
  function loadSettings() {
    showStatus('Đang tải cấu hình...', 'loading');

    chrome.runtime.sendMessage({ action: 'getSettings' }, (response) => {
      if (chrome.runtime.lastError) {
        showStatus('Lỗi kết nối extension: ' + chrome.runtime.lastError.message, 'error');
        return;
      }

      if (response && response.success) {
        settingsData = response.data;
        populateDropdowns();
        hideStatus();
      } else {
        showStatus('Lỗi tải cấu hình: ' + (response?.error || 'Kiểm tra lại URL Google Sheet'), 'error');
      }
    });
  }

  /**
   * Load saved dropdown selections from localStorage
   */
  function loadSavedSelections() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      return saved ? JSON.parse(saved) : {};
    } catch (e) {
      return {};
    }
  }

  /**
   * Save dropdown selections to localStorage
   */
  function saveSelections() {
    const selections = {
      'pcrm-country': document.getElementById('pcrm-country')?.value || '',
      'pcrm-company': document.getElementById('pcrm-company')?.value || '',
      'pcrm-source': document.getElementById('pcrm-source')?.value || '',
      'pcrm-staff': document.getElementById('pcrm-staff')?.value || ''
    };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(selections));
    } catch (e) {
      // Ignore storage errors
    }
  }

  // Store options for searchable dropdowns
  let sourceOptions = [];
  let staffOptions = [];

  /**
   * Populate dropdowns with settings data from ERP API
   * Data format: { id, name } objects
   */
  function populateDropdowns() {
    if (!settingsData) return;

    const saved = loadSavedSelections();

    // Regular selects
    fillSelect('pcrm-country', settingsData.countries || [], saved['pcrm-country']);
    fillSelect('pcrm-company', settingsData.companies || [], saved['pcrm-company']);

    // Searchable dropdowns
    sourceOptions = settingsData.sources || [];
    staffOptions = settingsData.users || [];

    initSearchableDropdown('pcrm-source', sourceOptions, saved['pcrm-source']);
    initSearchableDropdown('pcrm-staff', staffOptions, saved['pcrm-staff']);
  }

  /**
   * Fill select element with options
   * @param {string} id - Select element ID
   * @param {Array} options - Array of { id, name } objects
   * @param {string} savedValue - Previously saved value (id)
   */
  function fillSelect(id, options, savedValue) {
    const select = document.getElementById(id);
    if (!select) return;

    const placeholder = select.querySelector('option');

    // Keep first option (placeholder)
    select.innerHTML = placeholder ? placeholder.outerHTML : '<option value="">-- Chọn --</option>';

    options.forEach(opt => {
      if (!opt || !opt.id) return;
      const option = document.createElement('option');
      option.value = opt.id; // Use ID as value for CRM API
      option.textContent = opt.name; // Display name to user
      select.appendChild(option);
    });

    // Restore saved value if exists
    if (savedValue) select.value = savedValue;
  }

  /**
   * Initialize searchable dropdown with toggle button
   * @param {string} id - Hidden input ID (stores selected value)
   * @param {Array} options - Array of { id, name } objects
   * @param {string} savedValue - Previously saved value (id)
   */
  function initSearchableDropdown(id, options, savedValue) {
    const hiddenInput = document.getElementById(id);
    const searchInput = document.getElementById(id + '-search');
    const dropdown = document.getElementById(id + '-dropdown');
    const toggleBtn = document.getElementById(id + '-toggle');

    if (!hiddenInput || !searchInput || !dropdown) return;

    // Helper to select item
    const selectItem = (item) => {
      hiddenInput.value = item.id;
      searchInput.value = item.name;
      dropdown.classList.remove('show');
      toggleBtn?.classList.remove('open');
    };

    // Restore saved value
    if (savedValue) {
      const savedItem = options.find(opt => String(opt.id) === String(savedValue));
      if (savedItem) {
        hiddenInput.value = savedItem.id;
        searchInput.value = savedItem.name;
      }
    }

    // Toggle button - show all options
    if (toggleBtn) {
      toggleBtn.addEventListener('mousedown', (e) => {
        e.preventDefault(); // Prevent blur on search input

        if (dropdown.classList.contains('show')) {
          dropdown.classList.remove('show');
          toggleBtn.classList.remove('open');
        } else {
          // Show all options (limit 50 for performance)
          renderDropdown(dropdown, options.slice(0, 50), selectItem);
          dropdown.classList.add('show');
          toggleBtn.classList.add('open');
          searchInput.focus();
        }
      });
    }

    // Filter and show dropdown on input
    searchInput.addEventListener('input', () => {
      const query = searchInput.value.toLowerCase().trim();
      hiddenInput.value = ''; // Clear selection when typing

      if (query.length < 1) {
        // Show all options when input is empty but focused
        renderDropdown(dropdown, options.slice(0, 50), selectItem);
        dropdown.classList.add('show');
        toggleBtn?.classList.add('open');
        return;
      }

      const filtered = options.filter(opt =>
        opt.name.toLowerCase().includes(query)
      ).slice(0, 20); // Limit to 20 results when searching

      renderDropdown(dropdown, filtered, selectItem);
      dropdown.classList.add('show');
      toggleBtn?.classList.add('open');
    });

    // Show dropdown on focus
    searchInput.addEventListener('focus', () => {
      const query = searchInput.value.toLowerCase().trim();

      if (query.length < 1) {
        // Show all options when empty
        renderDropdown(dropdown, options.slice(0, 50), selectItem);
      } else {
        const filtered = options.filter(opt =>
          opt.name.toLowerCase().includes(query)
        ).slice(0, 20);
        renderDropdown(dropdown, filtered, selectItem);
      }

      dropdown.classList.add('show');
      toggleBtn?.classList.add('open');
    });

    // Hide dropdown on blur (with delay for click)
    searchInput.addEventListener('blur', () => {
      setTimeout(() => {
        dropdown.classList.remove('show');
        toggleBtn?.classList.remove('open');
      }, 150);
    });

    // Close on escape
    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        dropdown.classList.remove('show');
        toggleBtn?.classList.remove('open');
        searchInput.blur();
      }
    });
  }

  /**
   * Render dropdown items
   */
  function renderDropdown(dropdown, items, onSelect) {
    dropdown.innerHTML = '';

    if (items.length === 0) {
      dropdown.innerHTML = '<div class="pcrm-dropdown-empty">Không tìm thấy</div>';
      return;
    }

    items.forEach(item => {
      const div = document.createElement('div');
      div.className = 'pcrm-dropdown-item';
      div.textContent = item.name;
      div.addEventListener('mousedown', (e) => {
        e.preventDefault(); // Prevent blur
        onSelect(item);
      });
      dropdown.appendChild(div);
    });
  }

  /**
   * Scan current Pancake conversation data
   * Requests data from Redux store via injected script
   */
  async function scanPancakeData() {
    showStatus('Đang quét dữ liệu...', 'loading');

    // Request data from Redux store
    const result = await requestReduxData();

    if (result.success && result.data?.name) {
      console.log('[Pancake CRM] ✓ Got data:', result.data);

      // Extract page_id: prefer Redux, fallback to URL patterns
      // Support both /pages/123/conversations/ and /multi_pages patterns
      let pageId = result.data.pageId;
      if (!pageId) {
        const urlMatch = window.location.href.match(/pages\/(\d+)/);
        pageId = urlMatch ? urlMatch[1] : '';
      }

      // Detect TikTok and get profile ID
      const isTikTok = result.data.isTikTok || false;
      const ttUniqueId = result.data.ttUniqueId || '';
      const conversationId = result.data.conversationId || ''; // Pancake conversation ID
      let profileId = '';

      if (isTikTok && ttUniqueId) {
        // TikTok: use username directly as ID
        profileId = ttUniqueId;
      } else if (result.data.globalId) {
        // Facebook: use global_id as ID
        profileId = result.data.globalId;
      }

      currentData = {
        name: result.data.name,
        phone: result.data.phone || '',
        fbId: profileId, // TikTok username or Facebook global_id
        globalId: result.data.globalId || '',
        pageId,
        adsId: result.data.adsId || '',
        facebook: conversationId, // Pancake conversation ID (e.g., 786439674562387_25295945770063202)
        linkPageFacebook: pageId ? `https://facebook.com/${pageId}` : '',
        isTikTok
      };

      console.log('[Pancake CRM] pageId:', pageId, 'adsId:', currentData.adsId);

      // Fill form - clear all fields first, then populate with new data
      document.getElementById('pcrm-name').value = currentData.name;
      document.getElementById('pcrm-phone').value = currentData.phone;
      document.getElementById('pcrm-facebook').value = currentData.facebook;
      document.getElementById('pcrm-fbid').value = currentData.fbId;
      document.getElementById('pcrm-linkpage').value = currentData.linkPageFacebook;
      document.getElementById('pcrm-note').value = ''; // Clear old note first

      // Lookup ads note if ads_id exists
      if (currentData.adsId) {
        chrome.runtime.sendMessage({
          action: 'getAdsNote',
          adsId: currentData.adsId
        }, (response) => {
          if (response && response.note) {
            document.getElementById('pcrm-note').value = response.note;
          }
        });
      }

      showStatus('Đã quét thành công!', 'success');
      setTimeout(hideStatus, 2500);
    } else {
      console.log('[Pancake CRM] Scan failed:', result.error || 'No data');
      showStatus('Không tìm thấy dữ liệu. Vui lòng mở một conversation và thử lại.', 'error');
    }
  }

  /**
   * Extract data from Pancake page
   * Uses data from Redux store (via injected main world script)
   */
  function extractPancakeData() {
    try {
      // Extract page_id from URL
      const urlMatch = window.location.href.match(/pages\/(\d+)\/conversations\/(\d+_\d+)/);
      let pageId = urlMatch ? urlMatch[1] : null;

      // Request fresh data from Redux store
      window.dispatchEvent(new CustomEvent('pancake-crm-request'));

      // Use cached reduxData (will be updated by response handler)
      if (reduxData && reduxData.name) {
        console.log('[Pancake CRM] Using Redux data:', reduxData.name);

        // Detect TikTok and get profile ID
        const isTikTok = reduxData.isTikTok || false;
        const ttUniqueId = reduxData.ttUniqueId || '';
        const conversationId = reduxData.conversationId || '';
        let profileId = '';

        if (isTikTok && ttUniqueId) {
          profileId = ttUniqueId;
        } else if (reduxData.globalId) {
          profileId = reduxData.globalId;
        }

        return {
          name: reduxData.name,
          phone: reduxData.phone || '',
          fbId: profileId,
          globalId: reduxData.globalId || '',
          pageId,
          adsId: reduxData.adsId || '',
          facebook: conversationId, // Pancake conversation ID
          linkPageFacebook: pageId ? `https://facebook.com/${pageId}` : '',
          isTikTok
        };
      }

      console.log('[Pancake CRM] No Redux data available yet');
      return null;
    } catch (e) {
      console.error('[Pancake CRM] extractPancakeData error:', e);
      return null;
    }
  }

  /**
   * Get selected text from dropdown (for regular select or searchable dropdown)
   */
  function getDropdownText(id) {
    const el = document.getElementById(id);
    if (!el) return '';

    // For regular select - get selected option text
    if (el.tagName === 'SELECT') {
      return el.options[el.selectedIndex]?.text || '';
    }
    // For searchable dropdown - get text from search input
    const searchInput = document.getElementById(id + '-search');
    return searchInput?.value || '';
  }

  /**
   * Send data to CRM
   * Field names match CRM API format
   */
  function sendToCRM() {
    const payload = {
      tenkhachhang: document.getElementById('pcrm-name').value,
      sodienthoai: document.getElementById('pcrm-phone').value,
      facebook: document.getElementById('pcrm-facebook').value,
      idfacebook: document.getElementById('pcrm-fbid').value,
      linkpagefacebook: document.getElementById('pcrm-linkpage').value,
      khachhangghichu: document.getElementById('pcrm-note').value,
      // Dropdown fields
      quocgia: getDropdownText('pcrm-country'),
      congtycon: getDropdownText('pcrm-company'),
      nguonkhachhang: getDropdownText('pcrm-source'),
      nhanvienkinhdoanh: getDropdownText('pcrm-staff')
    };

    // Validate required fields
    if (!payload.tenkhachhang) {
      showStatus('Vui lòng bấm Quét để lấy dữ liệu trước!', 'error');
      return;
    }

    showStatus('Đang gửi về CRM...', 'loading');
    sendBtn.disabled = true;

    chrome.runtime.sendMessage({
      action: 'sendToCRM',
      payload
    }, (response) => {
      sendBtn.disabled = false;

      if (chrome.runtime.lastError) {
        showStatus('Lỗi kết nối: ' + chrome.runtime.lastError.message, 'error');
        return;
      }

      if (response && response.success) {
        showStatus('Gửi thành công!', 'success');
        // Save dropdown selections for next time
        saveSelections();
        // Clear form after success
        setTimeout(() => {
          document.getElementById('pcrm-name').value = '';
          document.getElementById('pcrm-phone').value = '';
          document.getElementById('pcrm-facebook').value = '';
          document.getElementById('pcrm-fbid').value = '';
          document.getElementById('pcrm-linkpage').value = '';
          document.getElementById('pcrm-note').value = '';
          currentData = {};
          hideStatus();
        }, 2000);
      } else {
        showStatus('Lỗi: ' + (response?.error || 'Không thể gửi về CRM'), 'error');
      }
    });
  }

  /**
   * Make element draggable
   */
  function makeDraggable(el) {
    let isDragging = false;
    let hasMoved = false;
    let startX, startY, startLeft, startTop;

    el.addEventListener('mousedown', (e) => {
      isDragging = true;
      hasMoved = false;
      startX = e.clientX;
      startY = e.clientY;

      const rect = el.getBoundingClientRect();
      startLeft = rect.left;
      startTop = rect.top;

      // Don't add dragging class yet - only when actually moved
      e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
      if (!isDragging) return;

      const dx = e.clientX - startX;
      const dy = e.clientY - startY;

      // Consider it a drag if moved more than 5px
      if (Math.abs(dx) > 5 || Math.abs(dy) > 5) {
        hasMoved = true;
        el.classList.add('dragging');
      }

      el.style.right = 'auto';
      el.style.bottom = 'auto';
      el.style.left = Math.max(0, Math.min(window.innerWidth - el.offsetWidth, startLeft + dx)) + 'px';
      el.style.top = Math.max(0, Math.min(window.innerHeight - el.offsetHeight, startTop + dy)) + 'px';
    });

    document.addEventListener('mouseup', () => {
      if (isDragging) {
        isDragging = false;
        // Delay removing dragging class to prevent click
        setTimeout(() => {
          el.classList.remove('dragging');
        }, hasMoved ? 100 : 0);
      }
    });
  }

  /**
   * Status helpers
   */
  function showStatus(msg, type) {
    let icon = '';
    if (type === 'success') icon = ICONS.success;
    else if (type === 'error') icon = ICONS.error;
    else if (type === 'loading') icon = ICONS.loading;

    statusEl.innerHTML = icon + '<span>' + msg + '</span>';
    statusEl.className = 'pcrm-status show ' + type;
  }

  function hideStatus() {
    statusEl.className = 'pcrm-status';
  }

  /**
   * Clear all form fields
   */
  function clearForm() {
    document.getElementById('pcrm-name').value = '';
    document.getElementById('pcrm-phone').value = '';
    document.getElementById('pcrm-facebook').value = '';
    document.getElementById('pcrm-fbid').value = '';
    document.getElementById('pcrm-linkpage').value = '';
    document.getElementById('pcrm-note').value = '';
    currentData = {};
    hideStatus();
    console.log('[Pancake CRM] Form cleared');
  }

  /**
   * Watch for conversation changes via Redux state
   * Injected script dispatches 'pancake-crm-conv-changed' event
   * Auto-scan new conversation data, keep popup open for user control
   */
  window.addEventListener('pancake-crm-conv-changed', async (e) => {
    console.log('[Pancake CRM] Conversation changed, auto-scanning...');
    // Only auto-scan if popup is open
    if (popup.classList.contains('show')) {
      await scanPancakeData();
    }
  });

  /**
   * Listen for Facebook URL captured from avatar click
   * When user clicks avatar, injected.js intercepts window.open and captures FB URL
   * Auto-fill form with ID (not full URL) if global_id was missing
   */
  window.addEventListener('pancake-crm-fb-url-captured', (e) => {
    const capturedUrl = e.detail?.url || '';
    if (!capturedUrl) return;

    console.log('[Pancake CRM] FB URL captured from avatar click:', capturedUrl);

    // Extract global_id from URL (e.g., https://facebook.com/100001234567890)
    const match = capturedUrl.match(/facebook\.com\/(\d+)/);
    const globalId = match ? match[1] : '';

    if (!globalId) {
      console.log('[Pancake CRM] Could not extract ID from URL');
      showStatus('Không thể lấy ID từ URL', 'error');
      setTimeout(hideStatus, 2000);
      return;
    }

    // Update form fields with ID only (not full URL)
    const fbField = document.getElementById('pcrm-facebook');
    const fbIdField = document.getElementById('pcrm-fbid');

    // ID Hội Thoại: điền ID thay vì full URL
    if (fbField && !fbField.value) {
      fbField.value = globalId;
      console.log('[Pancake CRM] Updated ID Hội Thoại field:', globalId);
    }

    // ID Khách Hàng: điền ID
    if (fbIdField && !fbIdField.value) {
      fbIdField.value = globalId;
      console.log('[Pancake CRM] Updated ID Khách Hàng field:', globalId);
    }

    // Update currentData with ID only
    if (!currentData.facebook) currentData.facebook = globalId;
    if (!currentData.fbId) currentData.fbId = globalId;
    if (!currentData.globalId) currentData.globalId = globalId;

    // Show brief success notification
    showStatus('Đã lấy ID từ avatar!', 'success');
    setTimeout(hideStatus, 2000);
  });

  console.log('[Pancake CRM] UI initialized');

  } // End of initUI function

  // ============================================
  // INITIALIZATION - Wait for DOM then init UI
  // ============================================

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initUI);
  } else {
    // DOM already loaded
    initUI();
  }

})();
