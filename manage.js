document.addEventListener('DOMContentLoaded', async () => {
    await DB.init();
    await DB.normalizeActivityOrders();
    await resetActivityForm();
    loadActivitiesTable();
    setupEventListeners();
    showDataStatus();
    
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

        // Determine target order (defaults to the bottom if input is empty or invalid)
        const maxOrder = await DB.getMaxActivityOrder();
        let targetOrder = rawOrder ? parseInt(rawOrder, 10) : (maxOrder + 1);
        if (isNaN(targetOrder) || targetOrder < 1) {
            targetOrder = maxOrder + 1;
        }

        const payload = { name, startDate: start, endDate: end };
        if (parsedId) payload.id = parsedId;

        const save = async (hourKeysToDelete) => {
            await DB.saveActivity(payload, targetOrder, hourKeysToDelete);
            await resetActivityForm();
            showToast("Activity saved successfully!", "success");
            loadActivitiesTable();
        };

        // Hours logged outside a narrowed date range would no longer show on the tracker
        // but would still count in reports, so delete them (after confirming) with the save.
        const orphaned = parsedId
            ? (await DB.getHoursForActivity(parsedId)).filter(h => (start && h.date < start) || (end && h.date > end))
            : [];

        if (orphaned.length === 0) {
            await save([]);
            return;
        }

        const totalHours = orphaned.reduce((sum, h) => sum + h.hours, 0);
        showConfirmModal(
            `${orphaned.length} logged ${orphaned.length === 1 ? 'entry' : 'entries'} (${totalHours.toFixed(2)} hrs) ` +
            `${orphaned.length === 1 ? 'is' : 'are'} outside the new date range and will be permanently deleted. Continue?`,
            () => save(orphaned.map(h => [h.date, h.activityId]))
        );
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
        await DB.markBackedUp();
        showDataStatus();
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
                await DB.normalizeActivityOrders();
                // The data now matches a backup file, so it counts as backed up
                await DB.markBackedUp();
                showDataStatus();
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

async function showDataStatus() {
    const days = await DB.daysSinceLastBackup();
    document.getElementById('last-backup').innerText =
        days === null ? "Never" : days === 0 ? "Today" : `${days} day${days === 1 ? '' : 's'} ago`;

    const persisted = await DB.requestPersistentStorage();
    document.getElementById('storage-status').innerText =
        persisted === true ? "Persistent (the browser will not clear it automatically)"
        : persisted === false ? "Not persistent, so the browser may clear it. Installing the app helps; export backups regularly."
        : "Persistence not supported by this browser; export backups regularly.";
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
    
    DB.sortByActivityOrder(activities);

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