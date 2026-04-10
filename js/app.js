// === メインアプリ ===
(async function() {
    'use strict';

    // Service Worker登録
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('./sw.js').catch(err =>
            console.warn('SW登録失敗:', err)
        );
    }

    // DB初期化
    await VNStorage.open();

    // UI初期化
    VNUI.setupNavigation();
    VNUI.setupDarkMode();
    VNUI.setupModeSelector();
    VNUI.setupHistoryFilters();

    // Google Drive同期初期化
    VNGDrive.init();
    setupSettings();

    // 波形Canvas初期化
    const canvas = document.getElementById('waveform');
    if (canvas) {
        canvas.width = canvas.offsetWidth * (window.devicePixelRatio || 1);
        canvas.height = canvas.offsetHeight * (window.devicePixelRatio || 1);
        VNRecorder.init(canvas);
    }

    // インポーター初期化
    VNImporter.init();

    // === 録音操作 ===
    const recordBtn = document.getElementById('recordBtn');
    const pauseBtn = document.getElementById('pauseBtn');
    const bookmarkBtn = document.getElementById('bookmarkBtn');
    const transcriptText = document.getElementById('transcriptText');

    let currentTranscriptResult = null;

    recordBtn.addEventListener('click', async () => {
        if (!VNRecorder.isRecording) {
            // 録音開始
            const ok = await VNRecorder.start();
            if (!ok) {
                VNUI.showToast('マイクへのアクセスを許可してください');
                return;
            }

            recordBtn.classList.add('recording');
            pauseBtn.disabled = false;
            bookmarkBtn.disabled = false;
            transcriptText.innerHTML = '';
            transcriptText.contentEditable = 'false';

            // 文字起こし開始
            VNTranscriber.init({
                onUpdate: (interim, segs) => {
                    transcriptText.innerHTML = VNTranscriber.buildTranscriptHTML(segs) +
                        `<span style="color:var(--text-secondary)">${interim}</span>`;
                    transcriptText.scrollTop = transcriptText.scrollHeight;
                },
                onFinal: (seg, segs) => {
                    transcriptText.innerHTML = VNTranscriber.buildTranscriptHTML(segs);
                    transcriptText.scrollTop = transcriptText.scrollHeight;
                }
            });
            VNTranscriber.start(Date.now());

            VNUI.showToast('録音を開始しました');
        } else {
            // 録音停止
            const transcriptData = VNTranscriber.stop();
            const recData = await VNRecorder.stop();

            recordBtn.classList.remove('recording');
            pauseBtn.disabled = true;
            pauseBtn.textContent = '⏸ 一時停止';
            bookmarkBtn.disabled = true;
            transcriptText.contentEditable = 'true';

            if (!recData) return;

            const mode = VNUI.getSelectedMode();
            const fullText = transcriptData.fullText || transcriptText.innerText || '';

            // 要約生成
            showSummaryModal();
            await delay(500);

            const summary = VNSummarizer.summarize(fullText, mode);

            // 保存
            const record = {
                id: 'rec_' + Date.now(),
                title: generateTitle(mode),
                mode: mode,
                date: new Date().toISOString(),
                duration: recData.duration,
                transcript: fullText,
                segments: transcriptData.segments || [],
                summary: VNSummarizer.toText(summary),
                summaryHTML: VNSummarizer.toHTML(summary),
                bookmarks: recData.bookmarks || [],
                tags: [mode],
                audioBlob: recData.blob,
                source: 'record'
            };

            await VNStorage.save(record);
            showSummaryResult(summary);
            currentTranscriptResult = record;

            // Google Drive自動同期
            await syncToGDrive(record);

            VNUI.showToast('録音を保存しました');
        }
    });

    // 一時停止/再開
    pauseBtn.addEventListener('click', () => {
        if (VNRecorder.isPaused) {
            VNRecorder.resume();
            pauseBtn.textContent = '⏸ 一時停止';
        } else {
            VNRecorder.pause();
            pauseBtn.textContent = '▶️ 再開';
        }
    });

    // ブックマーク
    bookmarkBtn.addEventListener('click', () => {
        const bm = VNRecorder.addBookmark();
        if (bm) VNUI.showToast(`🔖 マーク追加 (${VNRecorder.formatTime(bm.time)})`);
    });

    // === インポート文字起こし ===
    document.getElementById('transcribeBtn').addEventListener('click', async () => {
        const result = await VNImporter.transcribe();
        if (result) {
            // 要約生成
            showSummaryModal();
            await delay(500);

            const mode = document.getElementById('importMode').value;
            const summary = VNSummarizer.summarize(result.fullText || '', mode);

            // 保存
            const record = await VNImporter.saveImport(result);
            showSummaryResult(summary);

            // Google Drive自動同期
            if (record) await syncToGDrive(record);

            VNUI.showToast('保存しました');
        }
    });

    // === Google Drive自動同期 ===
    async function syncToGDrive(record) {
        const autoSync = document.getElementById('autoSyncToggle');
        if (!VNGDrive.isEnabled || !autoSync || !autoSync.checked) return;

        try {
            const result = await VNGDrive.saveRecord(record);
            if (result && result.success) {
                VNUI.showToast('Google Driveに同期しました');
            }
        } catch (err) {
            console.warn('GDrive同期エラー:', err);
        }
    }

    // === 設定画面 ===
    function setupSettings() {
        const urlInput = document.getElementById('gdriveUrl');
        const testBtn = document.getElementById('gdriveTestBtn');
        const saveBtn = document.getElementById('gdriveSaveBtn');
        const statusEl = document.getElementById('gdriveStatus');
        const autoSyncToggle = document.getElementById('autoSyncToggle');

        // 保存済みURL復元
        urlInput.value = VNGDrive.getApiUrl();
        autoSyncToggle.checked = localStorage.getItem('vnp-auto-sync') !== 'false';
        updateGDriveStatus();

        // 保存
        saveBtn.addEventListener('click', () => {
            VNGDrive.setApiUrl(urlInput.value);
            updateGDriveStatus();
            VNUI.showToast('設定を保存しました');
        });

        // 接続テスト
        testBtn.addEventListener('click', async () => {
            VNGDrive.setApiUrl(urlInput.value);
            testBtn.disabled = true;
            testBtn.textContent = 'テスト中...';

            const result = await VNGDrive.testConnection();

            testBtn.disabled = false;
            testBtn.textContent = '接続テスト';

            if (result.success) {
                VNUI.showToast('接続成功！');
                updateGDriveStatus();
            } else {
                VNUI.showToast('接続失敗: ' + (result.error || '不明なエラー'));
            }
        });

        // 自動同期トグル
        autoSyncToggle.addEventListener('change', () => {
            localStorage.setItem('vnp-auto-sync', autoSyncToggle.checked);
        });

        // PWAインストールボタン
        const installBtn = document.getElementById('installPWABtn');
        if (deferredPrompt && installBtn) {
            installBtn.style.display = 'block';
            installBtn.addEventListener('click', async () => {
                deferredPrompt.prompt();
                const { outcome } = await deferredPrompt.userChoice;
                if (outcome === 'accepted') {
                    VNUI.showToast('インストールしました！');
                }
                deferredPrompt = null;
                installBtn.style.display = 'none';
            });
        }
    }

    function updateGDriveStatus() {
        const statusEl = document.getElementById('gdriveStatus');
        const dot = statusEl.querySelector('.status-dot');
        const text = statusEl.querySelector('span:last-child');

        if (VNGDrive.isEnabled) {
            dot.className = 'status-dot connected';
            text.textContent = '接続済み';
        } else {
            dot.className = 'status-dot disconnected';
            text.textContent = '未接続';
        }
    }

    // === 要約モーダル ===
    function showSummaryModal() {
        const modal = document.getElementById('summaryModal');
        document.querySelector('.summary-generating').style.display = 'block';
        document.getElementById('summaryResult').style.display = 'none';
        modal.style.display = 'flex';
    }

    function showSummaryResult(summary) {
        document.querySelector('.summary-generating').style.display = 'none';
        const resultEl = document.getElementById('summaryResult');
        document.getElementById('summaryContent').innerHTML = VNSummarizer.toHTML(summary);
        resultEl.style.display = 'block';

        document.getElementById('saveSummaryBtn').onclick = () => {
            document.getElementById('summaryModal').style.display = 'none';
            VNUI.refreshHistory();
        };
    }

    // === タイトル生成 ===
    function generateTitle(mode) {
        const now = new Date();
        const dateStr = `${now.getMonth()+1}/${now.getDate()}`;
        const timeStr = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
        const labels = { meeting: '会議', medical: '診察', memo: 'メモ', phone: '電話' };
        return `${labels[mode] || 'メモ'} ${dateStr} ${timeStr}`;
    }

    function delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // PWAインストールプロンプト
    let deferredPrompt = null;
    window.addEventListener('beforeinstallprompt', e => {
        e.preventDefault();
        deferredPrompt = e;
        const installBtn = document.getElementById('installPWABtn');
        if (installBtn) installBtn.style.display = 'block';
    });

    // Web Speech API非対応警告
    if (!VNTranscriber.isSupported) {
        VNUI.showToast('このブラウザでは文字起こし機能が使えません。Chrome推奨です。');
    }

    console.log('VoiceNote Pro 初期化完了');
})();
