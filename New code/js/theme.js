/**
 * theme.js — LAI 5 Site-Wide Light/Dark Theme Manager
 * Include this script in every page. It auto-runs on load.
 */

const LAI_THEME_KEY = 'lai5-theme';

function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);

    // Update all toggle buttons on the page (there may be one per navbar)
    document.querySelectorAll('.theme-toggle-btn').forEach(btn => {
        btn.setAttribute('aria-label', theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode');
        btn.setAttribute('title',      theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode');
        const icon = btn.querySelector('.theme-icon');
        if (icon) {
            icon.textContent = theme === 'dark' ? '☀️' : '🌙';
        }
    });
}

function toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme') || 'light';
    const next = current === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    localStorage.setItem(LAI_THEME_KEY, next);
}

// Restore saved preference immediately on script execution (before first paint)
(function initTheme() {
    const saved = localStorage.getItem(LAI_THEME_KEY) || 'dark';
    applyTheme(saved);
})();
