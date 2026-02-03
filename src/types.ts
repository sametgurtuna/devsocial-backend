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
