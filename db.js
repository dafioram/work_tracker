const DB_NAME = 'TimeTrackerDB';
const DB_VERSION = 2; // Incremented to add Settings store

const DB = {
    db: null,

    async init() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);

            request.onupgradeneeded = (event) => {
                const db = event.target.result;

                if (!db.objectStoreNames.contains('Activities')) {
                    db.createObjectStore('Activities', { keyPath: 'id', autoIncrement: true });
                }

                if (!db.objectStoreNames.contains('DailyShifts')) {
                    db.createObjectStore('DailyShifts', { keyPath: 'date' });
                }

                if (!db.objectStoreNames.contains('Hours')) {
                    const hoursStore = db.createObjectStore('Hours', { keyPath: ['date', 'activityId'] });
                    hoursStore.createIndex('activityId', 'activityId', { unique: false });
                }

                // NEW: Settings Table
                if (!db.objectStoreNames.contains('Settings')) {
                    db.createObjectStore('Settings', { keyPath: 'key' });
                }
            };

            request.onsuccess = (event) => {
                this.db = event.target.result;
                resolve();
            };

            request.onerror = (event) => reject(event.target.error);
        });
    },

    async getStoreAll(storeName) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(storeName, 'readonly');
            const store = transaction.objectStore(storeName);
            const request = store.getAll();
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    },

    // NEW Helper: Get a specific setting with a fallback
    async getSetting(key, defaultValue = null) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction('Settings', 'readonly');
            const store = transaction.objectStore('Settings');
            const request = store.get(key);
            request.onsuccess = () => resolve(request.result ? request.result.value : defaultValue);
            request.onerror = () => reject(request.error);
        });
    },

    // Helper: Get highest current order number
    async getMaxActivityOrder() {
        const allActivities = await this.getStoreAll('Activities');
        let maxOrder = 0;
        allActivities.forEach(a => {
            if (a.order !== undefined && a.order !== null && a.order !== "") {
                maxOrder = Math.max(maxOrder, Number(a.order));
            }
        });
        return maxOrder;
    },

    // Sorts activities by display order; records without an order go last, ties break by id.
    sortByActivityOrder(activities) {
        const orderOf = (a) => (a.order !== undefined && a.order !== null && a.order !== "") ? Number(a.order) : Infinity;
        return activities.sort((a, b) => (orderOf(a) - orderOf(b)) || (a.id - b.id));
    },

    // Writes the given activities with orders renumbered 1..N in list order.
    // Only records whose order changed are written, plus any in alwaysWrite.
    renumberOps(activities, alwaysWrite = []) {
        const ops = [];
        activities.forEach((activity, i) => {
            if (activity.order !== i + 1 || alwaysWrite.includes(activity)) {
                activity.order = i + 1;
                ops.push({ store: 'Activities', put: activity });
            }
        });
        return ops;
    },

    // Saves an activity at the given 1-based position, renumbering every activity so orders
    // stay contiguous, and deletes the given Hours keys, all in one transaction.
    async saveActivity(activity, targetOrder, hourKeysToDelete = []) {
        const ordered = this.sortByActivityOrder(
            (await this.getStoreAll('Activities')).filter(a => a.id !== activity.id)
        );
        const position = Math.min(Math.max(targetOrder - 1, 0), ordered.length);
        ordered.splice(position, 0, activity);

        const ops = this.renumberOps(ordered, [activity]);
        hourKeysToDelete.forEach(key => ops.push({ store: 'Hours', delete: key }));
        await this.writeBatch(['Activities', 'Hours'], ops);
    },

    // Closes gaps in activity orders (e.g. after a delete or from older data).
    async normalizeActivityOrders() {
        const activities = this.sortByActivityOrder(await this.getStoreAll('Activities'));
        const ops = this.renumberOps(activities);
        if (ops.length) await this.writeBatch(['Activities'], ops);
    },

    async getHoursForActivity(activityId) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction('Hours', 'readonly');
            const request = transaction.objectStore('Hours').index('activityId').getAll(activityId);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    },

    async put(storeName, item) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(storeName, 'readwrite');
            const store = transaction.objectStore(storeName);
            const request = store.put(item);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    },

    // Applies a list of { store, put } / { store, delete } operations in one transaction:
    // either every write lands or none do.
    async writeBatch(storeNames, ops) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(storeNames, 'readwrite');
            transaction.oncomplete = () => resolve();
            transaction.onerror = () => reject(transaction.error);
            transaction.onabort = () => reject(transaction.error || new Error("Save aborted."));

            try {
                ops.forEach(op => {
                    const store = transaction.objectStore(op.store);
                    if ('put' in op) store.put(op.put);
                    else store.delete(op.delete);
                });
            } catch (err) {
                transaction.abort();
                reject(err);
            }
        });
    },

    async deleteActivity(activityId) {
        await new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['Activities', 'Hours'], 'readwrite');
            const activityStore = transaction.objectStore('Activities');
            const hoursStore = transaction.objectStore('Hours');

            activityStore.delete(activityId);

            const index = hoursStore.index('activityId');
            const request = index.getAllKeys(activityId);

            request.onsuccess = () => {
                request.result.forEach(key => hoursStore.delete(key));
            };

            transaction.oncomplete = () => resolve();
            transaction.onerror = () => reject(transaction.error);
        });
        await this.normalizeActivityOrders();
    },
	
    // Asks the browser not to evict our data under storage pressure (or Safari's 7-day
    // cleanup). Returns true if storage is persistent, false if not, null if unsupported.
    async requestPersistentStorage() {
        if (!navigator.storage || !navigator.storage.persist) return null;
        try {
            if (await navigator.storage.persisted()) return true;
            return await navigator.storage.persist();
        } catch (err) {
            console.error(err);
            return false;
        }
    },

    async markBackedUp() {
        await this.put('Settings', { key: 'lastBackupAt', value: new Date().toISOString() });
    },

    // Whole days since the last export, or null if there has never been one.
    async daysSinceLastBackup() {
        const last = await this.getSetting('lastBackupAt', null);
        if (!last) return null;
        return Math.floor((Date.now() - Date.parse(last)) / 86400000);
    },

    async exportData() {
        const activities = await this.getStoreAll('Activities');
        const shifts = await this.getStoreAll('DailyShifts');
        const hours = await this.getStoreAll('Hours');
        const settings = await this.getStoreAll('Settings');
        return JSON.stringify({ activities, shifts, hours, settings });
    },

    // Throws a descriptive Error if the parsed JSON is not a backup produced by exportData().
    validateBackup(data) {
        if (!data || typeof data !== 'object' || Array.isArray(data)) {
            throw new Error("File is not a Time Tracker backup.");
        }
        // settings was added in DB v2, so older backups may lack it
        for (const key of ['activities', 'shifts', 'hours']) {
            if (!Array.isArray(data[key])) {
                throw new Error(`Backup is missing the "${key}" list.`);
            }
        }
        if (data.settings !== undefined && !Array.isArray(data.settings)) {
            throw new Error('Backup "settings" must be a list.');
        }

        const isDate = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
        const isOptionalDate = (v) => v === null || v === undefined || v === '' || isDate(v);
        const check = (list, name, isValid) => {
            list.forEach((item, i) => {
                if (!item || typeof item !== 'object' || !isValid(item)) {
                    throw new Error(`Invalid ${name} entry at position ${i + 1}.`);
                }
            });
        };

        check(data.activities, 'activity', a =>
            Number.isInteger(a.id) && typeof a.name === 'string' &&
            isOptionalDate(a.startDate) && isOptionalDate(a.endDate));
        check(data.shifts, 'shift', s => isDate(s.date));
        check(data.hours, 'hours', h =>
            isDate(h.date) && Number.isInteger(h.activityId) && typeof h.hours === 'number' && isFinite(h.hours));
        check(data.settings || [], 'setting', s => typeof s.key === 'string');
    },

    async importData(jsonData) {
        // Parse and validate everything up front so a bad file never touches existing data
        const data = JSON.parse(jsonData);
        this.validateBackup(data);

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['Activities', 'DailyShifts', 'Hours', 'Settings'], 'readwrite');
            transaction.oncomplete = () => resolve();
            transaction.onerror = () => reject(transaction.error);
            transaction.onabort = () => reject(transaction.error || new Error("Import aborted."));

            try {
                transaction.objectStore('Activities').clear();
                transaction.objectStore('DailyShifts').clear();
                transaction.objectStore('Hours').clear();
                transaction.objectStore('Settings').clear();

                data.activities.forEach(item => transaction.objectStore('Activities').put(item));
                data.shifts.forEach(item => transaction.objectStore('DailyShifts').put(item));
                data.hours.forEach(item => transaction.objectStore('Hours').put(item));
                data.settings?.forEach(item => transaction.objectStore('Settings').put(item));
            } catch (err) {
                // Roll back the clears; without this the transaction would commit an empty database
                transaction.abort();
                reject(err);
            }
        });
    }
};