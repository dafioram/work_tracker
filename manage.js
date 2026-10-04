document.addEventListener('DOMContentLoaded', async () => {
    await DB.init();
    await resetActivityForm();
    loadActivitiesTable();
    setupEventListeners();
    
    // Load current preference
    const firstDay = await DB.getSetting('firstDayOfWeek', 0);
    document.getElementById('setting-first-day').value = firstDay;

    // Save preference on change
    document.getElementById('setting-first-day').addEventListener('change', async (e) => {
        const val = parseInt(e.target.value);
        await DB.put('Settings', { key: 'firstDayOfWeek', value: val });
        showToast("Preference saved! Returning to home...", "success");
        setTimeout(() => window.location.href = "index.html", 1500);
    });
});

function setupEventListeners() {
    document.getElementById('activity-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const id = document.getElementById('activity-id').value;
        const name = document.getElementById('activity-name').value.trim();
        const start = document.getElementById('activity-start').value || null;
        const end = document.getElementById('activity-end').value || null;
        const rawOrder = document.getElementById('activity-order').value;

        if (start && end && start > end) {
            showToast("Start date cannot be after end date.", "error");
            return;
        }

        // DUPLICATE CHECK LOGIC
        const allActivities = await DB.getStoreAll('Activities');
        const parsedId = id ? parseInt(id) : null;
        
        const isDuplicate = allActivities.some(a => 
            a.name.toLowerCase() === name.toLowerCase() && 
            a.id !== parsedId
        );

        if (isDuplicate) {
            showToast(`An activity named "${name}" already exists.`, "error");
            return;
        }

        // Determine target order (defaults to max + 1 if input is empty or invalid)
        const maxOrder = await DB.getMaxActivityOrder();
        let targetOrder = rawOrder ? parseInt(rawOrder, 10) : (maxOrder + 1);
        if (isNaN(targetOrder) || targetOrder < 1) {
            targetOrder = maxOrder + 1;
        }

        // Push down conflicting orders in DB before saving
        await DB.shiftActivityOrders(targetOrder, parsedId);

        const payload = { name, startDate: start, endDate: end, order: targetOrder };
        if (parsedId) payload.id = parsedId;

        await DB.put('Activities', payload);
        
        await resetActivityForm();
        
        showToast("Activity saved successfully!", "success");
        loadActivitiesTable();
    });

    document.getElementById('btn-cancel-edit').addEventListener('click', async () => {
        await resetActivityForm();
    });

    // Data Export
    document.getElementById('btn-export').addEventListener('click', async () => {
        const jsonString = await DB.exportData();
        const blob = new Blob([jsonString], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `time_tracker_backup_${toLocalDateString(new Date())}.json`;
        a.click();
        URL.revokeObjectURL(url);
        showToast("Data exported successfully!", "success");
    });

    // Data Import
    document.getElementById('btn-import').addEventListener('click', () => {
        showConfirmModal("Warning: Importing will wipe out all current data. Are you sure?", () => {
            document.getElementById('file-import').click();
        });
    });

    document.getElementById('file-import').addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                await DB.importData(e.target.result);
                showToast("Data imported successfully!", "success");
                await resetActivityForm();
                loadActivitiesTable();
            } catch (err) {
                showToast(`Import failed, no data was changed. ${err.message}`, "error");
                console.error(err);
            }
        };
        reader.readAsText(file);
        
        e.target.value = '';
    });
}

// Resets form and auto-calculates the default order for the next activity
async function resetActivityForm() {
    document.getElementById('activity-form').reset();
    document.getElementById('activity-id').value = "";
    document.getElementById('form-title').innerText = "Add New Activity";
    document.getElementById('btn-cancel-edit').classList.add('hidden');
    
    // Default to bottom order (max + 1)
    const maxOrder = await DB.getMaxActivityOrder();
    const orderInput = document.getElementById('activity-order');
    if (orderInput) {
        orderInput.value = maxOrder + 1;
    }
}

// UI Helpers
function showToast(message, type = "success") {
    const container = document.getElementById('toast-container');
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

function showConfirmModal(message, onConfirm) {
    const modal = document.getElementById('confirm-modal');
    document.getElementById('confirm-message').innerText = message;
    modal.classList.remove('hidden');

    const confirmBtn = document.getElementById('btn-modal-confirm');
    const cancelBtn = document.getElementById('btn-modal-cancel');

    const newConfirmBtn = confirmBtn.cloneNode(true);
    const newCancelBtn = cancelBtn.cloneNode(true);
    confirmBtn.parentNode.replaceChild(newConfirmBtn, confirmBtn);
    cancelBtn.parentNode.replaceChild(newCancelBtn, cancelBtn);

    newCancelBtn.addEventListener('click', () => {
        modal.classList.add('hidden');
    });

    newConfirmBtn.addEventListener('click', () => {
        modal.classList.add('hidden');
        onConfirm();
    });
}

// Data Operations
async function loadActivitiesTable() {
    const activities = await DB.getStoreAll('Activities');
    
    // Sort activities by order ascending (fallback to 999999 for legacy records)
    activities.sort((a, b) => {
        const orderA = (a.order !== undefined && a.order !== null && a.order !== "") ? Number(a.order) : 999999;
        const orderB = (b.order !== undefined && b.order !== null && b.order !== "") ? Number(b.order) : 999999;
        if (orderA !== orderB) return orderA - orderB;
        return a.id - b.id;
    });

    const tbody = document.querySelector('#activities-table tbody');
    tbody.innerHTML = '';

    activities.forEach(a => {
        const displayOrder = (a.order !== undefined && a.order !== null) ? a.order : '—';
        
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${escapeHtml(displayOrder)}</td>
            <td>${escapeHtml(a.name)}</td>
            <td>${escapeHtml(a.startDate || '—')}</td>
            <td>${escapeHtml(a.endDate || '—')}</td>
            <td>
                <button class="btn-edit">Edit</button>
                <button class="danger-btn btn-delete">Delete</button>
            </td>
        `;
        tr.querySelector('.btn-edit').addEventListener('click', () =>
            editActivity(a.id, a.name, a.startDate || '', a.endDate || '', a.order ?? ''));
        tr.querySelector('.btn-delete').addEventListener('click', () => deleteActivity(a.id));
        tbody.appendChild(tr);
    });
}

async function editActivity(id, name, start, end, order) {
    document.getElementById('form-title').innerText = "Edit Activity";
    document.getElementById('activity-id').value = id;
    document.getElementById('activity-name').value = name;
    document.getElementById('activity-start').value = start;
    document.getElementById('activity-end').value = end;
    
    const orderInput = document.getElementById('activity-order');
    if (orderInput) {
        if (order !== undefined && order !== null && order !== '') {
            orderInput.value = order;
        } else {
            const maxOrder = await DB.getMaxActivityOrder();
            orderInput.value = maxOrder + 1;
        }
    }

    document.getElementById('btn-cancel-edit').classList.remove('hidden');
    window.scrollTo(0, 0);
}

function deleteActivity(id) {
    showConfirmModal("Are you sure? This will delete the activity AND all hours logged against it forever.", async () => {
        await DB.deleteActivity(id);
        showToast("Activity deleted.", "success");
        await resetActivityForm();
        loadActivitiesTable();
    });
}