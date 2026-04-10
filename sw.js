const CACHE_NAME = 'voicenote-pro-v3';
const ASSETS = [
    './',
    './index.html',
    './css/style.css',
    './js/app.js',
    './js/recorder.js',
    './js/transcriber.js',
    './js/summarizer.js',
    './js/importer.js',
    './js/gdrive.js',
    './js/storage.js',
    './js/ui.js',
    './manifest.json'
];

self.addEventListener('install', e => {
    e.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS)));
    self.skipWaiting();
});

self.addEventListener('activate', e => {
    e.waitUntil(
        caches.keys().then(keys =>
            Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
        )
    );
    self.clients.claim();
});

self.addEventListener('fetch', e => {
    // Web Share Target: メモアプリ等から共有された音声ファイルを処理
    if (e.request.method === 'POST' && e.request.url.includes('share=true')) {
        e.respondWith((async () => {
            const formData = await e.request.formData();
            const audioFile = formData.get('audio');

            // 共有されたファイルをクライアントに渡す
            const client = await self.clients.get(e.resultingClientId || e.clientId);
            if (client && audioFile) {
                client.postMessage({
                    type: 'shared-audio',
                    file: audioFile
                });
            }

            // インポート画面にリダイレクト
            return Response.redirect('./index.html?view=import', 303);
        })());
        return;
    }

    e.respondWith(
        caches.match(e.request).then(cached => cached || fetch(e.request))
    );
});
