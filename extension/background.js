// ── Configuration ─────────────────────────────────────────────────────────────
// Set API_BASE to your deployed Render.com URL, or keep localhost for local dev.
const DEFAULT_API_BASE = "http://localhost:8000";
const CACHE_KEY = "golink_cache";
const TOKEN_KEY = "golink_token";
const API_BASE_KEY = "golink_api_base";
const SYNC_ALARM = "golink_sync";
const SYNC_INTERVAL_MINUTES = 30;

// ── Lifecycle ─────────────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(SYNC_ALARM, { periodInMinutes: SYNC_INTERVAL_MINUTES });
  syncLinks();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === SYNC_ALARM) syncLinks();
});

// ── Navigation intercept ──────────────────────────────────────────────────────

chrome.webNavigation.onBeforeNavigate.addListener(
  async (details) => {
    // Only handle main frame navigations to http://go/*
    if (details.frameId !== 0) return;

    const url = new URL(details.url);
    // hostname should be exactly "go"
    if (url.hostname !== "go") return;

    const slug = url.pathname.replace(/^\//, "") || url.search.replace(/^\?/, "");
    if (!slug) return;

    const target = await resolveSlug(slug);
    if (target) {
      chrome.tabs.update(details.tabId, { url: target });
    } else {
      chrome.tabs.update(details.tabId, {
        url: `${await getApiBase()}/go/${slug}`,
      });
    }
  },
  { url: [{ hostEquals: "go", schemes: ["http"] }] }
);

// ── Resolution logic ──────────────────────────────────────────────────────────

async function resolveSlug(slug) {
  const cache = await getCache();
  if (cache[slug]) {
    console.log(`GoLink: cache hit for '${slug}' → ${cache[slug].url}`);
    return cache[slug].url;
  }
  console.log(`GoLink: cache miss for '${slug}', falling back to API`);
  return null;
}

// ── Sync ──────────────────────────────────────────────────────────────────────

async function syncLinks() {
  const [token, apiBase] = await Promise.all([getToken(), getApiBase()]);
  if (!token) {
    console.warn("GoLink: no token set, skipping sync");
    return;
  }

  try {
    const response = await fetch(`${apiBase}/api/links`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (response.status === 401) {
      console.warn("GoLink: token rejected (401), clearing token");
      await chrome.storage.local.remove(TOKEN_KEY);
      return;
    }

    if (!response.ok) {
      console.error(`GoLink: sync failed with status ${response.status}`);
      return;
    }

    const links = await response.json();
    const cache = {};
    for (const link of links) {
      cache[link.slug] = { url: link.url, description: link.description };
    }

    await chrome.storage.local.set({
      [CACHE_KEY]: cache,
      last_sync: new Date().toISOString(),
    });

    console.log(`GoLink: synced ${links.length} links`);
  } catch (err) {
    console.error("GoLink: sync error", err);
  }
}

// ── Storage helpers ───────────────────────────────────────────────────────────

async function getCache() {
  const result = await chrome.storage.local.get(CACHE_KEY);
  return result[CACHE_KEY] || {};
}

async function getToken() {
  const result = await chrome.storage.local.get(TOKEN_KEY);
  return result[TOKEN_KEY] || null;
}

async function getApiBase() {
  const result = await chrome.storage.local.get(API_BASE_KEY);
  return result[API_BASE_KEY] || DEFAULT_API_BASE;
}

// ── Message handler (from popup) ──────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  switch (message.type) {
    case "sync":
      syncLinks().then(() => sendResponse({ success: true }));
      return true; // keep channel open for async response

    case "setToken":
      chrome.storage.local.set({ [TOKEN_KEY]: message.token }).then(() =>
        sendResponse({ success: true })
      );
      return true;

    case "setApiBase":
      chrome.storage.local.set({ [API_BASE_KEY]: message.apiBase }).then(() =>
        sendResponse({ success: true })
      );
      return true;

    case "getStatus":
      Promise.all([
        getCache(),
        getApiBase(),
        chrome.storage.local.get(["last_sync", TOKEN_KEY]),
      ]).then(([cache, apiBase, stored]) => {
        sendResponse({
          linkCount: Object.keys(cache).length,
          lastSync: stored.last_sync || null,
          hasToken: !!stored[TOKEN_KEY],
          apiBase,
        });
      });
      return true;
  }
});
