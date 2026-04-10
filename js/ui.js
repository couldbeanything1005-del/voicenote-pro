// === UI操作 ===
const VNUI = (() => {
    let toastTimer = null;

    function showToast(message, duration = 2500) {
        const toast = document.getElementById('toast');
        toast.textContent = message;
        toast.classList.add('show');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => toast.classList.remove('show'), duration);
    }

    function switchView(viewId) {
        document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
        document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));

        const view = document.getElementById(viewId);
        if (view) view.classList.add('active');

        const btn = document.querySelector(`.nav-btn[data-view="${viewId}"]`);
        if (btn) btn.classList.add('active');

        if (viewId === 'historyView') refreshHistory();
    }

    function setupNavigation() {
        document.querySelectorAll('.nav-btn').forEach(btn => {
            btn.addEventListener('click', () => switchView(btn.dataset.view));
        });
    }

    function setupDarkMode() {
        const saved = localStorage.getItem('vnp-theme');
        if (saved === 'dark' || (!saved && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
            document.documentElement.setAttribute('data-theme', 'dark');
            document.getElementById('darkModeToggle').textContent = '☀️';
        }

        document.getElementById('darkModeToggle').addEventListener('click', () => {
            const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
            if (isDark) {
                document.documentElement.removeAttribute('data-theme');
                document.getElementById('darkModeToggle').textContent = '🌙';
                localStorage.setItem('vnp-theme', 'light');
            } else {
                document.documentElement.setAttribute('data-theme', 'dark');
                document.getElementById('darkModeToggle').textContent = '☀️';
                localStorage.setItem('vnp-theme', 'dark');
            }
            VNRecorder.drawIdleWaveform();
        });
    }

    function setupModeSelector() {
        document.querySelectorAll('.mode-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
            });
        });
    }

    function getSelectedMode() {
        const active = document.querySelector('.mode-btn.active');
        return active ? active.dataset.mode : 'memo';
    }

    // === 履歴 ===
    async function refreshHistory() {
        const filter = document.querySelector('.filter-btn.active')?.dataset.filter || 'all';
        const query = document.getElementById('searchInput')?.value || '';

        let records;
        if (query) {
            records = await VNStorage.search(query);
            if (filter !== 'all') records = records.filter(r => r.mode === filter);
        } else {
            records = await VNStorage.filterByMode(filter);
        }

        renderHistoryList(records);
        updateStats();
    }

    function renderHistoryList(records) {
        const list = document.getElementById('historyList');
        if (!records || records.length === 0) {
            list.innerHTML = '<p class="empty-state">まだ録音がありません</p>';
            return;
        }

        const modeLabels = {
            phone: '📞 電話', meeting: '🏢 会議',
            medical: '🏥 診察', memo: '📝 メモ'
        };

        list.innerHTML = records.map(r => {
            const date = new Date(r.date);
            const dateStr = `${date.getFullYear()}/${date.getMonth()+1}/${date.getDate()} ${String(date.getHours()).padStart(2,'0')}:${String(date.getMinutes()).padStart(2,'0')}`;
            const dur = VNRecorder.formatTime(r.duration || 0);
            const preview = (r.transcript || '').replace(/\[[\d:]+\]\s*/g, '').substring(0, 80);

            return `<div class="history-item" data-id="${r.id}">
                <div class="history-item-header">
                    <span class="history-item-title">${escapeHTML(r.title || '無題')}</span>
                    <span class="history-item-badge">${modeLabels[r.mode] || r.mode}</span>
                </div>
                <div class="history-item-meta">${dateStr} ・ ${dur}</div>
                <div class="history-item-preview">${escapeHTML(preview)}</div>
            </div>`;
        }).join('');

        list.querySelectorAll('.history-item').forEach(item => {
            item.addEventListener('click', () => openDetail(item.dataset.id));
        });
    }

    async function updateStats() {
        const stats = await VNStorage.getStats();
        const el = id => document.getElementById(id);
        if (el('totalRecordings')) el('totalRecordings').textContent = stats.total;
        if (el('totalDuration')) el('totalDuration').textContent = stats.totalDuration + '分';
        if (el('thisMonth')) el('thisMonth').textContent = stats.thisMonth;
    }

    function setupHistoryFilters() {
        document.querySelectorAll('.filter-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                refreshHistory();
            });
        });

        const searchInput = document.getElementById('searchInput');
        if (searchInput) {
            let debounce;
            searchInput.addEventListener('input', () => {
                clearTimeout(debounce);
                debounce = setTimeout(refreshHistory, 300);
            });
        }
    }

    // === 詳細モーダル ===
    async function openDetail(id) {
        const record = await VNStorage.getById(id);
        if (!record) return;

        const modal = document.getElementById('detailModal');
        document.getElementById('modalTitle').textContent = record.title || '無題';

        const date = new Date(record.date);
        const dateStr = `${date.getFullYear()}/${date.getMonth()+1}/${date.getDate()} ${String(date.getHours()).padStart(2,'0')}:${String(date.getMinutes()).padStart(2,'0')}`;
        document.getElementById('modalMeta').textContent = `${dateStr} ・ ${VNRecorder.formatTime(record.duration || 0)}`;

        // 文字起こしタブ
        const transcriptEl = document.getElementById('modalTranscriptText');
        if (record.segments && record.segments.length > 0) {
            transcriptEl.innerHTML = VNTranscriber.buildTranscriptHTML(record.segments, record.bookmarks || []);
        } else {
            transcriptEl.textContent = record.transcript || '（文字起こしなし）';
        }

        // 要約タブ
        const summaryEl = document.getElementById('modalSummaryText');
        summaryEl.innerHTML = record.summaryHTML || record.summary || '（要約なし）';

        // タブ初期化
        document.querySelectorAll('.modal-tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.modal-tab-content').forEach(c => c.classList.remove('active'));
        document.querySelector('.modal-tab[data-tab="transcript"]').classList.add('active');
        document.getElementById('modalTranscript').classList.add('active');

        // タブ切替
        document.querySelectorAll('.modal-tab').forEach(tab => {
            tab.onclick = () => {
                document.querySelectorAll('.modal-tab').forEach(t => t.classList.remove('active'));
                document.querySelectorAll('.modal-tab-content').forEach(c => c.classList.remove('active'));
                tab.classList.add('active');
                document.getElementById(tab.dataset.tab === 'transcript' ? 'modalTranscript' : 'modalSummary').classList.add('active');
            };
        });

        // エクスポート: テキスト
        document.getElementById('exportTextBtn').onclick = () => {
            const text = `【${record.title || '無題'}】\n日時: ${dateStr}\n\n--- 文字起こし ---\n${record.transcript || ''}\n\n--- 要約 ---\n${record.summary || ''}`;
            downloadText(text, `${record.title || 'voicenote'}.txt`);
            showToast('テキストをダウンロードしました');
        };

        // エクスポート: 音声
        document.getElementById('exportAudioBtn').onclick = () => {
            if (record.audioBlob) {
                const url = URL.createObjectURL(record.audioBlob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `${record.title || 'voicenote'}.webm`;
                a.click();
                URL.revokeObjectURL(url);
                showToast('音声をダウンロードしました');
            } else {
                showToast('音声データがありません');
            }
        };

        // 削除
        document.getElementById('deleteRecordBtn').onclick = async () => {
            if (confirm('この録音を削除しますか？')) {
                await VNStorage.deleteById(id);
                modal.style.display = 'none';
                refreshHistory();
                showToast('削除しました');
            }
        };

        // 閉じる
        document.getElementById('closeModal').onclick = async () => {
            // 編集内容を保存
            const newTranscript = transcriptEl.innerText;
            if (newTranscript !== record.transcript) {
                await VNStorage.update(id, { transcript: newTranscript });
            }
            modal.style.display = 'none';
        };

        modal.style.display = 'flex';
        modal.onclick = e => {
            if (e.target === modal) modal.style.display = 'none';
        };
    }

    function downloadText(content, filename) {
        const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
    }

    function escapeHTML(str) {
        const d = document.createElement('div');
        d.textContent = str;
        return d.innerHTML;
    }

    return {
        showToast, switchView, setupNavigation, setupDarkMode,
        setupModeSelector, getSelectedMode, refreshHistory,
        setupHistoryFilters, openDetail, updateStats
    };
})();
