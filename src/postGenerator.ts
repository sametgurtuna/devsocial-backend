import { DailyActivity } from './types';

/**
 * Sosyal Medya Post Oluşturucu
 * Aktivite verilerini insanların okuyabileceği postlara dönüştürür
 */

// Dil isimlerini Türkçeleştir
const languageNames: Record<string, string> = {
    'typescript': 'TypeScript',
    'javascript': 'JavaScript',
    'python': 'Python',
    'java': 'Java',
    'csharp': 'C#',
    'cpp': 'C++',
    'c': 'C',
    'go': 'Go',
    'rust': 'Rust',
    'ruby': 'Ruby',
    'php': 'PHP',
    'swift': 'Swift',
    'kotlin': 'Kotlin',
    'dart': 'Dart',
    'html': 'HTML',
    'css': 'CSS',
    'scss': 'SCSS',
    'json': 'JSON',
    'yaml': 'YAML',
    'markdown': 'Markdown',
    'sql': 'SQL',
    'shellscript': 'Shell Script',
    'powershell': 'PowerShell',
    'dockerfile': 'Docker',
    'vue': 'Vue.js',
    'svelte': 'Svelte',
    'plaintext': 'Metin'
};

// Süreyi insanların okuyabileceği formata çevir
function formatDuration(seconds: number): string {
    if (seconds < 60) {
        return `${seconds} saniye`;
    }
    
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    
    if (hours === 0) {
        return `${minutes} dakika`;
    }
    
    if (minutes === 0) {
        return `${hours} saat`;
    }
    
    return `${hours} saat ${minutes} dakika`;
}

// Dil adını formatla
function getLanguageName(langId: string): string {
    return languageNames[langId.toLowerCase()] || langId;
}

// Emoji seç
function getActivityEmoji(hours: number): string {
    if (hours >= 8) return '🔥';
    if (hours >= 4) return '💪';
    if (hours >= 2) return '⚡';
    if (hours >= 1) return '✨';
    return '💻';
}

function getLanguageEmoji(language: string): string {
    const emojis: Record<string, string> = {
        'typescript': '🔷',
        'javascript': '🟨',
        'python': '🐍',
        'java': '☕',
        'csharp': '🟣',
        'cpp': '🔵',
        'go': '🐹',
        'rust': '🦀',
        'ruby': '💎',
        'php': '🐘',
        'swift': '🍎',
        'kotlin': '🟠',
        'dart': '🎯',
        'html': '🌐',
        'css': '🎨',
        'vue': '💚',
        'react': '⚛️'
    };
    return emojis[language.toLowerCase()] || '📝';
}

/**
 * Ana post oluşturma fonksiyonu
 * Ham veriyi sosyal medya postuna dönüştürür
 */
export function generateSocialPost(
    username: string,
    activity: DailyActivity,
    options?: {
        includeProject?: boolean;
        includeLanguages?: boolean;
        platform?: 'twitter' | 'linkedin' | 'discord';
    }
): string {
    const { includeProject = true, includeLanguages = true, platform = 'twitter' } = options || {};
    
    const hours = activity.totalSeconds / 3600;
    const emoji = getActivityEmoji(hours);
    const duration = formatDuration(activity.totalSeconds);

    // En çok çalışılan projeyi bul
    let mainProject = '';
    let maxProjectSeconds = 0;
    activity.projects.forEach((seconds, project) => {
        if (seconds > maxProjectSeconds) {
            maxProjectSeconds = seconds;
            mainProject = project;
        }
    });

    // En çok kullanılan dilleri bul
    const languages: { name: string; seconds: number }[] = [];
    activity.languages.forEach((seconds, lang) => {
        languages.push({ name: lang, seconds });
    });
    languages.sort((a, b) => b.seconds - a.seconds);

    // Post şablonları
    const templates = {
        // Proje ve dil bilgisi ile
        full: [
            `${emoji} ${username} bugün ${mainProject} üzerinde ${duration} kod yazdı! ${getLanguageEmoji(languages[0]?.name || '')}`,
            `${emoji} Bugünkü kodlama maratonu: ${duration} ${mainProject} projesinde! #DevSocial`,
            `${emoji} ${username} ${duration}dır ${mainProject} projesinde çalışıyor! Harika iş! 🚀`,
            `🎯 ${username} bugün ${mainProject} üzerinde ${duration} geçirdi. ${languages.slice(0, 2).map(l => getLanguageName(l.name)).join(' ve ')} ile!`,
        ],
        
        // Sadece süre
        simple: [
            `${emoji} ${username} bugün ${duration} kod yazdı! #coding #DevSocial`,
            `${emoji} Günlük kodlama: ${duration}! Hedeflere doğru ilerliyoruz 🚀`,
            `💻 ${username} bugün ${duration} kodlama yaptı! #developer`,
        ],
        
        // Dil odaklı
        languageFocused: [
            `${getLanguageEmoji(languages[0]?.name || '')} ${username} bugün ${getLanguageName(languages[0]?.name || '')} ile ${duration} geçirdi!`,
            `${emoji} ${duration} ${languages.slice(0, 2).map(l => getLanguageName(l.name)).join(' + ')} kodlaması! #DevSocial`,
        ],

        // Motivasyon
        motivational: [
            `${emoji} Her satır kod bir adım ileri! ${username} bugün ${duration} ilerledi. Sen de katıl! 🚀`,
            `💪 Tutarlılık anahtardır. ${username} bugün de ${duration} kod yazdı! #NeverStopLearning`,
            `🌟 Harika iş ${username}! ${duration} üretken çalışma. Böyle devam! 💻`,
        ]
    };

    // Platform bazlı uzunluk kontrolü
    const maxLength = platform === 'twitter' ? 280 : platform === 'discord' ? 2000 : 3000;

    // Şablon seç
    let templateCategory: keyof typeof templates;
    
    if (includeProject && mainProject && includeLanguages && languages.length > 0) {
        templateCategory = 'full';
    } else if (includeLanguages && languages.length > 0) {
        templateCategory = 'languageFocused';
    } else {
        templateCategory = Math.random() > 0.5 ? 'simple' : 'motivational';
    }

    const selectedTemplates = templates[templateCategory];
    let post = selectedTemplates[Math.floor(Math.random() * selectedTemplates.length)];

    // Dil listesi ekle (LinkedIn için)
    if (platform === 'linkedin' && includeLanguages && languages.length > 1) {
        const langList = languages.slice(0, 5).map(l => 
            `• ${getLanguageName(l.name)}: ${formatDuration(l.seconds)}`
        ).join('\n');
        
        post += `\n\n📊 Bugünkü dil dağılımı:\n${langList}`;
    }

    // Hashtag ekle
    if (platform === 'twitter' && post.length < 250) {
        const hashtags = ['#coding', '#developer', '#DevSocial'];
        if (languages[0]) {
            hashtags.unshift(`#${getLanguageName(languages[0].name).replace(/[^a-zA-Z]/g, '')}`);
        }
        
        const hashtagStr = hashtags.slice(0, 3).join(' ');
        if (post.length + hashtagStr.length + 1 <= 280) {
            post += '\n' + hashtagStr;
        }
    }

    return post.substring(0, maxLength);
}

/**
 * Haftalık özet postu oluştur
 */
export function generateWeeklySummary(
    username: string,
    weeklySeconds: number,
    topProjects: { name: string; seconds: number }[],
    topLanguages: { name: string; seconds: number }[]
): string {
    const hours = Math.floor(weeklySeconds / 3600);
    const emoji = getActivityEmoji(hours);

    let post = `📅 Haftalık Özet | ${username}\n\n`;
    post += `${emoji} Toplam: ${formatDuration(weeklySeconds)}\n\n`;

    if (topProjects.length > 0) {
        post += `🎯 En Aktif Projeler:\n`;
        topProjects.slice(0, 3).forEach((p, i) => {
            post += `${i + 1}. ${p.name} (${formatDuration(p.seconds)})\n`;
        });
        post += '\n';
    }

    if (topLanguages.length > 0) {
        post += `💻 Kullanılan Diller:\n`;
        topLanguages.slice(0, 5).forEach(l => {
            post += `${getLanguageEmoji(l.name)} ${getLanguageName(l.name)}: ${formatDuration(l.seconds)}\n`;
        });
    }

    post += '\n#DevSocial #WeeklyCoding #Developer';

    return post;
}

/**
 * Özel milestone postları
 */
export function generateMilestonePost(
    username: string,
    milestone: 'first_hour' | 'streak_7' | 'streak_30' | 'total_100h' | 'total_1000h'
): string {
    const milestones: Record<string, string> = {
        'first_hour': `🎉 ${username} DevSocial'de ilk 1 saatlik kodlama seansını tamamladı! Başlangıç her zaman en zor adımdır. 💪 #FirstStep`,
        'streak_7': `🔥 7 günlük seri! ${username} tam 1 haftadır her gün kod yazıyor. Tutarlılık başarının anahtarı! 🚀 #CodingStreak`,
        'streak_30': `🏆 İNANILMAZ! ${username} 30 günlük kodlama serisi yakaladı! Bu bir şampiyon performansı! 🌟 #30DayStreak`,
        'total_100h': `💯 ${username} toplamda 100 saat kodlama süresine ulaştı! Bu ciddi bir bağlılık göstergesi. 🎯 #100HoursOfCode`,
        'total_1000h': `🏅 EFSANE! ${username} 1000 saat kodlama süresini aştı! Gerçek bir kod ustası! 👑 #1000HoursOfCode`
    };

    return milestones[milestone] || '';
}
