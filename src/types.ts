/**
 * DevSocial Backend - Type Definitions
 */

// Gelen aktivite verisi
export interface ActivityHeartbeat {
  timestamp: number;
  projectName: string;
  language: string;
  fileName: string;
  fileExtension: string;
  isWriting: boolean;
}

export interface ActivitySummary {
  userId: string;
  startTime: number;
  endTime: number;
  totalActiveSeconds: number;
  projects: ProjectActivity[];
  languages: LanguageActivity[];
}

export interface ProjectActivity {
  projectName: string;
  activeSeconds: number;
  languages: string[];
}

export interface LanguageActivity {
  language: string;
  activeSeconds: number;
  fileCount: number;
}

// Sync isteği
export interface SyncRequest {
  apiKey: string;
  deviceId: string;
  summary: ActivitySummary;
  heartbeats: ActivityHeartbeat[];
}

// Sync yanıtı
export interface SyncResponse {
  success: boolean;
  message: string;
  data?: {
    todayTotal: number;
    weekTotal: number;
    friendsActivity: FriendActivity[];
  };
}

// Arkadaş aktivitesi
export interface FriendActivity {
  id: string;
  username: string;
  avatarUrl?: string;
  currentProject?: string;
  currentLanguage?: string;
  activeSeconds: number;
  lastActive: number;
  status: "online" | "idle" | "offline";
}

// Kullanıcı
export interface User {
  id: string;
  username: string;
  password: string; // bcrypt hash
  apiKey: string;
  email?: string;
  avatarUrl?: string;
  avatarId: string;
  friends: string[];
  createdAt: number;
  settings: UserSettings;
}

export interface UserSettings {
  shareActivity: boolean;
  shareProjectName: boolean;
  shareLanguage: boolean;
  autoPost: boolean;
  postThreshold: number; // Kaç saat sonra otomatik post atsın
}

// Günlük aktivite kaydı
export interface DailyActivity {
  date: string; // YYYY-MM-DD
  userId: string;
  totalSeconds: number;
  projects: Map<string, number>;
  languages: Map<string, number>;
  lastUpdate: number;
}

// Arkadaşlık isteği
export interface FriendRequest {
  id: string;
  fromUserId: string;
  toUserId: string;
  status: "pending" | "accepted" | "rejected";
  createdAt: number;
  respondedAt?: number;
}

// Sosyal medya postu
export interface SocialPost {
  id: string;
  userId: string;
  content: string;
  platform: "twitter" | "linkedin" | "discord" | "custom";
  createdAt: number;
  posted: boolean;
  postedAt?: number;
}

// Saatlik aktivite kaydı
export interface HourlyActivity {
  date: string; // YYYY-MM-DD
  hour: number; // 0-23
  totalSeconds: number;
  projects?: Record<string, number>;
  languages?: Record<string, number>;
}

// Achievement tanımı
export interface Achievement {
  id: string;
  name: string;
  description: string;
  icon: string;
  category: "time" | "streak" | "language" | "social" | "special";
  thresholdType: string;
  thresholdValue: number;
}

// Kullanıcı achievement'ı
export interface UserAchievement {
  achievementId: string;
  name: string;
  description: string;
  icon: string;
  category: string;
  unlockedAt: number;
}

// Chat mesajı
export interface ChatMessage {
  id: string;
  fromUserId: string;
  toUserId: string;
  content: string;
  createdAt: number;
  readAt?: number;
  fromUsername?: string;
}

// Dil dağılımı istatistiği
export interface LanguageStats {
  name: string;
  totalSeconds: number;
  percentage: number;
}

// Predefined avatar tanımı
export interface AvatarDefinition {
  id: string;
  emoji: string;
  name: string;
  category: string;
}

// Predefined avatar listesi
export const PREDEFINED_AVATARS: AvatarDefinition[] = [
  // Hayvanlar
  { id: "fox", emoji: "🦊", name: "Fox", category: "animals" },
  { id: "cat", emoji: "🐱", name: "Cat", category: "animals" },
  { id: "dog", emoji: "🐶", name: "Dog", category: "animals" },
  { id: "panda", emoji: "🐼", name: "Panda", category: "animals" },
  { id: "unicorn", emoji: "🦄", name: "Unicorn", category: "animals" },
  { id: "dragon", emoji: "🐉", name: "Dragon", category: "animals" },
  { id: "owl", emoji: "🦉", name: "Owl", category: "animals" },
  // Karakterler
  { id: "ninja", emoji: "🥷", name: "Ninja", category: "characters" },
  { id: "astronaut", emoji: "🧑‍🚀", name: "Astronaut", category: "characters" },
  { id: "wizard", emoji: "🧙", name: "Wizard", category: "characters" },
  { id: "robot", emoji: "🤖", name: "Robot", category: "characters" },
  { id: "alien", emoji: "👽", name: "Alien", category: "characters" },
  { id: "ghost", emoji: "👻", name: "Ghost", category: "characters" },
  { id: "pirate", emoji: "🏴‍☠️", name: "Pirate", category: "characters" },
  // Objeler
  { id: "rocket", emoji: "🚀", name: "Rocket", category: "objects" },
  { id: "fire", emoji: "🔥", name: "Fire", category: "objects" },
  { id: "lightning", emoji: "⚡", name: "Lightning", category: "objects" },
  { id: "diamond", emoji: "💎", name: "Diamond", category: "objects" },
  { id: "crown", emoji: "👑", name: "Crown", category: "objects" },
  { id: "star", emoji: "⭐", name: "Star", category: "objects" },
  { id: "heart", emoji: "❤️", name: "Heart", category: "objects" },
  { id: "crystal", emoji: "🔮", name: "Crystal Ball", category: "objects" },
  // Varsayılan
  { id: "default", emoji: "👤", name: "Default", category: "default" },
];
