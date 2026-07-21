let currentWeekStart = getSunday(new Date());
let activitiesCache = [];

document.addEventListener('DOMContentLoaded', async () => {
    await DB.init();
    setupEventListeners();
    loadWeek(currentWeekStart);
});

function setupEventListeners() {
    document.getElementById('btn-prev-week').addEventListener('click', () => {
        currentWeekStart.setDate(currentWeekStart.getDate() - 7);
        loadWeek(currentWeekStart);
    });
    
    document.getElementById('btn-next-week').addEventListener('click', () => {
        currentWeekStart.setDate(currentWeekStart.getDate() + 7);
        loadWeek(currentWeekStart);
    });

    document.getElementById('btn-current-week').addEventListener('click', () => {
        currentWeekStart = getSunday(new Date());
        loadWeek(currentWeekStart);
    });

    document.getElementById('btn-save').addEventListener('click', saveWeek);

    // Live calculation listeners
    document.getElementById('tracker-table').addEventListener('input', calculateTotals);
}

function getSunday(d) {
    const date = new Date(d);
    const day = date.getDay();
    const diff = date.getDate() - day;
    return new Date(date.setDate(diff));
}

function formatDate(d) {
    return d.toISOString().split('T')[0];
}

function timeToDecimal(timeStr) {
    if (!timeStr) return 0;
    const [h, m] = timeStr.split(':').map(Number);
    return h + (m / 60);
}

async function loadWeek(sunday) {
    const dates = [];
    for (let i = 0; i < 7; i++) {
        const d = new Date(sunday);
        d.setDate(sunday.getDate() + i);
        dates.push(formatDate(d));
    }

    const weekStartStr = dates[0];
    const weekEndStr = dates[6];

    document.getElementById('week-label').innerText = `${weekStartStr} to ${weekEndStr}`;

    const allActivities = await DB.getStoreAll('Activities');
    // Filter out activities that ended before this week, or start after this week
    activitiesCache = allActivities.filter(a => {
        if (a.endDate && a.endDate < weekStartStr) return false;
        if (a.startDate && a.startDate > weekEndStr) return false;
        return true;
    });

    const shifts = await DB.getStoreAll('DailyShifts');
    const shiftMap = {};
    shifts.forEach(s => shiftMap[s.date] = s);

    const hours = await DB.getStoreAll('Hours');
    const hoursMap = {};
    hours.forEach(h => {
        hoursMap[`${h.date}_${h.activityId}`] = h.hours;
    });

    renderTable(dates, shiftMap, hoursMap);
    calculateTotals();
}

function renderTable(dates, shiftMap, hoursMap) {
    const headerRow = document.getElementById('date-header-row');
    const tbody = document.getElementById('tracker-body');
    const tfoot = document.getElementById('tracker-footer');

    // Headers
    headerRow.innerHTML = '<th>Activity / Day</th>';
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    dates.forEach((date, i) => {
        headerRow.innerHTML += `<th>${days[i]}<br><small>${date}</small></th>`;
    });

    tbody.innerHTML = '';
    
    // Shifts Rows
    const shiftInputs = [
        { label: 'Start Time', key: 'startTime', type: 'time', step: '' },
        { label: 'Stop Time', key: 'stopTime', type: 'time', step: '' },
        { label: 'Break (hrs)', key: 'breakHours', type: 'number', step: '0.1' }
    ];

    shiftInputs.forEach(inputDef => {
        let row = `<tr><td><strong>${inputDef.label}</strong></td>`;
        dates.forEach(date => {
            const val = shiftMap[date] ? shiftMap[date][inputDef.key] || '' : '';
            row += `<td><input type="${inputDef.type}" class="shift-input" data-date="${date}" data-key="${inputDef.key}" value="${val}" step="${inputDef.step}"></td>`;
        });
        row += `</tr>`;
        tbody.innerHTML += row;
    });

    // Divider
    tbody.innerHTML += `<tr><td colspan="8" style="background: var(--border);"><strong>Allocated Activities (Hrs)</strong></td></tr>`;

    // Activity Rows
    activitiesCache.forEach(activity => {
        let row = `<tr><td>${activity.name}</td>`;
        dates.forEach(date => {
            // Check if cell should be disabled due to mid-week start/end (Optional enhancement based on dates)
            const isDisabled = (activity.startDate && activity.startDate > date) || (activity.endDate && activity.endDate < date);
            const val = hoursMap[`${date}_${activity.id}`] || '';
            
            if (isDisabled) {
                row += `<td><input type="number" disabled title="Activity not valid on this date"></td>`;
            } else {
                row += `<td><input type="number" class="activity-input" data-date="${date}" data-id="${activity.id}" value="${val}" step="0.1" min="0"></td>`;
            }
        });
        row += `</tr>`;
        tbody.innerHTML += row;
    });

    // Footer
    let footRow = `<tr><td><strong>Shift Delta vs Allocated</strong></td>`;
    dates.forEach(date => {
        footRow += `<td id="summary-${date}">0.0 / 0.0</td>`;
    });
    footRow += `</tr>`;
    tfoot.innerHTML = footRow;
}

function calculateTotals() {
    const dates = Array.from(document.querySelectorAll('#date-header-row th')).slice(1).map(th => th.querySelector('small').innerText);

    dates.forEach(date => {
        // Calculate shift delta
        const start = document.querySelector(`.shift-input[data-date="${date}"][data-key="startTime"]`).value;
        const stop = document.querySelector(`.shift-input[data-date="${date}"][data-key="stopTime"]`).value;
        const breakHrs = parseFloat(document.querySelector(`.shift-input[data-date="${date}"][data-key="breakHours"]`).value) || 0;
        
        let shiftDelta = 0;
        if (start && stop) {
            let decimalStart = timeToDecimal(start);
            let decimalStop = timeToDecimal(stop);
            if (decimalStop < decimalStart) decimalStop += 24; // Handle graveyard shift slightly
            shiftDelta = (decimalStop - decimalStart) - breakHrs;
        }
        shiftDelta = Math.max(0, shiftDelta).toFixed(1);

        // Calculate Activity Sum
        let activitySum = 0;
        document.querySelectorAll(`.activity-input[data-date="${date}"]`).forEach(input => {
            activitySum += parseFloat(input.value) || 0;
        });
        activitySum = activitySum.toFixed(1);

        // Update UI
        const summaryCell = document.getElementById(`summary-${date}`);
        summaryCell.innerHTML = `${shiftDelta} <br><small>vs</small><br> ${activitySum}`;

        summaryCell.classList.remove('balanced', 'unbalanced');
        
        if (parseFloat(shiftDelta) === 0 && parseFloat(activitySum) === 0) {
            // Do nothing, empty day
        } else if (shiftDelta === activitySum) {
            summaryCell.classList.add('balanced');
        } else {
            summaryCell.classList.add('unbalanced');
        }
    });
}

async function saveWeek() {
    const status = document.getElementById('save-status');
    status.innerText = "Saving...";

    const dates = Array.from(document.querySelectorAll('#date-header-row th')).slice(1).map(th => th.querySelector('small').innerText);

    for (let date of dates) {
        // Save Shifts
        const start = document.querySelector(`.shift-input[data-date="${date}"][data-key="startTime"]`).value;
        const stop = document.querySelector(`.shift-input[data-date="${date}"][data-key="stopTime"]`).value;
        const breakHrs = parseFloat(document.querySelector(`.shift-input[data-date="${date}"][data-key="breakHours"]`).value) || null;
        
        if (start || stop || breakHrs) {
            await DB.put('DailyShifts', { date, startTime: start, stopTime: stop, breakHours: breakHrs });
        }

        // Save Activities
        const activityInputs = document.querySelectorAll(`.activity-input[data-date="${date}"]`);
        for (let input of activityInputs) {
            const activityId = parseInt(input.dataset.id);
            const val = parseFloat(input.value);
            
            if (!isNaN(val) && val > 0) {
                await DB.put('Hours', { date, activityId, hours: val });
            } else {
                // To keep DB clean, if value is deleted/0, we could delete the record, 
                // but for simplicity, overwriting with 0 or deleting is needed. 
                // Using IndexedDB delete on compound key requires IDBObjectStore.delete([date, activityId])
                const transaction = DB.db.transaction('Hours', 'readwrite');
                transaction.objectStore('Hours').delete([date, activityId]);
            }
        }
    }

    status.innerText = "Saved!";
    setTimeout(() => status.innerText = "", 2000);
}