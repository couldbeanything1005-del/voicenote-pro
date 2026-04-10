// === 録音エンジン ===
const VNRecorder = (() => {
    let mediaRecorder = null;
    let audioChunks = [];
    let audioStream = null;
    let analyser = null;
    let audioContext = null;
    let startTime = 0;
    let pausedDuration = 0;
    let pauseStart = 0;
    let timerInterval = null;
    let isRecording = false;
    let isPaused = false;
    let bookmarks = [];
    let waveformCanvas = null;
    let waveformCtx = null;
    let animationId = null;

    // Safari/iOS判定
    const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent) ||
                     /iPad|iPhone|iPod/.test(navigator.userAgent);

    function init(canvas) {
        waveformCanvas = canvas;
        waveformCtx = canvas.getContext('2d');
        drawIdleWaveform();
    }

    // Safari/iOS対応のMIMEタイプ選択
    function getSupportedMimeType() {
        const types = [
            'audio/webm;codecs=opus',
            'audio/webm',
            'audio/mp4',
            'audio/aac',
            'audio/ogg;codecs=opus',
            ''  // デフォルト（ブラウザ任せ）
        ];
        for (const type of types) {
            if (!type) return undefined; // オプションなしで作成
            try {
                if (MediaRecorder.isTypeSupported(type)) return type;
            } catch(e) {}
        }
        return undefined;
    }

    async function start() {
        try {
            // マイク許可を要求
            audioStream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true
                }
            });

            // AudioContext（Safari対応）
            audioContext = new (window.AudioContext || window.webkitAudioContext)();
            // iOS Safariではユーザー操作後にresumeが必要
            if (audioContext.state === 'suspended') {
                await audioContext.resume();
            }

            const source = audioContext.createMediaStreamSource(audioStream);
            analyser = audioContext.createAnalyser();
            analyser.fftSize = 256;
            source.connect(analyser);

            // Safari/iOS対応のMIMEタイプ
            const mimeType = getSupportedMimeType();
            const options = mimeType ? { mimeType } : {};

            mediaRecorder = new MediaRecorder(audioStream, options);
            audioChunks = [];
            bookmarks = [];

            mediaRecorder.ondataavailable = e => {
                if (e.data.size > 0) audioChunks.push(e.data);
            };

            mediaRecorder.onerror = e => {
                console.error('MediaRecorder エラー:', e.error);
            };

            mediaRecorder.start(1000);
            startTime = Date.now();
            pausedDuration = 0;
            isRecording = true;
            isPaused = false;

            startTimer();
            drawWaveform();

            return true;
        } catch (err) {
            console.error('録音開始エラー:', err.name, err.message);
            // エラーの種類に応じたメッセージ
            if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
                VNUI.showToast('マイクの使用を許可してください');
            } else if (err.name === 'NotFoundError') {
                VNUI.showToast('マイクが見つかりません');
            } else if (err.name === 'NotSupportedError') {
                VNUI.showToast('この端末では録音に対応していません');
            } else {
                VNUI.showToast('録音を開始できません: ' + err.message);
            }
            return false;
        }
    }

    function pause() {
        if (!isRecording || isPaused) return;
        try {
            mediaRecorder.pause();
            isPaused = true;
            pauseStart = Date.now();
            cancelAnimationFrame(animationId);
        } catch(e) {
            console.warn('一時停止エラー:', e);
        }
    }

    function resume() {
        if (!isRecording || !isPaused) return;
        try {
            mediaRecorder.resume();
            isPaused = false;
            pausedDuration += Date.now() - pauseStart;
            drawWaveform();
        } catch(e) {
            console.warn('再開エラー:', e);
        }
    }

    function stop() {
        return new Promise(resolve => {
            if (!mediaRecorder || mediaRecorder.state === 'inactive') {
                resolve(null);
                return;
            }

            mediaRecorder.onstop = () => {
                const mimeType = mediaRecorder.mimeType || 'audio/mp4';
                const blob = new Blob(audioChunks, { type: mimeType });
                const duration = getElapsedSeconds();

                cleanup();

                resolve({
                    blob,
                    duration,
                    bookmarks: [...bookmarks],
                    mimeType
                });
            };

            if (isPaused) {
                pausedDuration += Date.now() - pauseStart;
                isPaused = false;
            }

            try {
                mediaRecorder.stop();
            } catch(e) {
                cleanup();
                resolve(null);
            }
        });
    }

    function addBookmark() {
        if (!isRecording) return null;
        const time = getElapsedSeconds();
        const bm = { time, label: `マーク ${bookmarks.length + 1}` };
        bookmarks.push(bm);
        return bm;
    }

    function getElapsedSeconds() {
        if (!startTime) return 0;
        let elapsed = Date.now() - startTime - pausedDuration;
        if (isPaused) elapsed -= (Date.now() - pauseStart);
        return Math.max(0, Math.floor(elapsed / 1000));
    }

    function formatTime(seconds) {
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = seconds % 60;
        return [h, m, s].map(v => String(v).padStart(2, '0')).join(':');
    }

    function startTimer() {
        clearInterval(timerInterval);
        timerInterval = setInterval(() => {
            const el = document.getElementById('recordTimer');
            if (el) el.textContent = formatTime(getElapsedSeconds());
        }, 200);
    }

    function cleanup() {
        clearInterval(timerInterval);
        cancelAnimationFrame(animationId);
        if (audioStream) {
            audioStream.getTracks().forEach(t => t.stop());
            audioStream = null;
        }
        if (audioContext && audioContext.state !== 'closed') {
            try { audioContext.close(); } catch(e) {}
            audioContext = null;
        }
        mediaRecorder = null;
        analyser = null;
        isRecording = false;
        isPaused = false;
        startTime = 0;
        drawIdleWaveform();
    }

    function drawWaveform() {
        if (!analyser || !waveformCtx) return;
        const bufferLength = analyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);
        const W = waveformCanvas.width;
        const H = waveformCanvas.height;
        const isDark = document.documentElement.getAttribute('data-theme') === 'dark';

        function draw() {
            animationId = requestAnimationFrame(draw);
            analyser.getByteTimeDomainData(dataArray);

            waveformCtx.fillStyle = isDark ? '#0f0f23' : '#f0f0f5';
            waveformCtx.fillRect(0, 0, W, H);

            waveformCtx.lineWidth = 2;
            waveformCtx.strokeStyle = '#0071e3';
            waveformCtx.beginPath();

            const sliceWidth = W / bufferLength;
            let x = 0;

            for (let i = 0; i < bufferLength; i++) {
                const v = dataArray[i] / 128.0;
                const y = (v * H) / 2;
                if (i === 0) waveformCtx.moveTo(x, y);
                else waveformCtx.lineTo(x, y);
                x += sliceWidth;
            }

            waveformCtx.lineTo(W, H / 2);
            waveformCtx.stroke();
        }
        draw();
    }

    function drawIdleWaveform() {
        if (!waveformCtx || !waveformCanvas) return;
        const W = waveformCanvas.width;
        const H = waveformCanvas.height;
        const isDark = document.documentElement.getAttribute('data-theme') === 'dark';

        waveformCtx.fillStyle = isDark ? '#0f0f23' : '#f0f0f5';
        waveformCtx.fillRect(0, 0, W, H);
        waveformCtx.strokeStyle = isDark ? '#2d2d44' : '#d2d2d7';
        waveformCtx.lineWidth = 1;
        waveformCtx.beginPath();
        waveformCtx.moveTo(0, H / 2);
        waveformCtx.lineTo(W, H / 2);
        waveformCtx.stroke();
    }

    return {
        init, start, pause, resume, stop, addBookmark,
        getElapsedSeconds, formatTime, drawIdleWaveform,
        get isRecording() { return isRecording; },
        get isPaused() { return isPaused; }
    };
})();
