/**
 * Theme primitives shared by the project dashboard and the hub portfolio page.
 */
export const FAVICON_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#0f172a"/><path d="M5 17h5l3-8 5 14 3-6h6" fill="none" stroke="#60a5fa" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
export const FAVICON_DATA_URL = `data:image/svg+xml,${encodeURIComponent(FAVICON_SVG)}`;

export const SHARED_THEME_CSS = `
    :root {
      color-scheme: dark;
      --bg: #0b0f17;
      --surface: #121826;
      --surface-2: #192234;
      --border: #263147;
      --text: #e6edf7;
      --muted: #93a4bd;
      --accent: #60a5fa;
      --accent-soft: rgba(96, 165, 250, 0.14);
      --green: #34d399;
      --green-soft: rgba(52, 211, 153, 0.14);
      --amber: #fbbf24;
      --amber-soft: rgba(251, 191, 36, 0.14);
      --red: #f87171;
      --red-soft: rgba(248, 113, 113, 0.14);
      --slate: #94a3b8;
      --slate-soft: rgba(148, 163, 184, 0.15);
      --shadow: 0 12px 32px rgba(0, 0, 0, 0.35);
      --radius: 12px;
    }
    @media (prefers-color-scheme: light) {
      :root:not([data-theme="dark"]) {
        color-scheme: light;
        --bg: #f6f8fc;
        --surface: #ffffff;
        --surface-2: #f1f5f9;
        --border: #dbe3ef;
        --text: #0f172a;
        --muted: #475569;
        --accent: #2563eb;
        --accent-soft: rgba(37, 99, 235, 0.1);
        --green: #059669;
        --green-soft: rgba(5, 150, 105, 0.12);
        --amber: #d97706;
        --amber-soft: rgba(217, 119, 6, 0.12);
        --red: #dc2626;
        --red-soft: rgba(220, 38, 38, 0.12);
        --slate: #64748b;
        --slate-soft: rgba(100, 116, 139, 0.12);
        --shadow: 0 10px 28px rgba(15, 23, 42, 0.08);
      }
    }
    :root[data-theme="light"] {
      color-scheme: light;
      --bg: #f6f8fc;
      --surface: #ffffff;
      --surface-2: #f1f5f9;
      --border: #dbe3ef;
      --text: #0f172a;
      --muted: #475569;
      --accent: #2563eb;
      --accent-soft: rgba(37, 99, 235, 0.1);
      --green: #059669;
      --green-soft: rgba(5, 150, 105, 0.12);
      --amber: #d97706;
      --amber-soft: rgba(217, 119, 6, 0.12);
      --red: #dc2626;
      --red-soft: rgba(220, 38, 38, 0.12);
      --slate: #64748b;
      --slate-soft: rgba(100, 116, 139, 0.12);
      --shadow: 0 10px 28px rgba(15, 23, 42, 0.08);
    }
`;

export const EARLY_THEME_SCRIPT = `
  <script>
    (function () {
      try {
        var saved = localStorage.getItem("pp-theme");
        if (saved === "light" || saved === "dark") {
          document.documentElement.dataset.theme = saved;
        }
      } catch (e) {}
    })();
  </script>
`;
