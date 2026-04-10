// === 音声インポート ===
const VNImporter = (() => {
    let currentFile = null;
    let audioElement = null;

    function init() {
        audioElement = document.getElementById('audioPlayer');
        setupDropZone();
        setupFileInput();
    }

    function setupDropZone() {
        const dropZone = document.getElementById('dropZone');
        if (!dropZone) return;

        ['dragenter', 'dragover'].forEach(evt => {
            dropZone.addEventListener(evt, e => {
                e.preventDefault();
                dropZone.classList.add('dragover');
            });
        });

        ['dragleave', 'drop'].forEach(evt => {
            dropZone.addEventListener(evt, e => {
                e.preventDefault();
                dropZone.classList.remove('dragover');
            });
        });

        dropZone.addEventListener('drop', e => {
            const files = e.dataTransfer.files;
            if (files.length > 0) handleFile(files[0]);
        });

        dropZone.addEventListener('click', e => {
            if (e.target.closest('.file-select-btn') || e.target.closest('input')) return;
            document.getElementById('fileInput').click();
        });
    }

    function setupFileInput() {
        const fileInput = document.getElementById('fileInput');
        if (!fileInput) return;
        fileInput.addEventListener('change', e => {
            if (e.target.files.length > 0) {
                handleFile(e.target.files[0]);
                // iOSで同じファイルを再選択できるようにリセット
                fileInput.value = '';
            }
        });
    }

    function handleFile(file) {
        // ファイルタイプチェック（iOS Safari対応で緩めに）
        const isAudio = file.type.startsWith('audio/') ||
                        file.name.match(/\.(m4a|mp3|wav|webm|ogg|caf|aac|mp4)$/i) ||
                        file.type === '' || // iOSでtype空の場合がある
                        file.type === 'application/octet-stream';

        if (!isAudio) {
            VNUI.showToast('音声ファイルを選択してください');
            return;
        }

        currentFile = file;

        // ObjectURLでプレーヤーに設定
        if (audioElement.src) {
            URL.revokeObjectURL(audioElement.src);
        }
        const url = URL.createObjectURL(file);
        audioElement.src = url;

        // iOS Safariではloadが必要
        audioElement.load();

        // ファイル情報表示
        const info = document.getElementById('fileInfo');
        const sizeMB = (file.size / (1024 * 1024)).toFixed(1);
        info.textContent = `${file.name} (${sizeMB} MB)`;

        // プレーヤー表示
        document.getElementById('importPlayer').style.display = 'block';
        document.getElementById('importTranscript').style.display = 'none';
        document.getElementById('importTranscriptText').innerHTML = '';

        // 電話モードをデフォルトに
        document.getElementById('importMode').value = 'phone';

        // 文字起こしボタンの状態更新
        const btn = document.getElementById('transcribeBtn');
        if (VNTranscriber.isSupported) {
            btn.textContent = '文字起こし開始';
        } else {
            btn.textContent = '保存（手動で文字を入力可）';
        }

        VNUI.showToast('ファイルを読み込みました');
    }

    async function transcribe() {
        if (!audioElement || !audioElement.src) {
            VNUI.showToast('音声ファイルを選択してください');
            return null;
        }

        const btn = document.getElementById('transcribeBtn');
        btn.disabled = true;

        document.getElementById('importTranscript').style.display = 'block';
        const textEl = document.getElementById('importTranscriptText');

        if (!VNTranscriber.isSupported) {
            // iOS Safari等: 文字起こし非対応 → 手動入力モード
            btn.textContent = '保存';
            btn.disabled = false;
            textEl.contentEditable = 'true';
            textEl.innerHTML = '';
            textEl.setAttribute('placeholder', 'ここに文字起こし内容を入力してください...');
            textEl.focus();

            VNUI.showToast('この端末では自動文字起こし非対応です。手動で入力できます。');

            return {
                segments: [],
                fullText: '',
                manualRequired: true
            };
        }

        // 自動文字起こし（Chrome等）
        btn.textContent = '文字起こし中...';
        textEl.innerHTML = '<span style="color:var(--text-secondary)">音声を再生して文字起こしています...</span>';

        audioElement.currentTime = 0;

        try {
            const result = await VNTranscriber.transcribeFromAudio(audioElement, {
                onUpdate: (interim, segs) => {
                    textEl.innerHTML = VNTranscriber.buildTranscriptHTML(segs) +
                        `<span style="color:var(--text-secondary)">${interim}</span>`;
                    textEl.scrollTop = textEl.scrollHeight;
                },
                onFinal: (seg, segs) => {
                    textEl.innerHTML = VNTranscriber.buildTranscriptHTML(segs);
                    textEl.scrollTop = textEl.scrollHeight;
                }
            });

            btn.disabled = false;
            btn.textContent = '文字起こし開始';
            textEl.contentEditable = 'true';

            return result;
        } catch (err) {
            console.error('文字起こしエラー:', err);
            btn.disabled = false;
            btn.textContent = '文字起こし開始';
            VNUI.showToast('文字起こしに失敗しました');
            return null;
        }
    }

    async function saveImport(transcriptResult) {
        if (!currentFile) return null;

        const mode = document.getElementById('importMode').value;

        // 手動入力の場合、テキストエリアからテキスト取得
        let fullText = '';
        if (transcriptResult && transcriptResult.fullText) {
            fullText = transcriptResult.fullText;
        }
        if (!fullText || transcriptResult?.manualRequired) {
            const textEl = document.getElementById('importTranscriptText');
            fullText = textEl.innerText || textEl.textContent || '';
        }

        const summary = VNSummarizer.summarize(fullText, mode);

        const record = {
            id: 'rec_' + Date.now(),
            title: currentFile.name.replace(/\.[^/.]+$/, ''),
            mode: mode,
            date: new Date().toISOString(),
            duration: Math.floor(audioElement.duration || 0),
            transcript: fullText,
            segments: transcriptResult?.segments || [],
            summary: VNSummarizer.toText(summary),
            summaryHTML: VNSummarizer.toHTML(summary),
            bookmarks: [],
            tags: [mode],
            audioBlob: currentFile,
            source: 'import'
        };

        await VNStorage.save(record);
        return record;
    }

    function getAudioElement() { return audioElement; }
    function getCurrentFile() { return currentFile; }

    return { init, handleFile, transcribe, saveImport, getAudioElement, getCurrentFile };
})();
