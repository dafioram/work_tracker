let currentWeekStart;
let currentStartDayIndex = 0; // Default to Sunday (0)
let activitiesCache = [];

document.addEventListener('DOMContentLoaded', async () => {
    await DB.init();
    
    // Fetch user preference, fallback to Sunday (0)
    currentStartDayIndex = await DB.getSetting('firstDayOfWeek', 0);
    currentWeekStart = getStartOfWeek(new Date(), currentStartDayIndex);
    
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
        currentWeekStart = getStartOfWeek(new Date(), currentStartDayIndex);
        loadWeek(currentWeekStart);
    });

    document.getElementById('btn-save').addEventListener('click', saveWeek);

    document.getElementById('tracker-table').addEventListener('input', calculateTotals);
	
	// NEW: Listen for clicks on the Clear Day buttons
    document.getElementById('tracker-table').addEventListener('click', (e) => {
        if (e.target.classList.contains('clear-day-btn')) {
            const date = e.target.dataset.date;
            clearDay(date);
        }
    });
}

function clearDay(date) {
    if (!confirm(`Are you sure you want to clear all shifts and hours for ${date}?`)) return;

    // Clear Shift inputs
    document.querySelectorAll(`.shift-input[data-date="${date}"]`).forEach(input => {
        input.value = '';
    });

    // Clear Activity inputs
    document.querySelectorAll(`.activity-input[data-date="${date}"]`).forEach(input => {
        input.value = '';
    });

    calculateTotals();
}

// Replaces getSunday()
function getStartOfWeek(d, startDayIndex) {
    const date = new Date(d);
    date.setHours(0, 0, 0, 0); // Avoid daylight saving shifts
    const currentDay = date.getDay();
    const offset = (currentDay - startDayIndex + 7) % 7;
    date.setDate(date.getDate() - offset);
    return date;
}

function formatDate(d) {
    return d.toISOString().split('T')[0];
}

function timeToDecimal(timeStr) {
    if (!timeStr) return 0;
    const [h, m] = timeStr.split(':').map(Number);
    return h + (m / 60);
}

async function loadWeek(startDate) {
    const dates = [];
    for (let i = 0; i < 7; i++) {
        const d = new Date(startDate);
        d.setDate(startDate.getDate() + i);
        dates.push(formatDate(d));
    }

    const weekStartStr = dates[0];
    const weekEndStr = dates[6];

    document.getElementById('week-label').innerText = `${weekStartStr} to ${weekEndStr}`;

    const allActivities = await DB.getStoreAll('Activities');
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

    // Dynamically rotate the days array based on the starting day index
    const baseDays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const days = [...baseDays.slice(currentStartDayIndex), ...baseDays.slice(0, currentStartDayIndex)];

    headerRow.innerHTML = '<th>Activity / Day</th>';
    dates.forEach((date, i) => {
        headerRow.innerHTML += `<th>${days[i]}<br><small>${date}</small></th>`;
    });

    tbody.innerHTML = '';
    
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

    tbody.innerHTML += `<tr><td colspan="8" style="background: var(--border);"><strong>Allocated Activities (Hrs)</strong></td></tr>`;

    activitiesCache.forEach(activity => {
        let row = `<tr><td>${activity.name}</td>`;
        dates.forEach(date => {
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

	let clearRow = `<tr><td><strong>Actions</strong></td>`;
    dates.forEach(date => {
        clearRow += `<td>
            <button class="danger-btn clear-day-btn" data-date="${date}" style="padding: 4px 8px; font-size: 0.85em; width: 90%;">Clear</button>
        </td>`;
    });
    clearRow += `</tr>`;
    tbody.innerHTML += clearRow;

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
        const start = document.querySelector(`.shift-input[data-date="${date}"][data-key="startTime"]`).value;
        const stop = document.querySelector(`.shift-input[data-date="${date}"][data-key="stopTime"]`).value;
        const breakHrs = parseFloat(document.querySelector(`.shift-input[data-date="${date}"][data-key="breakHours"]`).value) || 0;
        
        let shiftDelta = 0;
        if (start && stop) {
            let decimalStart = timeToDecimal(start);
            let decimalStop = timeToDecimal(stop);
            if (decimalStop < decimalStart) decimalStop += 24; 
            shiftDelta = (decimalStop - decimalStart) - breakHrs;
        }
        shiftDelta = Math.max(0, shiftDelta).toFixed(1);

        let activitySum = 0;
        document.querySelectorAll(`.activity-input[data-date="${date}"]`).forEach(input => {
            activitySum += parseFloat(input.value) || 0;
        });
        activitySum = activitySum.toFixed(1);

        const summaryCell = document.getElementById(`summary-${date}`);
        summaryCell.innerHTML = `${shiftDelta} <br><small>vs</small><br> ${activitySum}`;

        summaryCell.classList.remove('balanced', 'unbalanced');
        
        if (parseFloat(shiftDelta) === 0 && parseFloat(activitySum) === 0) {
            // Do nothing
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
        const start = document.querySelector(`.shift-input[data-date="${date}"][data-key="startTime"]`).value;
        const stop = document.querySelector(`.shift-input[data-date="${date}"][data-key="stopTime"]`).value;
        const breakHrs = parseFloat(document.querySelector(`.shift-input[data-date="${date}"][data-key="breakHours"]`).value) || null;
        
        if (start || stop || breakHrs) {
            await DB.put('DailyShifts', { date, startTime: start, stopTime: stop, breakHours: breakHrs });
        } else {
            // NEW: If inputs are cleared, actually delete the shift from the DB
            const transaction = DB.db.transaction('DailyShifts', 'readwrite');
            transaction.objectStore('DailyShifts').delete(date);
        }

        const activityInputs = document.querySelectorAll(`.activity-input[data-date="${date}"]`);
        for (let input of activityInputs) {
            const activityId = parseInt(input.dataset.id);
            const val = parseFloat(input.value);
            
            if (!isNaN(val) && val > 0) {
                await DB.put('Hours', { date, activityId, hours: val });
            } else {
                const transaction = DB.db.transaction('Hours', 'readwrite');
                transaction.objectStore('Hours').delete([date, activityId]);
            }
        }
    }

    status.innerText = "Saved!";
    setTimeout(() => status.innerText = "", 2000);
}