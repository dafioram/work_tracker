// Formats a Date as YYYY-MM-DD in the user's local timezone.
// (toISOString() converts to UTC, which shifts the date back a day east of UTC.)
function toLocalDateString(d) {
    const pad = (num) => num.toString().padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Escapes text for safe insertion into HTML content and quoted attributes.
function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
