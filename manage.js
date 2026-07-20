document.addEventListener('DOMContentLoaded', async () => {
    await DB.init();
    loadActivitiesTable();
    setupEventListeners();
});

function setupEventListeners() {
    document.getElementById('activity-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const id = document.getElementById('activity-id').value;
        const name = document.getElementById('activity-name').value;
        const start = document.getElementById('activity-start').value || null;
        const end = document.getElementById('activity-end').value || null;

        if (start && end && start > end) {
            alert("Start date cannot be after end date.");
            return;
        }

        const payload = { name, startDate: start, endDate: end };
        if (id) payload.id = parseInt(id); // Update existing

        await DB.put('Activities', payload);
        
        document.getElementById('activity-form').reset();
        document.getElementById('activity-id').value = "";
        document.getElementById('form-title').innerText = "Add New Activity";
        document.getElementById('btn-cancel-edit').classList.add('hidden');
        
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
    });

    // Data Import
    document.getElementById('btn-import').addEventListener('click', () => {
        if(confirm("Warning: Importing will wipe out all current data. Are you sure?")) {
            document.getElementById('file-import').click();
        }
    });

    document.getElementById('file-import').addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                await DB.importData(e.target.result);
                alert("Data imported successfully!");
                loadActivitiesTable();
            } catch (err) {
                alert("Error importing data. Make sure it is a valid backup file.");
                console.error(err);
            }
        };
        reader.readAsText(file);
    });
}

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

window.deleteActivity = async (id) => {
    if (confirm("Are you sure? This will delete the activity AND all hours logged against it forever.")) {
        await DB.deleteActivity(id);
        loadActivitiesTable();
    }
};