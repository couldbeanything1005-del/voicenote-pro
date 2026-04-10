// === VoiceNote Pro v2 - All-in-one ===
(function(){
'use strict';

// ============================================================
// DB
// ============================================================
const DB={name:'VNP2',ver:1,store:'records',db:null};
function dbOpen(){
    return new Promise((ok,ng)=>{
        if(DB.db)return ok(DB.db);
        const r=indexedDB.open(DB.name,DB.ver);
        r.onupgradeneeded=e=>{
            const d=e.target.result;
            if(!d.objectStoreNames.contains(DB.store)){
                const s=d.createObjectStore(DB.store,{keyPath:'id'});
                s.createIndex('cat','cat');s.createIndex('date','date');
            }
        };
        r.onsuccess=e=>{DB.db=e.target.result;ok(DB.db)};
        r.onerror=e=>ng(e.target.error);
    });
}
function dbTx(mode){return dbOpen().then(d=>d.transaction(DB.store,mode).objectStore(DB.store))}
function dbSave(rec){return dbTx('readwrite').then(s=>new Promise((ok,ng)=>{const r=s.put(rec);r.onsuccess=()=>ok();r.onerror=e=>ng(e)}))}
function dbAll(){return dbTx('readonly').then(s=>new Promise((ok,ng)=>{const r=s.getAll();r.onsuccess=()=>{const d=r.result||[];d.sort((a,b)=>new Date(b.date)-new Date(a.date));ok(d)};r.onerror=e=>ng(e)}))}
function dbGet(id){return dbTx('readonly').then(s=>new Promise((ok,ng)=>{const r=s.get(id);r.onsuccess=()=>ok(r.result);r.onerror=e=>ng(e)}))}
function dbDel(id){return dbTx('readwrite').then(s=>new Promise((ok,ng)=>{const r=s.delete(id);r.onsuccess=()=>ok();r.onerror=e=>ng(e)}))}

// ============================================================
// 要約エンジン
// ============================================================
const CAT_LABELS={phone:'📞 電話',meeting:'🏢 会議',medical:'🏥 診察'};
const TEMPLATES={
    phone:[
        {label:'通話相手',words:['さん','様','氏','先生','部長','課長','社長','担当','から','より']},
        {label:'用件',words:['について','の件','確認','報告','相談','依頼','お願い','連絡','ご案内']},
        {label:'決定事項',words:['決まり','決定','にします','にしましょう','でいきます','で進め','ことにし','了承','合意']},
        {label:'フォローアップ',words:['してください','お願い','確認し','送って','連絡し','準備','手配','対応','報告','提出']},
        {label:'期限・日時',extract:'dates'}
    ],
    meeting:[
        {label:'議題',words:['について','に関して','の件','テーマ','議題','話題']},
        {label:'決定事項',words:['決まり','決定','にします','にしましょう','でいきます','で進め','ことにし','了承']},
        {label:'アクションアイテム',words:['してください','お願い','確認し','準備','手配','対応','進めて','まとめ','報告']},
        {label:'次回予定',extract:'dates'}
    ],
    medical:[
        {label:'症状',words:['痛い','痛み','腫れ','熱','咳','頭痛','腹痛','吐き気','だるい','倦怠','食欲','眠れ','息苦し','めまい','しびれ','症状']},
        {label:'診断',words:['診断','可能性','かもしれ','疑い','思われ','考えられ','症','炎','病','感染']},
        {label:'処方薬',words:['薬','処方','錠','mg','飲んで','塗って','注射','カプセル','服用','朝','食後','食前']},
        {label:'注意事項',words:['してください','しないで','控えて','注意','気をつけ','安静','運動','食事','制限','避けて','水分']},
        {label:'次回受診',extract:'dates'}
    ]
};

function summarize(text,cat){
    const sents=text.split(/[。！？!?\n]+/).map(s=>s.trim()).filter(s=>s.length>3);
    const tmpl=TEMPLATES[cat]||TEMPLATES.phone;
    const sections=[];

    for(const sec of tmpl){
        let items=[];
        if(sec.extract==='dates'){
            items=extractDates(text);
        }else{
            items=sents.filter(s=>sec.words.some(w=>s.includes(w))).slice(0,5);
        }
        sections.push({label:sec.label,items});
    }
    return sections;
}

function extractDates(text){
    const pats=[
        /\d{1,2}月\d{1,2}日[^。、]{0,15}/g,
        /(?:来週|今週|再来週|今月|来月)[^\s。、]{0,15}/g,
        /(?:月曜|火曜|水曜|木曜|金曜|土曜|日曜)日?[^\s。、]{0,12}/g,
        /\d{1,2}時[^\s。、]{0,8}/g,
        /(?:明日|明後日|今日)[^\s。、]{0,12}/g
    ];
    const found=new Set();
    for(const p of pats){let m;while((m=p.exec(text))!==null)found.add(m[0].trim())}
    return[...found].slice(0,5);
}

function summaryToHTML(sections){
    return sections.map(s=>{
        const items=s.items.length>0
            ? s.items.map(i=>`<span class="sec-item">・${esc(i)}</span>`).join('\n')
            : '<span class="sec-empty">（検出なし）</span>';
        return `<span class="sec-title">■ ${esc(s.label)}</span>\n${items}`;
    }).join('\n\n');
}

function summaryToText(sections,cat){
    let t=`【${CAT_LABELS[cat]||cat}】\n\n`;
    for(const s of sections){
        t+=`■ ${s.label}\n`;
        t+=s.items.length>0?s.items.map(i=>`  ・${i}`).join('\n')+'\n':'  （検出なし）\n';
        t+='\n';
    }
    return t;
}

// ============================================================
// Google Drive同期
// ============================================================
function gdriveUrl(){return localStorage.getItem('vnp-gdrive')||''}
function gdriveEnabled(){return!!gdriveUrl()}
async function gdriveSend(record){
    const url=gdriveUrl();if(!url)return;
    try{
        await fetch(url,{method:'POST',headers:{'Content-Type':'text/plain'},
            body:JSON.stringify({action:'save',id:record.id,title:record.title,mode:record.cat,
                date:record.date,duration:0,transcript:record.text,summary:record.summaryText,
                bookmarks:[],tags:[record.cat]})});
    }catch(e){console.warn('GDrive同期エラー:',e)}
}
async function gdriveTest(){
    const url=gdriveUrl();if(!url)return{success:false,error:'URL未設定'};
    try{
        const r=await fetch(url,{method:'POST',headers:{'Content-Type':'text/plain'},
            body:JSON.stringify({action:'test'})});
        return await r.json();
    }catch(e){return{success:false,error:e.message}}
}

// ============================================================
// UI
// ============================================================
const $=id=>document.getElementById(id);
let currentCat='phone';
let currentRecord=null;

function toast(msg){
    const t=$('toast');t.textContent=msg;t.classList.add('show');
    setTimeout(()=>t.classList.remove('show'),2500);
}
function esc(s){const d=document.createElement('div');d.textContent=s;return d.innerHTML}

// ナビゲーション
document.querySelectorAll('.nav-btn').forEach(b=>{
    b.addEventListener('click',()=>{
        document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
        document.querySelectorAll('.nav-btn').forEach(n=>n.classList.remove('active'));
        $(b.dataset.view).classList.add('active');
        b.classList.add('active');
        if(b.dataset.view==='historyView')refreshHistory();
    });
});

// ダークモード
const saved=localStorage.getItem('vnp-theme');
if(saved==='dark'||(!saved&&matchMedia('(prefers-color-scheme:dark)').matches)){
    document.documentElement.setAttribute('data-theme','dark');
    $('themeBtn').textContent='☀️';
}
$('themeBtn').addEventListener('click',()=>{
    const dark=document.documentElement.getAttribute('data-theme')==='dark';
    document.documentElement.setAttribute('data-theme',dark?'':'dark');
    $('themeBtn').textContent=dark?'🌙':'☀️';
    localStorage.setItem('vnp-theme',dark?'light':'dark');
});

// カテゴリ選択
document.querySelectorAll('.cat-btn').forEach(b=>{
    b.addEventListener('click',()=>{
        document.querySelectorAll('.cat-btn').forEach(c=>c.classList.remove('active'));
        b.classList.add('active');
        currentCat=b.dataset.cat;
    });
});

// テキスト入力
const textInput=$('textInput');
const charCount=$('charCount');
const summarizeBtn=$('summarizeBtn');

textInput.addEventListener('input',()=>{
    const len=textInput.value.length;
    charCount.textContent=len+' 文字';
    summarizeBtn.disabled=len<10;
});

// 貼り付けボタン
$('pasteBtn').addEventListener('click',async()=>{
    try{
        const text=await navigator.clipboard.readText();
        textInput.value=text;
        textInput.dispatchEvent(new Event('input'));
        toast('貼り付けました');
    }catch(e){
        toast('貼り付けできません。テキストを長押しして貼り付けてください');
    }
});

// 要約作成
summarizeBtn.addEventListener('click',()=>{
    const text=textInput.value.trim();
    if(text.length<10)return;

    const sections=summarize(text,currentCat);
    const title=$('titleInput').value.trim()||generateTitle(currentCat);

    currentRecord={
        id:'r'+Date.now(),
        title,cat:currentCat,
        date:new Date().toISOString(),
        text,
        sections,
        summaryHTML:summaryToHTML(sections),
        summaryText:summaryToText(sections,currentCat)
    };

    $('resultTitle').textContent=CAT_LABELS[currentCat]+' '+title;
    $('resultSummary').innerHTML=currentRecord.summaryHTML;
    $('resultCard').style.display='block';
    $('resultCard').scrollIntoView({behavior:'smooth'});
});

// コピー
$('copyResultBtn').addEventListener('click',()=>{
    if(!currentRecord)return;
    navigator.clipboard.writeText(currentRecord.summaryText).then(()=>toast('コピーしました')).catch(()=>toast('コピーできません'));
});

// 保存
$('saveResultBtn').addEventListener('click',async()=>{
    if(!currentRecord)return;
    await dbSave(currentRecord);
    if(gdriveEnabled())gdriveSend(currentRecord);
    toast('保存しました');
    // リセット
    textInput.value='';$('titleInput').value='';
    charCount.textContent='0 文字';summarizeBtn.disabled=true;
    $('resultCard').style.display='none';
    currentRecord=null;
});

// ============================================================
// 履歴
// ============================================================
async function refreshHistory(){
    const filter=document.querySelector('.filter-btn.active')?.dataset.filter||'all';
    const q=($('searchInput')?.value||'').toLowerCase();
    let records=await dbAll();
    if(filter!=='all')records=records.filter(r=>r.cat===filter);
    if(q)records=records.filter(r=>(r.text+r.title+r.summaryText).toLowerCase().includes(q));
    renderHistory(records);
    renderStats(await dbAll());
}

function renderHistory(records){
    const list=$('historyList');
    if(!records.length){list.innerHTML='<p class="empty">まだ保存がありません</p>';return}
    list.innerHTML=records.map(r=>{
        const d=new Date(r.date);
        const ds=`${d.getFullYear()}/${d.getMonth()+1}/${d.getDate()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
        const preview=(r.summaryText||r.text||'').substring(0,80).replace(/\n/g,' ');
        return`<div class="h-item" data-id="${r.id}">
            <div class="h-row"><span class="h-title">${esc(r.title)}</span><span class="h-badge">${CAT_LABELS[r.cat]||r.cat}</span></div>
            <div class="h-meta">${ds}</div>
            <div class="h-preview">${esc(preview)}</div>
        </div>`;
    }).join('');
    list.querySelectorAll('.h-item').forEach(el=>{
        el.addEventListener('click',()=>openModal(el.dataset.id));
    });
}

function renderStats(all){
    const now=new Date();
    const thisMonth=all.filter(r=>{const d=new Date(r.date);return d.getMonth()===now.getMonth()&&d.getFullYear()===now.getFullYear()});
    $('stats').innerHTML=`
        <div><div class="val">${all.length}</div><div class="lbl">総件数</div></div>
        <div><div class="val">${thisMonth.length}</div><div class="lbl">今月</div></div>
    `;
}

// フィルタ
document.querySelectorAll('.filter-btn').forEach(b=>{
    b.addEventListener('click',()=>{
        document.querySelectorAll('.filter-btn').forEach(f=>f.classList.remove('active'));
        b.classList.add('active');refreshHistory();
    });
});
let searchDebounce;
$('searchInput')?.addEventListener('input',()=>{
    clearTimeout(searchDebounce);searchDebounce=setTimeout(refreshHistory,300);
});

// モーダル
async function openModal(id){
    const r=await dbGet(id);if(!r)return;
    $('modalTitle').textContent=r.title;
    $('modalSummary').innerHTML=r.summaryHTML||esc(r.summaryText||'');
    $('modalFull').textContent=r.text||'';

    // タブリセット
    document.querySelectorAll('.mtab').forEach(t=>t.classList.remove('active'));
    document.querySelectorAll('.mtab-content').forEach(c=>c.classList.remove('active'));
    document.querySelector('.mtab[data-t="sum"]').classList.add('active');
    $('tabSum').classList.add('active');

    $('modalCopy').onclick=()=>{
        navigator.clipboard.writeText(r.summaryText||r.text||'').then(()=>toast('コピーしました')).catch(()=>{});
    };
    $('modalDelete').onclick=async()=>{
        if(confirm('削除しますか？')){
            await dbDel(id);$('modal').style.display='none';refreshHistory();toast('削除しました');
        }
    };
    $('modal').style.display='flex';
}
$('modalClose').addEventListener('click',()=>$('modal').style.display='none');
$('modal').addEventListener('click',e=>{if(e.target===$('modal'))$('modal').style.display='none'});

// モーダルタブ
document.querySelectorAll('.mtab').forEach(t=>{
    t.addEventListener('click',()=>{
        document.querySelectorAll('.mtab').forEach(x=>x.classList.remove('active'));
        document.querySelectorAll('.mtab-content').forEach(x=>x.classList.remove('active'));
        t.classList.add('active');
        $(t.dataset.t==='sum'?'tabSum':'tabFull').classList.add('active');
    });
});

// ============================================================
// 設定
// ============================================================
$('gdriveUrl').value=gdriveUrl();
updateGdriveStatus();

$('gdriveSaveBtn').addEventListener('click',()=>{
    localStorage.setItem('vnp-gdrive',$('gdriveUrl').value.trim());
    updateGdriveStatus();toast('保存しました');
});
$('gdriveTestBtn').addEventListener('click',async()=>{
    localStorage.setItem('vnp-gdrive',$('gdriveUrl').value.trim());
    $('gdriveTestBtn').textContent='テスト中...';
    const r=await gdriveTest();
    $('gdriveTestBtn').textContent='テスト';
    toast(r.success?'接続成功！':'接続失敗: '+(r.error||''));
    updateGdriveStatus();
});
function updateGdriveStatus(){
    const on=gdriveEnabled();
    $('gdriveStatus').innerHTML=`<span class="dot ${on?'on':'off'}"></span>${on?'接続済み':'未接続'}`;
}

// ============================================================
// ユーティリティ
// ============================================================
function generateTitle(cat){
    const n=new Date();
    const labels={phone:'電話',meeting:'会議',medical:'診察'};
    return`${labels[cat]||'メモ'} ${n.getMonth()+1}/${n.getDate()} ${String(n.getHours()).padStart(2,'0')}:${String(n.getMinutes()).padStart(2,'0')}`;
}

// Service Worker
if('serviceWorker' in navigator)navigator.serviceWorker.register('./sw.js').catch(()=>{});

// DB初期化
dbOpen().then(()=>console.log('VoiceNote Pro v2 ready'));

})();
