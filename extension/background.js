// ── Configuration ─────────────────────────────────────────────────────────────
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

// ── Fallback: unknown slugs (not in cache / not yet synced) ───────────────────
// DNR rules cover all synced slugs without needing /etc/hosts.
// For anything that slips through (slug not in cache), Chrome will hit a DNS
// error for the "go" hostname. We catch that here and forward to the API.

chrome.webNavigation.onErrorOccurred.addListener(
  async (details) => {
    if (details.frameId !== 0) return;
    const url = new URL(details.url);
    if (url.hostname !== "go") return;

    const slug = url.pathname.replace(/^\//, "");
    if (!slug) return;

    const apiBase = await getApiBase();
    chrome.tabs.update(details.tabId, { url: `${apiBase}/go/${slug}` });
  },
  { url: [{ hostEquals: "go", schemes: ["http"] }] }
);

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

    // Persist cache for the links page / status display
    const cache = {};
    for (const link of links) {
      cache[link.slug] = { url: link.url, description: link.description };
    }
    await chrome.storage.local.set({
      [CACHE_KEY]: cache,
      last_sync: new Date().toISOString(),
    });

    // Update declarativeNetRequest rules so redirects work without /etc/hosts
    await updateDNRRules(links);

    console.log(`GoLink: synced ${links.length} links`);
  } catch (err) {
    console.error("GoLink: sync error", err);
  }
}

// ── declarativeNetRequest ─────────────────────────────────────────────────────

async function updateDNRRules(links) {
  // Remove all existing dynamic rules first
  const existing = await chrome.declarativeNetRequest.getDynamicRules();
  const removeRuleIds = existing.map((r) => r.id);

  // Build one redirect rule per slug
  const addRules = links.map((link, idx) => ({
    id: idx + 1,
    priority: 1,
    action: {
      type: "redirect",
      redirect: { url: link.url },
    },
    condition: {
      // |http://go/SLUG matches any URL starting with http://go/{slug}
      urlFilter: `|http://go/${link.slug}`,
      resourceTypes: ["main_frame"],
    },
  }));

  await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds, addRules });
  console.log(`GoLink: registered ${addRules.length} DNR redirect rules`);
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
      return true;

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
