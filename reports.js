document.addEventListener('DOMContentLoaded', async () => {
    await DB.init();

    const startInput = document.getElementById('report-start');
    const endInput = document.getElementById('report-end');
    
    // Set Default Dates: Jan 1st of current year to Today
    const today = new Date();
    const currentYear = today.getFullYear();
    
    // Formatting helper to guarantee YYYY-MM-DD
    const pad = (num) => num.toString().padStart(2, '0');
    
    startInput.value = `${currentYear}-01-01`;
    endInput.value = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;

    document.getElementById('btn-generate').addEventListener('click', generateReport);

    // Auto-generate on first load
    generateReport();
});

async function generateReport() {
    const start = document.getElementById('report-start').value;
    const end = document.getElementById('report-end').value;

    if (!start || !end) {
        showToast("Please select both a start and end date.", "error");
        return;
    }

    if (start > end) {
        showToast("Start date cannot be after end date.", "error");
        return;
    }

    const activities = await DB.getStoreAll('Activities');
    const allHours = await DB.getStoreAll('Hours');

    // Filter hours purely by string comparison (fast and inclusive!)
    const filteredHours = allHours.filter(h => h.date >= start && h.date <= end);

    // Setup Data Map: { activityId: { name: "", total: 0, months: { 'YYYY-MM': 0 } } }
    const dataMap = {};
    const monthsSet = new Set(); // To track which months actually have data/fall in range

    activities.forEach(a => {
        dataMap[a.id] = { name: a.name, total: 0, months: {} };
    });

    filteredHours.forEach(h => {
        if (!dataMap[h.activityId]) return; // Failsafe for deleted activities

        const monthKey = h.date.substring(0, 7); // Extracts 'YYYY-MM'
        monthsSet.add(monthKey);

        dataMap[h.activityId].total += h.hours;
        dataMap[h.activityId].months[monthKey] = (dataMap[h.activityId].months[monthKey] || 0) + h.hours;
    });

    const sortedMonths = Array.from(monthsSet).sort();
    renderReportTable(activities, dataMap, sortedMonths);
}

function renderReportTable(activities, dataMap, sortedMonths) {
    const headerRow = document.getElementById('report-headers');
    const tbody = document.getElementById('report-body');

    // Build Headers
    headerRow.innerHTML = '<th>Activity</th>';
    
    const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    
    sortedMonths.forEach(monthKey => {
        const [y, m] = monthKey.split('-');
        const monthDisplay = `${monthNames[parseInt(m) - 1]} ${y}`;
        headerRow.innerHTML += `<th>${monthDisplay}</th>`;
    });
    
    headerRow.innerHTML += '<th>Grand Total</th>';

    // Build Rows
    tbody.innerHTML = '';
    
    // Sort activities by highest total hours first
    activities.sort((a, b) => dataMap[b.id].total - dataMap[a.id].total);

    activities.forEach(a => {
        const rowData = dataMap[a.id];
        let row = `<tr><td><strong>${escapeHtml(rowData.name)}</strong></td>`;
        
        sortedMonths.forEach(monthKey => {
            const hours = rowData.months[monthKey] || 0;
            row += `<td>${hours > 0 ? hours.toFixed(1) : '—'}</td>`;
        });
        
        // Grand Total Column
        row += `<td><strong>${rowData.total > 0 ? rowData.total.toFixed(1) : '0.0'}</strong></td></tr>`;
        tbody.innerHTML += row;
    });

    if (activities.length === 0) {
        tbody.innerHTML = `<tr><td colspan="${sortedMonths.length + 2}">No activities found.</td></tr>`;
    }
}

function showToast(message, type = "success") {
    const container = document.getElementById('toast-container');
    if (!container) return; // Failsafe
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerText = message;
    container.appendChild(toast);
    setTimeout(() => toast.classList.add('show'), 10);
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}