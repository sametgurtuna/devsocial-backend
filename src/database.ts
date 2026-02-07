import { User, DailyActivity, FriendActivity, FriendRequest } from "./types";
import { v4 as uuidv4 } from "uuid";
import bcrypt from "bcrypt";

/**
 * In-Memory Database
 * Geliştirme aşaması için basit bir bellek içi veritabanı
 * Gerçek uygulamada MongoDB, PostgreSQL vb. kullanılabilir
 */
class Database {
  private users: Map<string, User> = new Map();
  private usersByApiKey: Map<string, User> = new Map();
  private usersByUsername: Map<string, User> = new Map();
  private dailyActivities: Map<string, DailyActivity> = new Map();
  private friendRequests: Map<string, FriendRequest> = new Map();

  constructor() {
    // Başlangıç kullanıcısı oluştur (test için)
    this.createInitialUser();
  }

  private async createInitialUser(): Promise<void> {
    const hashedPassword = await bcrypt.hash("123456", 10);

    const mainUser: User = {
      id: "user-1",
      username: "samet",
      password: hashedPassword,
      apiKey: "dev-api-key-12345",
      email: "samet@example.com",
      avatarId: "default",
      friends: [],
      createdAt: Date.now(),
      settings: {
        shareActivity: true,
        shareProjectName: true,
        shareLanguage: true,
        autoPost: false,
        postThreshold: 2,
      },
    };

    this.users.set(mainUser.id, mainUser);
    this.usersByApiKey.set(mainUser.apiKey, mainUser);
    this.usersByUsername.set(mainUser.username.toLowerCase(), mainUser);

    console.log("[DB] Initial user created: samet (password: 123456)");
  }

  // ==================== KULLANICI İŞLEMLERİ ====================

  getUserByApiKey(apiKey: string): User | undefined {
    return this.usersByApiKey.get(apiKey);
  }

  getUserById(id: string): User | undefined {
    return this.users.get(id);
  }

  getUserByUsername(username: string): User | undefined {
    return this.usersByUsername.get(username.toLowerCase());
  }

  async createUser(
    username: string,
    password: string,
    email?: string,
  ): Promise<User> {
    // Username benzersiz olmalı
    if (this.usersByUsername.has(username.toLowerCase())) {
      throw new Error("Bu kullanıcı adı zaten kullanılıyor");
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const user: User = {
      id: uuidv4(),
      username,
      password: hashedPassword,
      apiKey: uuidv4(),
      email,
      avatarId: "default",
      friends: [],
      createdAt: Date.now(),
      settings: {
        shareActivity: true,
        shareProjectName: true,
        shareLanguage: true,
        autoPost: false,
        postThreshold: 2,
      },
    };

    this.users.set(user.id, user);
    this.usersByApiKey.set(user.apiKey, user);
    this.usersByUsername.set(username.toLowerCase(), user);

    console.log(`[DB] New user created: ${username}`);
    return user;
  }

  async verifyPassword(
    username: string,
    password: string,
  ): Promise<User | null> {
    const user = this.usersByUsername.get(username.toLowerCase());
    if (!user) return null;

    const isValid = await bcrypt.compare(password, user.password);
    return isValid ? user : null;
  }

  searchUsers(query: string, excludeUserId: string): User[] {
    const results: User[] = [];
    const lowerQuery = query.toLowerCase();

    this.users.forEach((user) => {
      if (
        user.id !== excludeUserId &&
        user.username.toLowerCase().includes(lowerQuery)
      ) {
        results.push(user);
      }
    });

    return results.slice(0, 20); // Max 20 sonuç
  }

  getAllUsers(): User[] {
    return Array.from(this.users.values());
  }

  // ==================== ARKADAŞLIK İSTEKLERİ ====================

  sendFriendRequest(fromUserId: string, toUserId: string): FriendRequest {
    const fromUser = this.users.get(fromUserId);
    const toUser = this.users.get(toUserId);

    if (!fromUser || !toUser) {
      throw new Error("Kullanıcı bulunamadı");
    }

    // Zaten arkadaş mı kontrol et
    if (fromUser.friends.includes(toUserId)) {
      throw new Error("Bu kullanıcı zaten arkadaşınız");
    }

    // Bekleyen istek var mı kontrol et
    const existingRequest = this.getPendingRequest(fromUserId, toUserId);
    if (existingRequest) {
      throw new Error("Zaten bekleyen bir arkadaşlık isteği var");
    }

    const request: FriendRequest = {
      id: uuidv4(),
      fromUserId,
      toUserId,
      status: "pending",
      createdAt: Date.now(),
    };

    this.friendRequests.set(request.id, request);
    console.log(
      `[DB] Friend request sent: ${fromUser.username} -> ${toUser.username}`,
    );

    return request;
  }

  getPendingRequest(
    fromUserId: string,
    toUserId: string,
  ): FriendRequest | undefined {
    for (const request of this.friendRequests.values()) {
      if (
        request.status === "pending" &&
        ((request.fromUserId === fromUserId && request.toUserId === toUserId) ||
          (request.fromUserId === toUserId && request.toUserId === fromUserId))
      ) {
        return request;
      }
    }
    return undefined;
  }

  getIncomingFriendRequests(userId: string): FriendRequest[] {
    const requests: FriendRequest[] = [];

    this.friendRequests.forEach((request) => {
      if (request.toUserId === userId && request.status === "pending") {
        requests.push(request);
      }
    });

    return requests.sort((a, b) => b.createdAt - a.createdAt);
  }

  getOutgoingFriendRequests(userId: string): FriendRequest[] {
    const requests: FriendRequest[] = [];

    this.friendRequests.forEach((request) => {
      if (request.fromUserId === userId && request.status === "pending") {
        requests.push(request);
      }
    });

    return requests.sort((a, b) => b.createdAt - a.createdAt);
  }

  acceptFriendRequest(requestId: string, userId: string): void {
    const request = this.friendRequests.get(requestId);

    if (!request) {
      throw new Error("Arkadaşlık isteği bulunamadı");
    }

    if (request.toUserId !== userId) {
      throw new Error("Bu isteği kabul etme yetkiniz yok");
    }

    if (request.status !== "pending") {
      throw new Error("Bu istek zaten yanıtlanmış");
    }

    const fromUser = this.users.get(request.fromUserId);
    const toUser = this.users.get(request.toUserId);

    if (!fromUser || !toUser) {
      throw new Error("Kullanıcı bulunamadı");
    }

    // İki taraflı arkadaşlık ekle
    if (!fromUser.friends.includes(toUser.id)) {
      fromUser.friends.push(toUser.id);
    }
    if (!toUser.friends.includes(fromUser.id)) {
      toUser.friends.push(fromUser.id);
    }

    request.status = "accepted";
    request.respondedAt = Date.now();

    console.log(
      `[DB] Friend request accepted: ${fromUser.username} <-> ${toUser.username}`,
    );
  }

  rejectFriendRequest(requestId: string, userId: string): void {
    const request = this.friendRequests.get(requestId);

    if (!request) {
      throw new Error("Arkadaşlık isteği bulunamadı");
    }

    if (request.toUserId !== userId) {
      throw new Error("Bu isteği reddetme yetkiniz yok");
    }

    if (request.status !== "pending") {
      throw new Error("Bu istek zaten yanıtlanmış");
    }

    request.status = "rejected";
    request.respondedAt = Date.now();

    console.log(`[DB] Friend request rejected`);
  }

  removeFriend(userId: string, friendId: string): void {
    const user = this.users.get(userId);
    const friend = this.users.get(friendId);

    if (!user || !friend) {
      throw new Error("Kullanıcı bulunamadı");
    }

    // İki taraftan da çıkar
    user.friends = user.friends.filter((id) => id !== friendId);
    friend.friends = friend.friends.filter((id) => id !== userId);

    console.log(
      `[DB] Friendship removed: ${user.username} <-> ${friend.username}`,
    );
  }

  // ==================== AKTİVİTE İŞLEMLERİ ====================

  private getDateKey(timestamp: number): string {
    const date = new Date(timestamp);
    return date.toISOString().split("T")[0];
  }

  updateActivity(
    userId: string,
    seconds: number,
    projects: Map<string, number>,
    languages: Map<string, number>,
  ): void {
    const today = this.getDateKey(Date.now());
    const key = `${userId}-${today}`;

    let activity = this.dailyActivities.get(key);

    if (!activity) {
      activity = {
        date: today,
        userId,
        totalSeconds: 0,
        projects: new Map(),
        languages: new Map(),
        lastUpdate: Date.now(),
      };
    }

    activity.totalSeconds += seconds;
    activity.lastUpdate = Date.now();

    // Proje sürelerini ekle
    projects.forEach((secs, proj) => {
      const current = activity!.projects.get(proj) || 0;
      activity!.projects.set(proj, current + secs);
    });

    // Dil sürelerini ekle
    languages.forEach((secs, lang) => {
      const current = activity!.languages.get(lang) || 0;
      activity!.languages.set(lang, current + secs);
    });

    this.dailyActivities.set(key, activity);
  }

  getTodayActivity(userId: string): DailyActivity | undefined {
    const today = this.getDateKey(Date.now());
    return this.dailyActivities.get(`${userId}-${today}`);
  }

  getWeekActivity(userId: string): number {
    let total = 0;
    const now = Date.now();

    for (let i = 0; i < 7; i++) {
      const date = this.getDateKey(now - i * 24 * 60 * 60 * 1000);
      const activity = this.dailyActivities.get(`${userId}-${date}`);
      if (activity) {
        total += activity.totalSeconds;
      }
    }

    return total;
  }

  // ==================== ARKADAŞ AKTİVİTELERİ ====================

  getFriendsActivity(userId: string): FriendActivity[] {
    const user = this.users.get(userId);
    if (!user) return [];

    // Arkadaş yoksa boş dön
    if (user.friends.length === 0) {
      return [];
    }

    const now = Date.now();
    const idleThreshold = 10 * 60 * 1000; // 10 dakika
    const offlineThreshold = 60 * 60 * 1000; // 1 saat

    return user.friends
      .map((friendId) => {
        const friend = this.users.get(friendId);
        if (!friend) return null;

        // Arkadaş aktivite paylaşmak istemiyor mu kontrol et
        if (!friend.settings.shareActivity) {
          return {
            username: friend.username,
            avatarUrl: friend.avatarUrl,
            activeSeconds: 0,
            lastActive: 0,
            status: "offline" as const,
          };
        }

        const todayActivity = this.getTodayActivity(friendId);
        const timeSinceActive = now - (todayActivity?.lastUpdate || 0);

        let status: "online" | "idle" | "offline" = "offline";
        if (todayActivity && timeSinceActive < idleThreshold) {
          status = "online";
        } else if (todayActivity && timeSinceActive < offlineThreshold) {
          status = "idle";
        }

        // En aktif projeyi bul (sadece paylaşım açıksa)
        let currentProject: string | undefined;
        let currentLanguage: string | undefined;

        if (
          friend.settings.shareProjectName &&
          todayActivity &&
          todayActivity.projects.size > 0
        ) {
          let maxSeconds = 0;
          todayActivity.projects.forEach((secs, proj) => {
            if (secs > maxSeconds) {
              maxSeconds = secs;
              currentProject = proj;
            }
          });
        }

        if (
          friend.settings.shareLanguage &&
          todayActivity &&
          todayActivity.languages.size > 0
        ) {
          let maxSeconds = 0;
          todayActivity.languages.forEach((secs, lang) => {
            if (secs > maxSeconds) {
              maxSeconds = secs;
              currentLanguage = lang;
            }
          });
        }

        return {
          username: friend.username,
          avatarUrl: friend.avatarUrl,
          currentProject: status !== "offline" ? currentProject : undefined,
          currentLanguage: status !== "offline" ? currentLanguage : undefined,
          activeSeconds: todayActivity?.totalSeconds || 0,
          lastActive: todayActivity?.lastUpdate || 0,
          status,
        };
      })
      .filter((f) => f !== null) as FriendActivity[];
  }

  getFriendsList(
    userId: string,
  ): { id: string; username: string; avatarUrl?: string }[] {
    const user = this.users.get(userId);
    if (!user) return [];

    return user.friends
      .map((friendId) => {
        const friend = this.users.get(friendId);
        if (!friend) return null;
        return {
          id: friend.id,
          username: friend.username,
          avatarUrl: friend.avatarUrl,
        };
      })
      .filter((f) => f !== null) as {
      id: string;
      username: string;
      avatarUrl?: string;
    }[];
  }
}

// Singleton instance
export const db = new Database();
