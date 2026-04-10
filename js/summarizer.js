// === 要約エンジン ===
const VNSummarizer = (() => {
    // 録音モード別テンプレート
    const templates = {
        phone: {
            title: '電話メモ',
            icon: '📞',
            sections: [
                { key: 'parties', label: '通話相手', extract: extractParties },
                { key: 'purpose', label: '用件', extract: extractPurpose },
                { key: 'decisions', label: '決定事項', extract: extractDecisions },
                { key: 'actions', label: '要フォローアップ', extract: extractActions },
                { key: 'dates', label: '日時・期限', extract: extractDates }
            ]
        },
        meeting: {
            title: '会議メモ',
            icon: '🏢',
            sections: [
                { key: 'topics', label: '議題・話題', extract: extractTopics },
                { key: 'decisions', label: '決定事項', extract: extractDecisions },
                { key: 'actions', label: 'アクションアイテム', extract: extractActions },
                { key: 'dates', label: '次回予定・期限', extract: extractDates },
                { key: 'notes', label: '備考', extract: extractNotes }
            ]
        },
        medical: {
            title: '診察メモ',
            icon: '🏥',
            sections: [
                { key: 'symptoms', label: '症状', extract: extractSymptoms },
                { key: 'diagnosis', label: '診断', extract: extractDiagnosis },
                { key: 'medication', label: '処方薬', extract: extractMedication },
                { key: 'instructions', label: '指示・注意事項', extract: extractInstructions },
                { key: 'nextVisit', label: '次回受診', extract: extractDates }
            ]
        },
        memo: {
            title: 'メモ',
            icon: '📝',
            sections: [
                { key: 'topics', label: '話題', extract: extractTopics },
                { key: 'keypoints', label: '要点', extract: extractKeyPoints },
                { key: 'actions', label: 'TODO', extract: extractActions },
                { key: 'dates', label: '日時', extract: extractDates }
            ]
        }
    };

    function summarize(text, mode = 'memo') {
        const template = templates[mode] || templates.memo;
        const lines = text.split('\n').filter(l => l.trim());
        const plainText = lines.map(l => l.replace(/^\[[\d:]+\]\s*/, '')).join('。');

        const result = {
            mode,
            title: template.title,
            icon: template.icon,
            sections: [],
            keywords: extractKeywords(plainText),
            generatedAt: new Date().toISOString()
        };

        for (const section of template.sections) {
            const content = section.extract(plainText, lines);
            result.sections.push({
                key: section.key,
                label: section.label,
                content: content
            });
        }

        return result;
    }

    function toHTML(summary) {
        let html = `<h4>${summary.icon} ${summary.title}</h4>\n`;

        for (const sec of summary.sections) {
            html += `<h4>${sec.label}</h4>\n`;
            if (Array.isArray(sec.content) && sec.content.length > 0) {
                html += sec.content.map(item => `・${item}`).join('\n') + '\n';
            } else if (typeof sec.content === 'string' && sec.content) {
                html += sec.content + '\n';
            } else {
                html += '（検出なし）\n';
            }
            html += '\n';
        }

        if (summary.keywords.length > 0) {
            html += `<h4>キーワード</h4>\n`;
            html += summary.keywords.join('、') + '\n';
        }

        return html;
    }

    function toText(summary) {
        let text = `【${summary.icon} ${summary.title}】\n\n`;

        for (const sec of summary.sections) {
            text += `■ ${sec.label}\n`;
            if (Array.isArray(sec.content) && sec.content.length > 0) {
                text += sec.content.map(item => `  ・${item}`).join('\n') + '\n';
            } else if (typeof sec.content === 'string' && sec.content) {
                text += `  ${sec.content}\n`;
            } else {
                text += '  （検出なし）\n';
            }
            text += '\n';
        }

        return text;
    }

    // === 抽出関数群 ===

    function extractParties(text) {
        const patterns = [
            /([^\s、。]+)(?:さん|様|氏|先生|部長|課長|社長|担当)/g,
            /(?:から|より)(?:の)?([^\s、。]+)/g
        ];
        const found = new Set();
        for (const p of patterns) {
            let m;
            while ((m = p.exec(text)) !== null) {
                const name = m[1] || m[0];
                if (name.length >= 2 && name.length <= 10) found.add(name);
            }
        }
        return found.size > 0 ? [...found] : ['（通話相手の名前を確認してください）'];
    }

    function extractPurpose(text) {
        const sentences = splitSentences(text);
        const purposeWords = ['について', 'の件', '確認', '報告', '相談', '依頼', 'お願い', '連絡', 'ご案内'];
        const found = sentences.filter(s => purposeWords.some(w => s.includes(w)));
        return found.length > 0 ? found.slice(0, 3) : [summarizeFirst(text, 50)];
    }

    function extractDecisions(text) {
        const sentences = splitSentences(text);
        const decisionWords = ['決まり', '決定', 'にします', 'にしましょう', 'でいきます',
            'で進め', 'で行き', 'ことにし', 'で決', 'に決', '了承', '承認', '合意'];
        return sentences.filter(s => decisionWords.some(w => s.includes(w))).slice(0, 5);
    }

    function extractActions(text) {
        const sentences = splitSentences(text);
        const actionWords = ['してください', 'お願い', 'しておき', '確認し', '送っ', '連絡し',
            '準備', '手配', '対応', 'やっておく', '進めて', 'まとめ', '報告', '提出',
            'TODO', 'タスク', 'フォロー'];
        return sentences.filter(s => actionWords.some(w => s.includes(w))).slice(0, 5);
    }

    function extractTopics(text) {
        const sentences = splitSentences(text);
        const topicWords = ['について', 'に関して', 'の件', 'テーマ', '議題', '話題', 'の話'];
        const found = sentences.filter(s => topicWords.some(w => s.includes(w)));
        return found.length > 0 ? found.slice(0, 5) : [summarizeFirst(text, 60)];
    }

    function extractDates(text) {
        const patterns = [
            /\d{1,2}月\d{1,2}日[^。、]*/g,
            /(?:来週|今週|再来週|今月|来月)[^\s。、]{0,20}/g,
            /(?:月曜|火曜|水曜|木曜|金曜|土曜|日曜)[日]?[^\s。、]{0,15}/g,
            /\d{1,2}時[^\s。、]{0,10}/g,
            /(?:明日|明後日|今日)[^\s。、]{0,15}/g,
            /\d{1,2}\/\d{1,2}[^\s。、]{0,10}/g
        ];
        const found = new Set();
        for (const p of patterns) {
            let m;
            while ((m = p.exec(text)) !== null) {
                found.add(m[0].trim());
            }
        }
        return [...found].slice(0, 5);
    }

    function extractSymptoms(text) {
        const sentences = splitSentences(text);
        const symptomWords = ['痛い', '痛み', '痒い', '腫れ', '熱', '咳', '頭痛', '腹痛',
            '吐き気', 'だるい', '倦怠', '食欲', '眠れ', '息苦し', 'めまい', 'しびれ',
            '出血', '違和感', '不調', '症状', 'つらい', '気持ち悪', '下痢', '便秘'];
        return sentences.filter(s => symptomWords.some(w => s.includes(w))).slice(0, 5);
    }

    function extractDiagnosis(text) {
        const sentences = splitSentences(text);
        const diagWords = ['診断', '可能性', 'かもしれ', '疑い', '思われ', '考えられ',
            '症', '炎', '病', '障害', '感染', 'ウイルス', '細菌'];
        return sentences.filter(s => diagWords.some(w => s.includes(w))).slice(0, 3);
    }

    function extractMedication(text) {
        const sentences = splitSentences(text);
        const medWords = ['薬', '処方', '錠', 'mg', '飲んで', '塗って', '注射', '点滴',
            'カプセル', '服用', '用法', '1日', '朝', '食後', '食前', '就寝前', '頓服'];
        return sentences.filter(s => medWords.some(w => s.includes(w))).slice(0, 5);
    }

    function extractInstructions(text) {
        const sentences = splitSentences(text);
        const instrWords = ['してください', 'しないで', '控えて', '注意', '気をつけ',
            '安静', '運動', '食事', '制限', '禁止', 'ダメ', 'いけない', '避けて',
            '水分', '休養', '様子を見'];
        return sentences.filter(s => instrWords.some(w => s.includes(w))).slice(0, 5);
    }

    function extractKeyPoints(text) {
        const sentences = splitSentences(text);
        const importantWords = ['重要', '大事', 'ポイント', '必ず', '特に', '注意',
            '結論', 'まとめ', 'つまり', '要するに'];
        const found = sentences.filter(s => importantWords.some(w => s.includes(w)));
        return found.length > 0 ? found.slice(0, 5) : sentences.slice(0, 3);
    }

    function extractNotes(text) {
        const sentences = splitSentences(text);
        const noteWords = ['ちなみに', 'ところで', '余談', '補足', 'あと', 'そういえば'];
        return sentences.filter(s => noteWords.some(w => s.includes(w))).slice(0, 3);
    }

    function extractKeywords(text) {
        // 頻出する2-6文字の名詞的フレーズを抽出
        const words = {};
        const chunks = text.split(/[、。\s！？!?・]+/);
        for (const chunk of chunks) {
            const trimmed = chunk.trim();
            if (trimmed.length >= 2 && trimmed.length <= 8) {
                words[trimmed] = (words[trimmed] || 0) + 1;
            }
        }
        return Object.entries(words)
            .filter(([, count]) => count >= 2)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 8)
            .map(([word]) => word);
    }

    // ユーティリティ
    function splitSentences(text) {
        return text.split(/[。！？!?\n]+/)
            .map(s => s.trim())
            .filter(s => s.length > 3);
    }

    function summarizeFirst(text, maxLen) {
        const clean = text.replace(/\s+/g, ' ').trim();
        if (clean.length <= maxLen) return clean;
        return clean.substring(0, maxLen) + '...';
    }

    return { summarize, toHTML, toText, templates };
})();
