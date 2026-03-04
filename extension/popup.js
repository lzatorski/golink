document.addEventListener("DOMContentLoaded", () => {
  loadStatus();

  document.getElementById("save-token").addEventListener("click", () => {
    const token = document.getElementById("token-input").value.trim();
    if (!token) return;
    chrome.runtime.sendMessage({ type: "setToken", token }, () => {
      document.getElementById("token-input").value = "";
      showMessage("Token saved");
      loadStatus();
    });
  });

  document.getElementById("save-api-base").addEventListener("click", () => {
    const apiBase = document.getElementById("api-base-input").value.trim().replace(/\/$/, "");
    if (!apiBase) return;
    chrome.runtime.sendMessage({ type: "setApiBase", apiBase }, () => {
      showMessage("API base saved");
      loadStatus();
    });
  });

  document.getElementById("view-btn").addEventListener("click", () => {
    chrome.tabs.create({ url: chrome.runtime.getURL("links.html") });
  });

  document.getElementById("sync-btn").addEventListener("click", () => {
    const btn = document.getElementById("sync-btn");
    btn.disabled = true;
    btn.textContent = "Syncing…";
    chrome.runtime.sendMessage({ type: "sync" }, () => {
      loadStatus();
      btn.disabled = false;
      btn.textContent = "Sync now";
      showMessage("Synced!");
    });
  });
});

function loadStatus() {
  chrome.runtime.sendMessage({ type: "getStatus" }, (status) => {
    document.getElementById("link-count").textContent = status.linkCount;
    document.getElementById("last-sync").textContent = status.lastSync
      ? new Date(status.lastSync).toLocaleString()
      : "Never";
    document.getElementById("has-token").textContent = status.hasToken ? "Yes" : "No";
    document.getElementById("api-base-input").placeholder = status.apiBase;
  });
}

function showMessage(msg) {
  const el = document.getElementById("message");
  el.textContent = msg;
  setTimeout(() => (el.textContent = ""), 2500);
}
