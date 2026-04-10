// === 文字起こしエンジン ===
const VNTranscriber = (() => {
    let recognition = null;
    let isActive = false;
    let segments = [];
    let currentText = '';
    let startTimestamp = 0;
    let onUpdate = null;
    let onFinal = null;
    let restartTimeout = null;

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    const isSupported = !!SpeechRecognition;

    // iOS Safari判定
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
                  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

    function init(callbacks = {}) {
        onUpdate = callbacks.onUpdate || null;
        onFinal = callbacks.onFinal || null;
    }

    function start(refTime) {
        segments = [];
        currentText = '';
        startTimestamp = refTime || Date.now();

        if (!isSupported) {
            // 非対応端末: 手動入力モード表示
            isActive = true;
            if (onUpdate) onUpdate('', []);
            return true;
        }

        createRecognition();
        try {
            recognition.start();
            isActive = true;
        } catch(e) {
            console.warn('音声認識開始エラー:', e);
            isActive = true; // 録音は続行
        }
        return true;
    }

    function createRecognition() {
        if (!isSupported) return;
        if (recognition) {
            try { recognition.abort(); } catch(e) {}
        }

        recognition = new SpeechRecognition();
        recognition.lang = 'ja-JP';
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.maxAlternatives = 1;

        recognition.onresult = e => {
            let interim = '';
            for (let i = e.resultIndex; i < e.results.length; i++) {
                const result = e.results[i];
                const text = result[0].transcript;

                if (result.isFinal) {
                    const elapsed = Math.floor((Date.now() - startTimestamp) / 1000);
                    const segment = {
                        time: elapsed,
                        text: text.trim(),
                        timestamp: formatTimestamp(elapsed)
                    };
                    segments.push(segment);
                    if (onFinal) onFinal(segment, segments);
                } else {
                    interim += text;
                }
            }
            currentText = interim;
            if (onUpdate) onUpdate(currentText, segments);
        };

        recognition.onerror = e => {
            if (e.error === 'no-speech' || e.error === 'aborted') return;
            console.warn('音声認識エラー:', e.error);
        };

        recognition.onend = () => {
            if (isActive) {
                clearTimeout(restartTimeout);
                restartTimeout = setTimeout(() => {
                    if (isActive && isSupported) {
                        try {
                            createRecognition();
                            recognition.start();
                        } catch(e) {}
                    }
                }, 300);
            }
        };
    }

    function stop() {
        isActive = false;
        clearTimeout(restartTimeout);
        if (recognition) {
            try { recognition.stop(); } catch(e) {}
            recognition = null;
        }
        return {
            segments: [...segments],
            fullText: getFullText()
        };
    }

    function getFullText() {
        return segments.map(s => `[${s.timestamp}] ${s.text}`).join('\n');
    }

    function getPlainText() {
        return segments.map(s => s.text).join('');
    }

    function formatTimestamp(seconds) {
        const m = Math.floor(seconds / 60);
        const s = seconds % 60;
        return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    }

    function buildTranscriptHTML(segs, bms = []) {
        let html = '';
        const bmTimes = new Set(bms.map(b => b.time));

        for (const seg of segs) {
            if (bmTimes.has(seg.time)) {
                html += `<span class="bookmark-mark">🔖 マーク</span>\n`;
            }
            html += `<span class="timestamp">[${seg.timestamp}]</span>${escapeHTML(seg.text)}\n`;
        }
        return html;
    }

    function escapeHTML(str) {
        const d = document.createElement('div');
        d.textContent = str;
        return d.innerHTML;
    }

    // インポート音声の文字起こし（音声再生しながらSpeech APIで認識）
    function transcribeFromAudio(audioElement, callbacks = {}) {
        return new Promise((resolve) => {
            if (!isSupported) {
                // 非対応端末: 音声だけ再生して手動入力を促す
                resolve({
                    segments: [],
                    fullText: '',
                    manualRequired: true
                });
                return;
            }

            const segs = [];

            const rec = new SpeechRecognition();
            rec.lang = 'ja-JP';
            rec.continuous = true;
            rec.interimResults = true;
            rec.maxAlternatives = 1;

            rec.onresult = e => {
                for (let i = e.resultIndex; i < e.results.length; i++) {
                    const result = e.results[i];
                    const text = result[0].transcript;

                    if (result.isFinal) {
                        const elapsed = Math.floor(audioElement.currentTime);
                        const seg = {
                            time: elapsed,
                            text: text.trim(),
                            timestamp: formatTimestamp(elapsed)
                        };
                        segs.push(seg);
                        if (callbacks.onFinal) callbacks.onFinal(seg, segs);
                    } else {
                        if (callbacks.onUpdate) callbacks.onUpdate(text, segs);
                    }
                }
            };

            rec.onend = () => {
                if (!audioElement.paused && !audioElement.ended) {
                    try { rec.start(); } catch(e) {}
                }
            };

            rec.onerror = e => {
                if (e.error !== 'no-speech' && e.error !== 'aborted') {
                    console.warn('インポート文字起こしエラー:', e.error);
                }
            };

            audioElement.onended = () => {
                try { rec.stop(); } catch(e) {}
                resolve({
                    segments: segs,
                    fullText: segs.map(s => `[${s.timestamp}] ${s.text}`).join('\n'),
                    manualRequired: false
                });
            };

            audioElement.play();
            try { rec.start(); } catch(e) {}
        });
    }

    return {
        init, start, stop, getFullText, getPlainText, buildTranscriptHTML,
        transcribeFromAudio, formatTimestamp,
        get isSupported() { return isSupported; },
        get isIOS() { return isIOS; },
        get isActive() { return isActive; },
        get segments() { return [...segments]; }
    };
})();
