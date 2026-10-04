let currentWeekStart;
let currentStartDayIndex = 0; 
let activitiesCache = [];
let isUnsaved = false;

document.addEventListener('DOMContentLoaded', async () => {
    await DB.init();
    
    // Fetch user preference, fallback to Sunday (0)
    currentStartDayIndex = await DB.getSetting('firstDayOfWeek', 0);
    currentWeekStart = getStartOfWeek(new Date(), currentStartDayIndex);
    
    setupEventListeners();
    loadWeek(currentWeekStart);

    DB.requestPersistentStorage();
    showBackupReminder();
});

const BACKUP_REMINDER_DAYS = 7;

// Browser storage can be cleared, so nudge toward an export when the last one is stale
async function showBackupReminder() {
    const hasData = (await DB.getStoreAll('Hours')).length > 0;
    const days = await DB.daysSinceLastBackup();
    if (!hasData || (days !== null && days < BACKUP_REMINDER_DAYS)) return;

    document.getElementById('backup-reminder-text').innerText = days === null
        ? "Your time data has never been backed up."
        : `Your time data hasn't been backed up in ${days} days.`;
    document.getElementById('backup-reminder').classList.remove('hidden');
}

function markUnsaved() {
    isUnsaved = true;
    const status = document.getElementById('save-status');
    if (status) {
        status.innerText = "Unsaved changes";
        status.style.color = "#cf6679"; // Matches your danger-btn color
    }
}

// Asks before discarding unsaved edits. Returns true if it is OK to proceed.
function confirmDiscardChanges() {
    return !isUnsaved || confirm("You have unsaved changes for this week. Discard them?");
}

function navigateToWeek(newWeekStart) {
    if (!confirmDiscardChanges()) return;
    currentWeekStart = newWeekStart;
    loadWeek(currentWeekStart);
}

function setupEventListeners() {
    document.getElementById('btn-prev-week').addEventListener('click', () => {
        const d = new Date(currentWeekStart);
        d.setDate(d.getDate() - 7);
        navigateToWeek(d);
    });
    
    document.getElementById('btn-next-week').addEventListener('click', () => {
        const d = new Date(currentWeekStart);
        d.setDate(d.getDate() + 7);
        navigateToWeek(d);
    });

    document.getElementById('btn-current-week').addEventListener('click', () => {
        navigateToWeek(getStartOfWeek(new Date(), currentStartDayIndex));
    });

	// Jump to specific week based on chosen date
    document.getElementById('jump-to-date').addEventListener('change', (e) => {
        const val = e.target.value;
        if (val) {
            // Split the string and construct locally to prevent timezone offset bugs 
            // that happen when passing standard "YYYY-MM-DD" directly to new Date()
            const [year, month, day] = val.split('-');
            const selectedDate = new Date(year, month - 1, day);
            
            navigateToWeek(getStartOfWeek(selectedDate, currentStartDayIndex));
            
            // Clear the input immediately so it acts purely as a jump button
            e.target.value = '';
        }
    });

    // Warn before leaving the page (nav links, refresh, close) with unsaved edits
    window.addEventListener('beforeunload', (e) => {
        if (isUnsaved) {
            e.preventDefault();
            e.returnValue = '';
        }
    });

    document.getElementById('btn-save').addEventListener('click', saveWeek);

	document.getElementById('tracker-table').addEventListener('input', () => {
        markUnsaved();
        calculateTotals();
    });

	document.getElementById('tracker-table').addEventListener('click', (e) => {
        // Handle Clear Day Button
        if (e.target.classList.contains('clear-day-btn')) {
            clearDay(e.target.dataset.date);
        }
    });
}

function clearDay(date) {
    if (!confirm(`Are you sure you want to clear all shifts and hours for ${date}?`)) return;

    markUnsaved();

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
    return toLocalDateString(d);
}

function timeToDecimal(timeStr) {
    if (!timeStr) return 0;
    const [h, m] = timeStr.split(':').map(Number);
    return h + (m / 60);
}

async function loadWeek(startDate) {
	isUnsaved = false;
    const status = document.getElementById('save-status');
    if (status) {
        status.innerText = "";
        status.style.color = "#81c784"; // Reset to green
    }
	
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

    DB.sortByActivityOrder(activitiesCache);

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

    // 1. Render Shift Inputs
    shiftInputs.forEach(inputDef => {
        let row = `<tr><td><strong>${inputDef.label}</strong></td>`;
        dates.forEach(date => {
            const val = shiftMap[date] ? shiftMap[date][inputDef.key] || '' : '';
            row += `<td><input type="${inputDef.type}" class="shift-input" data-date="${date}" data-key="${inputDef.key}" value="${escapeHtml(val)}" step="${inputDef.step}"></td>`;
        });
        row += `</tr>`;
        tbody.innerHTML += row;
    });

	// 2. Render Shift Delta vs Allocated immediately after Break
    let summaryRow = `<tr><td><strong>Shift Delta vs Allocated</strong></td>`;
    dates.forEach(date => {
        summaryRow += `<td id="summary-${date}">
            <div class="summary-container"><span>0.0</span><span class="vs-text">vs</span><span>0.0</span></div>
        </td>`;
    });
    summaryRow += `</tr>`;
    tbody.innerHTML += summaryRow;

    // 3. Render Allocated Activities Header
    tbody.innerHTML += `<tr><td colspan="8" style="background: var(--border);"><strong>Allocated Activities (Hrs)</strong></td></tr>`;

    // 4. Render Activity Rows
    activitiesCache.forEach(activity => {
        let row = `<tr><td>${escapeHtml(activity.name)}</td>`;
        
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

    // 5. Render Actions Row at the very bottom in the footer
    let clearRow = `<tr><td><strong>Actions</strong></td>`;
    dates.forEach(date => {
        clearRow += `<td>
            <button class="danger-btn clear-day-btn" data-date="${date}" style="padding: 4px 8px; font-size: 0.85em; width: 90%;">Clear</button>
        </td>`;
    });
    clearRow += `</tr>`;
    tfoot.innerHTML = clearRow;
}

function calculateTotals() {
    const dates = Array.from(document.querySelectorAll('#date-header-row th')).slice(1).map(th => th.querySelector('small').innerText);

    let weeklyAllocatedSum = 0; // CHANGED: Now tracks allocated activity hours instead of shift duration

    dates.forEach(date => {
        const start = document.querySelector(`.shift-input[data-date="${date}"][data-key="startTime"]`).value;
        const stop = document.querySelector(`.shift-input[data-date="${date}"][data-key="stopTime"]`).value;
        const breakHrs = parseFloat(document.querySelector(`.shift-input[data-date="${date}"][data-key="breakHours"]`).value) || 0;
        
        let shiftDelta = 0;
        if (start && stop) {
            let decimalStart = timeToDecimal(start);
            let decimalStop = timeToDecimal(stop);
            if (decimalStop < decimalStart) decimalStop += 24; // Handle overnight shifts
            shiftDelta = (decimalStop - decimalStart) - breakHrs;
        }
        
        shiftDelta = Math.max(0, shiftDelta);
        let shiftDeltaStr = shiftDelta.toFixed(1);

        let activitySum = 0;
        document.querySelectorAll(`.activity-input[data-date="${date}"]`).forEach(input => {
            activitySum += parseFloat(input.value) || 0;
        });

        // NEW: Add the daily activity sum to our weekly tally
        weeklyAllocatedSum += activitySum; 
        
        let activitySumStr = activitySum.toFixed(1);

		const summaryCell = document.getElementById(`summary-${date}`);

        summaryCell.innerHTML = `<div class="summary-container"><span>${shiftDeltaStr}</span><span class="vs-text">vs</span><span>${activitySumStr}</span></div>`;

        summaryCell.classList.remove('balanced', 'unbalanced');
        
        if (parseFloat(shiftDeltaStr) === 0 && parseFloat(activitySumStr) === 0) {
            // Do nothing
        } else if (shiftDeltaStr === activitySumStr) {
            summaryCell.classList.add('balanced');
        } else {
            summaryCell.classList.add('unbalanced');
        }
    });

    // UPDATED: Output the new variable and update the label
    const weeklyTotalEl = document.getElementById('weekly-total-display');
    if (weeklyTotalEl) {
        weeklyTotalEl.innerText = `Allocated Total: ${weeklyAllocatedSum.toFixed(1)} hrs`;
    }
}

async function saveWeek() {
    const status = document.getElementById('save-status');
    status.style.color = "#81c784";
    status.innerText = "Saving...";

    const dates = Array.from(document.querySelectorAll('#date-header-row th')).slice(1).map(th => th.querySelector('small').innerText);
    const ops = [];

    for (let date of dates) {
        const start = document.querySelector(`.shift-input[data-date="${date}"][data-key="startTime"]`).value;
        const stop = document.querySelector(`.shift-input[data-date="${date}"][data-key="stopTime"]`).value;
        const breakHrs = parseFloat(document.querySelector(`.shift-input[data-date="${date}"][data-key="breakHours"]`).value) || null;
        
        if (start || stop || breakHrs) {
            ops.push({ store: 'DailyShifts', put: { date, startTime: start, stopTime: stop, breakHours: breakHrs } });
        } else {
            ops.push({ store: 'DailyShifts', delete: date });
        }

        const activityInputs = document.querySelectorAll(`.activity-input[data-date="${date}"]`);
        for (let input of activityInputs) {
            const activityId = parseInt(input.dataset.id);
            const val = parseFloat(input.value);
            
            if (!isNaN(val) && val > 0) {
                ops.push({ store: 'Hours', put: { date, activityId, hours: val } });
            } else {
                // Composite key [date, activityId]
                ops.push({ store: 'Hours', delete: [date, activityId] });
            }
        }
    }

    try {
        await DB.writeBatch(['DailyShifts', 'Hours'], ops);
    } catch (err) {
        console.error(err);
        status.style.color = "#cf6679";
        status.innerText = "Save failed, nothing was saved. Please try again.";
        return;
    }

    isUnsaved = false;
    status.innerText = "Saved!";
    
    setTimeout(() => {
        if (!isUnsaved) {
            status.innerText = "";
        }
    }, 2000);
}
