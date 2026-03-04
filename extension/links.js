const CACHE_KEY = "golink_cache";

let allLinks = [];
let sortCol = "slug";
let sortAsc = true;

chrome.storage.local.get([CACHE_KEY, "last_sync"], ({ golink_cache, last_sync }) => {
  const cache = golink_cache || {};
  allLinks = Object.entries(cache).map(([slug, { url, description }]) => ({
    slug,
    url,
    description: description || "",
  }));

  const meta = document.getElementById("meta");
  meta.textContent = last_sync
    ? `${allLinks.length} links · synced ${new Date(last_sync).toLocaleString()}`
    : `${allLinks.length} links · never synced`;

  render(allLinks);
});

document.getElementById("search").addEventListener("input", (e) => {
  const q = e.target.value.toLowerCase();
  const filtered = allLinks.filter(
    (l) =>
      l.slug.toLowerCase().includes(q) ||
      l.url.toLowerCase().includes(q) ||
      l.description.toLowerCase().includes(q)
  );
  render(filtered);
});

document.querySelectorAll("th[data-col]").forEach((th) => {
  th.addEventListener("click", () => {
    const col = th.dataset.col;
    if (sortCol === col) {
      sortAsc = !sortAsc;
    } else {
      sortCol = col;
      sortAsc = true;
    }
    document.querySelectorAll("th").forEach((t) => t.classList.remove("sorted"));
    th.classList.add("sorted");
    th.textContent = th.textContent.replace(/ [▲▼]$/, "");
    th.textContent += sortAsc ? " ▲" : " ▼";

    const q = document.getElementById("search").value.toLowerCase();
    const filtered = allLinks.filter(
      (l) =>
        l.slug.toLowerCase().includes(q) ||
        l.url.toLowerCase().includes(q) ||
        l.description.toLowerCase().includes(q)
    );
    render(filtered);
  });
});

function render(links) {
  const sorted = [...links].sort((a, b) => {
    const av = a[sortCol].toLowerCase();
    const bv = b[sortCol].toLowerCase();
    return sortAsc ? av.localeCompare(bv) : bv.localeCompare(av);
  });

  const tbody = document.getElementById("tbody");
  const empty = document.getElementById("empty");
  const table = document.getElementById("links-table");

  if (sorted.length === 0) {
    table.hidden = true;
    empty.hidden = false;
    return;
  }

  table.hidden = false;
  empty.hidden = true;

  tbody.innerHTML = sorted
    .map(
      ({ slug, url, description }) => `
      <tr>
        <td><a class="go-link" href="http://go/${slug}" title="Navigate to go/${slug}">go/${slug}</a></td>
        <td><a class="target-link" href="${escHtml(url)}" target="_blank" rel="noopener">${escHtml(url)}</a></td>
        <td class="description">${escHtml(description)}</td>
      </tr>`
    )
    .join("");
}

function escHtml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
