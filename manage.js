document.addEventListener('DOMContentLoaded', async () => {
    await DB.init();
    loadActivitiesTable();
    setupEventListeners();
});

function setupEventListeners() {
    document.getElementById('activity-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const id = document.getElementById('activity-id').value;
        const name = document.getElementById('activity-name').value.trim();
        const start = document.getElementById('activity-start').value || null;
        const end = document.getElementById('activity-end').value || null;

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

        const payload = { name, startDate: start, endDate: end };
        if (parsedId) payload.id = parsedId;

        await DB.put('Activities', payload);
        
        document.getElementById('activity-form').reset();
        document.getElementById('activity-id').value = "";
        document.getElementById('form-title').innerText = "Add New Activity";
        document.getElementById('btn-cancel-edit').classList.add('hidden');
        
        showToast("Activity saved successfully!", "success");
        loadActivitiesTable();
    });

    document.getElementById('btn-cancel-edit').addEventListener('click', () => {
        document.getElementById('activity-form').reset();
        document.getElementById('activity-id').value = "";
        document.getElementById('form-title').innerText = "Add New Activity";
        document.getElementById('btn-cancel-edit').classList.add('hidden');
    });

    // Data Export
    document.getElementById('btn-export').addEventListener('click', async () => {
        const jsonString = await DB.exportData();
        const blob = new Blob([jsonString], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `time_tracker_backup_${new Date().toISOString().split('T')[0]}.json`;
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
                loadActivitiesTable();
            } catch (err) {
                showToast("Error importing data. Make sure it is a valid backup file.", "error");
                console.error(err);
            }
        };
        reader.readAsText(file);
        
        // Reset file input so you can re-upload the same file if needed
        e.target.value = '';
    });
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

    // Clone buttons to strip old event listeners if modal is reused
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
    const tbody = document.querySelector('#activities-table tbody');
    tbody.innerHTML = '';

    activities.forEach(a => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${a.name}</td>
            <td>${a.startDate || '—'}</td>
            <td>${a.endDate || '—'}</td>
            <td>
                <button onclick="editActivity(${a.id}, '${a.name}', '${a.startDate || ''}', '${a.endDate || ''}')">Edit</button>
                <button class="danger-btn" onclick="deleteActivity(${a.id})">Delete</button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

window.editActivity = (id, name, start, end) => {
    document.getElementById('form-title').innerText = "Edit Activity";
    document.getElementById('activity-id').value = id;
    document.getElementById('activity-name').value = name;
    document.getElementById('activity-start').value = start;
    document.getElementById('activity-end').value = end;
    document.getElementById('btn-cancel-edit').classList.remove('hidden');
    window.scrollTo(0, 0);
};

window.deleteActivity = (id) => {
    showConfirmModal("Are you sure? This will delete the activity AND all hours logged against it forever.", async () => {
        await DB.deleteActivity(id);
        showToast("Activity deleted.", "success");
        loadActivitiesTable();
    });
};