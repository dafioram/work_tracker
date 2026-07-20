const DB_NAME = 'TimeTrackerDB';
const DB_VERSION = 1;

const DB = {
    db: null,

    async init() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);

            request.onupgradeneeded = (event) => {
                const db = event.target.result;

                // Activities Table
                if (!db.objectStoreNames.contains('Activities')) {
                    db.createObjectStore('Activities', { keyPath: 'id', autoIncrement: true });
                }

                // Daily Shifts Table
                if (!db.objectStoreNames.contains('DailyShifts')) {
                    db.createObjectStore('DailyShifts', { keyPath: 'date' });
                }

                // Hours Table (Compound Key)
                if (!db.objectStoreNames.contains('Hours')) {
                    const hoursStore = db.createObjectStore('Hours', { keyPath: ['date', 'activityId'] });
                    hoursStore.createIndex('activityId', 'activityId', { unique: false });
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

    async put(storeName, item) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(storeName, 'readwrite');
            const store = transaction.objectStore(storeName);
            const request = store.put(item);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    },

    async deleteActivity(activityId) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['Activities', 'Hours'], 'readwrite');
            const activityStore = transaction.objectStore('Activities');
            const hoursStore = transaction.objectStore('Hours');

            activityStore.delete(activityId);

            // Cascading delete for hours tied to this activity
            const index = hoursStore.index('activityId');
            const request = index.getAllKeys(activityId);

            request.onsuccess = () => {
                request.result.forEach(key => hoursStore.delete(key));
            };

            transaction.oncomplete = () => resolve();
            transaction.onerror = () => reject(transaction.error);
        });
    },

    async exportData() {
        const activities = await this.getStoreAll('Activities');
        const shifts = await this.getStoreAll('DailyShifts');
        const hours = await this.getStoreAll('Hours');
        return JSON.stringify({ activities, shifts, hours });
    },

    async importData(jsonData) {
        const data = JSON.parse(jsonData);
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['Activities', 'DailyShifts', 'Hours'], 'readwrite');
            
            // Clear existing
            transaction.objectStore('Activities').clear();
            transaction.objectStore('DailyShifts').clear();
            transaction.objectStore('Hours').clear();

            // Populate new
            data.activities.forEach(item => transaction.objectStore('Activities').put(item));
            data.shifts.forEach(item => transaction.objectStore('DailyShifts').put(item));
            data.hours.forEach(item => transaction.objectStore('Hours').put(item));

            transaction.oncomplete = () => resolve();
            transaction.onerror = () => reject(transaction.error);
        });
    }
};