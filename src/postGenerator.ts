import { DailyActivity } from './types';

/**
 * Social Media Post Generator
 * Converts activity data to human-readable posts
 */

// Language display names
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
    'plaintext': 'Text'
};

// Format duration to human-readable string
function formatDuration(seconds: number): string {
    if (seconds < 60) {
        return `${seconds} seconds`;
    }
    
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    
    if (hours === 0) {
        return `${minutes} minutes`;
    }
    
    if (minutes === 0) {
        return `${hours} hours`;
    }
    
    return `${hours}h ${minutes}m`;
}

// Get language display name
function getLanguageName(langId: string): string {
    return languageNames[langId.toLowerCase()] || langId;
}

// Get activity emoji based on hours
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
 * Main post generation function
 * Converts raw data to social media posts
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

    // Find most worked project
    let mainProject = '';
    let maxProjectSeconds = 0;
    activity.projects.forEach((seconds, project) => {
        if (seconds > maxProjectSeconds) {
            maxProjectSeconds = seconds;
            mainProject = project;
        }
    });

    // Find most used languages
    const languages: { name: string; seconds: number }[] = [];
    activity.languages.forEach((seconds, lang) => {
        languages.push({ name: lang, seconds });
    });
    languages.sort((a, b) => b.seconds - a.seconds);

    // Post templates
    const templates = {
        // With project and language info
        full: [
            `${emoji} ${username} coded for ${duration} on ${mainProject} today! ${getLanguageEmoji(languages[0]?.name || '')}`,
            `${emoji} Today's coding marathon: ${duration} on ${mainProject}! #DevSocial`,
            `${emoji} ${username} has been working on ${mainProject} for ${duration}! Great job! 🚀`,
            `🎯 ${username} spent ${duration} on ${mainProject} today. Using ${languages.slice(0, 2).map(l => getLanguageName(l.name)).join(' and ')}!`,
        ],
        
        // Duration only
        simple: [
            `${emoji} ${username} coded for ${duration} today! #coding #DevSocial`,
            `${emoji} Daily coding: ${duration}! Making progress 🚀`,
            `💻 ${username} coded for ${duration} today! #developer`,
        ],
        
        // Language focused
        languageFocused: [
            `${getLanguageEmoji(languages[0]?.name || '')} ${username} spent ${duration} with ${getLanguageName(languages[0]?.name || '')} today!`,
            `${emoji} ${duration} of ${languages.slice(0, 2).map(l => getLanguageName(l.name)).join(' + ')} coding! #DevSocial`,
        ],

        // Motivational
        motivational: [
            `${emoji} Every line of code is a step forward! ${username} made ${duration} of progress today. Join in! 🚀`,
            `💪 Consistency is key. ${username} coded for ${duration} today! #NeverStopLearning`,
            `🌟 Great job ${username}! ${duration} of productive work. Keep it up! 💻`,
        ]
    };

    // Platform-based length limit
    const maxLength = platform === 'twitter' ? 280 : platform === 'discord' ? 2000 : 3000;

    // Select template
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

    // Add language breakdown (for LinkedIn)
    if (platform === 'linkedin' && includeLanguages && languages.length > 1) {
        const langList = languages.slice(0, 5).map(l => 
            `• ${getLanguageName(l.name)}: ${formatDuration(l.seconds)}`
        ).join('\n');
        
        post += `\n\n📊 Today's language breakdown:\n${langList}`;
    }

    // Add hashtags
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
 * Generate weekly summary post
 */
export function generateWeeklySummary(
    username: string,
    weeklySeconds: number,
    topProjects: { name: string; seconds: number }[],
    topLanguages: { name: string; seconds: number }[]
): string {
    const hours = Math.floor(weeklySeconds / 3600);
    const emoji = getActivityEmoji(hours);

    let post = `📅 Weekly Summary | ${username}\n\n`;
    post += `${emoji} Total: ${formatDuration(weeklySeconds)}\n\n`;

    if (topProjects.length > 0) {
        post += `🎯 Most Active Projects:\n`;
        topProjects.slice(0, 3).forEach((p, i) => {
            post += `${i + 1}. ${p.name} (${formatDuration(p.seconds)})\n`;
        });
        post += '\n';
    }

    if (topLanguages.length > 0) {
        post += `💻 Languages Used:\n`;
        topLanguages.slice(0, 5).forEach(l => {
            post += `${getLanguageEmoji(l.name)} ${getLanguageName(l.name)}: ${formatDuration(l.seconds)}\n`;
        });
    }

    post += '\n#DevSocial #WeeklyCoding #Developer';

    return post;
}

/**
 * Special milestone posts
 */
export function generateMilestonePost(
    username: string,
    milestone: 'first_hour' | 'streak_7' | 'streak_30' | 'total_100h' | 'total_1000h'
): string {
    const milestones: Record<string, string> = {
        'first_hour': `🎉 ${username} completed their first 1-hour coding session on DevSocial! The first step is always the hardest. 💪 #FirstStep`,
        'streak_7': `🔥 7-day streak! ${username} has been coding every day for a full week. Consistency is the key to success! 🚀 #CodingStreak`,
        'streak_30': `🏆 INCREDIBLE! ${username} achieved a 30-day coding streak! This is champion-level performance! 🌟 #30DayStreak`,
        'total_100h': `💯 ${username} reached 100 total hours of coding! This shows serious dedication. 🎯 #100HoursOfCode`,
        'total_1000h': `🏅 LEGENDARY! ${username} surpassed 1000 hours of coding! A true code master! 👑 #1000HoursOfCode`
    };

    return milestones[milestone] || '';
}
