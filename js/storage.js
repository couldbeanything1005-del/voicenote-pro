// === IndexedDB ストレージ ===
const VNStorage = (() => {
    const DB_NAME = 'VoiceNoteProDB';
    const DB_VERSION = 1;
    const STORE_NAME = 'recordings';
    let db = null;

    function open() {
        return new Promise((resolve, reject) => {
            if (db) return resolve(db);
            const req = indexedDB.open(DB_NAME, DB_VERSION);
            req.onupgradeneeded = e => {
                const d = e.target.result;
                if (!d.objectStoreNames.contains(STORE_NAME)) {
                    const store = d.createObjectStore(STORE_NAME, { keyPath: 'id' });
                    store.createIndex('mode', 'mode', { unique: false });
                    store.createIndex('date', 'date', { unique: false });
                }
            };
            req.onsuccess = e => { db = e.target.result; resolve(db); };
            req.onerror = e => reject(e.target.error);
        });
    }

    function getStore(mode = 'readonly') {
        return open().then(d => d.transaction(STORE_NAME, mode).objectStore(STORE_NAME));
    }

    async function save(record) {
        const store = await getStore('readwrite');
        return new Promise((resolve, reject) => {
            const req = store.put(record);
            req.onsuccess = () => resolve(record.id);
            req.onerror = e => reject(e.target.error);
        });
    }

    async function getById(id) {
        const store = await getStore();
        return new Promise((resolve, reject) => {
            const req = store.get(id);
            req.onsuccess = () => resolve(req.result);
            req.onerror = e => reject(e.target.error);
        });
    }

    async function getAll() {
        const store = await getStore();
        return new Promise((resolve, reject) => {
            const req = store.getAll();
            req.onsuccess = () => {
                const results = req.result || [];
                results.sort((a, b) => new Date(b.date) - new Date(a.date));
                resolve(results);
            };
            req.onerror = e => reject(e.target.error);
        });
    }

    async function deleteById(id) {
        const store = await getStore('readwrite');
        return new Promise((resolve, reject) => {
            const req = store.delete(id);
            req.onsuccess = () => resolve();
            req.onerror = e => reject(e.target.error);
        });
    }

    async function search(query) {
        const all = await getAll();
        if (!query) return all;
        const q = query.toLowerCase();
        return all.filter(r =>
            (r.transcript || '').toLowerCase().includes(q) ||
            (r.title || '').toLowerCase().includes(q) ||
            (r.summary || '').toLowerCase().includes(q) ||
            (r.tags || []).some(t => t.toLowerCase().includes(q))
        );
    }

    async function filterByMode(mode) {
        if (!mode || mode === 'all') return getAll();
        const all = await getAll();
        return all.filter(r => r.mode === mode);
    }

    async function getStats() {
        const all = await getAll();
        const now = new Date();
        const thisMonth = all.filter(r => {
            const d = new Date(r.date);
            return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
        });
        const totalSeconds = all.reduce((sum, r) => sum + (r.duration || 0), 0);
        return {
            total: all.length,
            totalDuration: Math.round(totalSeconds / 60),
            thisMonth: thisMonth.length
        };
    }

    async function update(id, updates) {
        const record = await getById(id);
        if (!record) return null;
        Object.assign(record, updates);
        await save(record);
        return record;
    }

    return { open, save, getById, getAll, deleteById, search, filterByMode, getStats, update };
})();
