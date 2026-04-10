// === Googleドライブ同期モジュール ===
const VNGDrive = (() => {
    const STORAGE_KEY = 'vnp-gdrive-url';
    let apiUrl = '';
    let isEnabled = false;

    function init() {
        apiUrl = localStorage.getItem(STORAGE_KEY) || '';
        isEnabled = !!apiUrl;
    }

    function setApiUrl(url) {
        apiUrl = url.trim();
        localStorage.setItem(STORAGE_KEY, apiUrl);
        isEnabled = !!apiUrl;
    }

    function getApiUrl() { return apiUrl; }
    function getIsEnabled() { return isEnabled; }

    // 接続テスト
    async function testConnection() {
        if (!apiUrl) return { success: false, error: 'URLが設定されていません' };
        try {
            const res = await fetch(apiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'text/plain' },
                body: JSON.stringify({ action: 'test' })
            });
            const data = await res.json();
            return data;
        } catch (err) {
            return { success: false, error: '接続エラー: ' + err.message };
        }
    }

    // 録音データをGoogleドライブに保存
    async function saveRecord(record) {
        if (!isEnabled || !apiUrl) return null;

        try {
            const payload = {
                action: 'save',
                id: record.id,
                title: record.title,
                mode: record.mode,
                date: record.date,
                duration: record.duration,
                transcript: record.transcript || '',
                summary: record.summary || '',
                bookmarks: record.bookmarks || [],
                tags: record.tags || []
            };

            const res = await fetch(apiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'text/plain' },
                body: JSON.stringify(payload)
            });

            const data = await res.json();
            return data;
        } catch (err) {
            console.error('Google Drive保存エラー:', err);
            return { success: false, error: err.message };
        }
    }

    // ファイル一覧取得
    async function listFiles() {
        if (!isEnabled || !apiUrl) return [];
        try {
            const res = await fetch(apiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'text/plain' },
                body: JSON.stringify({ action: 'list' })
            });
            const data = await res.json();
            return data.success ? data.files : [];
        } catch (err) {
            console.error('一覧取得エラー:', err);
            return [];
        }
    }

    // 削除
    async function deleteFile(title) {
        if (!isEnabled || !apiUrl) return false;
        try {
            const res = await fetch(apiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'text/plain' },
                body: JSON.stringify({ action: 'delete', title: title })
            });
            const data = await res.json();
            return data.success;
        } catch (err) {
            return false;
        }
    }

    return {
        init, setApiUrl, getApiUrl, testConnection,
        saveRecord, listFiles, deleteFile,
        get isEnabled() { return isEnabled; }
    };
})();
