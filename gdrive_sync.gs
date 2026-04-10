/**
 * VoiceNote Pro - Google Drive同期バックエンド
 *
 * 【セットアップ手順】
 * 1. Google Apps Script (https://script.google.com) で新しいプロジェクトを作成
 * 2. このコードを貼り付け
 * 3. FOLDER_ID を保存先のGoogleドライブフォルダIDに変更
 *    （フォルダのURLの最後の部分: https://drive.google.com/drive/folders/XXXXX ← これ）
 * 4. 「デプロイ」→「新しいデプロイ」→ 種類:「ウェブアプリ」
 *    - 実行するユーザー: 自分
 *    - アクセス: 全員
 * 5. デプロイURLをコピーしてアプリの設定画面に貼り付け
 */

// === 設定 ===
const FOLDER_ID = 'ここにフォルダIDを貼り付け';

// === メイン処理 ===

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const action = data.action;

    switch (action) {
      case 'save':
        return handleSave(data);
      case 'list':
        return handleList(data);
      case 'delete':
        return handleDelete(data);
      case 'test':
        return jsonResponse({ success: true, message: '接続成功！' });
      default:
        return jsonResponse({ success: false, error: '不明なアクション: ' + action });
    }
  } catch (err) {
    return jsonResponse({ success: false, error: err.message });
  }
}

function doGet(e) {
  return jsonResponse({ success: true, message: 'VoiceNote Pro API稼働中', version: '1.0' });
}

// === 保存処理 ===
function handleSave(data) {
  const folder = getOrCreateSubfolder(data.mode || 'other');
  const timestamp = Utilities.formatDate(new Date(data.date || new Date()), 'Asia/Tokyo', 'yyyy-MM-dd_HH-mm');
  const title = data.title || ('録音_' + timestamp);
  const recordId = data.id || ('rec_' + Date.now());

  // 文字起こしテキスト保存
  if (data.transcript) {
    const transcriptName = `${title}_文字起こし.txt`;
    const transcriptContent = buildTranscriptFile(data);
    saveOrUpdateFile(folder, transcriptName, transcriptContent, recordId, 'transcript');
  }

  // 要約テキスト保存
  if (data.summary) {
    const summaryName = `${title}_要約.txt`;
    const summaryContent = buildSummaryFile(data);
    saveOrUpdateFile(folder, summaryName, summaryContent, recordId, 'summary');
  }

  // メタデータJSON保存
  const metaName = `${title}_meta.json`;
  const meta = {
    id: recordId,
    title: title,
    mode: data.mode,
    date: data.date,
    duration: data.duration,
    bookmarks: data.bookmarks || [],
    tags: data.tags || [],
    savedAt: new Date().toISOString()
  };
  saveOrUpdateFile(folder, metaName, JSON.stringify(meta, null, 2), recordId, 'meta');

  return jsonResponse({
    success: true,
    message: '保存しました',
    folderId: folder.getId(),
    folderName: folder.getName()
  });
}

// === ファイル保存/更新 ===
function saveOrUpdateFile(folder, fileName, content, recordId, type) {
  // 同名ファイルがあれば更新
  const existing = folder.getFilesByName(fileName);
  if (existing.hasNext()) {
    const file = existing.next();
    file.setContent(content);
    return file;
  }
  // なければ新規作成
  return folder.createFile(fileName, content, 'text/plain; charset=utf-8');
}

// === サブフォルダ管理 ===
function getOrCreateSubfolder(mode) {
  const parentFolder = DriveApp.getFolderById(FOLDER_ID);
  const modeLabels = {
    phone: '📞 電話録音',
    meeting: '🏢 会議録音',
    medical: '🏥 診察録音',
    memo: '📝 メモ',
    other: '📁 その他'
  };
  const subName = modeLabels[mode] || modeLabels.other;

  const folders = parentFolder.getFoldersByName(subName);
  if (folders.hasNext()) return folders.next();
  return parentFolder.createFolder(subName);
}

// === ファイル一覧 ===
function handleList(data) {
  const parentFolder = DriveApp.getFolderById(FOLDER_ID);
  const files = [];

  // サブフォルダ内のメタファイルを検索
  const subFolders = parentFolder.getFolders();
  while (subFolders.hasNext()) {
    const sub = subFolders.next();
    const metaFiles = sub.getFilesByType('text/plain');
    while (metaFiles.hasNext()) {
      const f = metaFiles.next();
      if (f.getName().endsWith('_meta.json')) {
        try {
          const meta = JSON.parse(f.getBlob().getDataAsString());
          files.push(meta);
        } catch (e) {}
      }
    }
  }

  files.sort((a, b) => new Date(b.date) - new Date(a.date));

  return jsonResponse({ success: true, files: files });
}

// === 削除 ===
function handleDelete(data) {
  if (!data.title) return jsonResponse({ success: false, error: 'タイトルが必要です' });

  const parentFolder = DriveApp.getFolderById(FOLDER_ID);
  let deleted = 0;

  const subFolders = parentFolder.getFolders();
  while (subFolders.hasNext()) {
    const sub = subFolders.next();
    const files = sub.getFiles();
    while (files.hasNext()) {
      const f = files.next();
      if (f.getName().startsWith(data.title)) {
        f.setTrashed(true);
        deleted++;
      }
    }
  }

  return jsonResponse({ success: true, deleted: deleted });
}

// === テキストファイル生成 ===
function buildTranscriptFile(data) {
  let text = '';
  text += '=' .repeat(50) + '\n';
  text += `📝 ${data.title || '無題'}\n`;
  text += '=' .repeat(50) + '\n';
  text += `日時: ${formatJST(data.date)}\n`;
  text += `録音時間: ${formatDuration(data.duration || 0)}\n`;
  text += `種類: ${getModeLabel(data.mode)}\n`;
  text += '-'.repeat(50) + '\n\n';
  text += data.transcript || '（文字起こしなし）';
  text += '\n';

  if (data.bookmarks && data.bookmarks.length > 0) {
    text += '\n' + '-'.repeat(50) + '\n';
    text += '🔖 ブックマーク:\n';
    data.bookmarks.forEach(bm => {
      text += `  [${formatDuration(bm.time)}] ${bm.label}\n`;
    });
  }

  return text;
}

function buildSummaryFile(data) {
  let text = '';
  text += '='.repeat(50) + '\n';
  text += `📋 要約: ${data.title || '無題'}\n`;
  text += '='.repeat(50) + '\n';
  text += `日時: ${formatJST(data.date)}\n`;
  text += `種類: ${getModeLabel(data.mode)}\n`;
  text += '-'.repeat(50) + '\n\n';
  text += data.summary || '（要約なし）';
  return text;
}

// === ユーティリティ ===
function getModeLabel(mode) {
  const labels = { phone: '電話', meeting: '会議', medical: '診察', memo: 'メモ' };
  return labels[mode] || mode || '不明';
}

function formatDuration(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return [h, m, s].map(v => String(v).padStart(2, '0')).join(':');
}

function formatJST(dateStr) {
  if (!dateStr) return '不明';
  return Utilities.formatDate(new Date(dateStr), 'Asia/Tokyo', 'yyyy/MM/dd HH:mm');
}

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
