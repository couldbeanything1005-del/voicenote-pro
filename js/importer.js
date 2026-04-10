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
            if (e.target.files.length > 0) handleFile(e.target.files[0]);
        });
    }

    function handleFile(file) {
        if (!file.type.startsWith('audio/') && !file.name.match(/\.(m4a|mp3|wav|webm|ogg)$/i)) {
            VNUI.showToast('対応していないファイル形式です');
            return;
        }

        currentFile = file;
        const url = URL.createObjectURL(file);
        audioElement.src = url;

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
    }

    async function transcribe() {
        if (!audioElement || !audioElement.src) {
            VNUI.showToast('音声ファイルを選択してください');
            return null;
        }

        const btn = document.getElementById('transcribeBtn');
        btn.disabled = true;
        btn.textContent = '文字起こし中...';

        document.getElementById('importTranscript').style.display = 'block';
        const textEl = document.getElementById('importTranscriptText');
        textEl.innerHTML = '<span style="color:var(--text-secondary)">音声を再生して文字起こしています...</span>';

        // 音声を先頭に戻す
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
        if (!transcriptResult || !currentFile) return null;

        const mode = document.getElementById('importMode').value;
        const summary = VNSummarizer.summarize(transcriptResult.fullText || '', mode);

        const record = {
            id: 'rec_' + Date.now(),
            title: currentFile.name.replace(/\.[^/.]+$/, ''),
            mode: mode,
            date: new Date().toISOString(),
            duration: Math.floor(audioElement.duration || 0),
            transcript: transcriptResult.fullText || '',
            segments: transcriptResult.segments || [],
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
