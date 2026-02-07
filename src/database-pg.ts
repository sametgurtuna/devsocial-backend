import { Pool } from "pg";
import {
  User,
  DailyActivity,
  FriendActivity,
  FriendRequest,
  HourlyActivity,
  Achievement,
  UserAchievement,
  ChatMessage,
  LanguageStats,
  PREDEFINED_AVATARS,
} from "./types";
import { v4 as uuidv4 } from "uuid";
import bcrypt from "bcrypt";

/**
 * PostgreSQL Database
 * Neon PostgreSQL ile kalıcı veri depolama
 */
class PostgresDatabase {
  private pool: Pool;
  private initialized = false;

  constructor() {
    const connectionString = process.env.DATABASE_URL;

    if (!connectionString) {
      throw new Error("DATABASE_URL environment variable is required");
    }

    this.pool = new Pool({
      connectionString,
      ssl: { rejectUnauthorized: false },
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    });

    this.pool.on("error", (err) => {
      console.error("[DB] Unexpected error on idle client", err);
    });
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      await this.createTables();
      await this.seedAchievements();
      this.initialized = true;
      console.log("[DB] PostgreSQL database initialized");
    } catch (error) {
      console.error("[DB] Failed to initialize database:", error);
      throw error;
    }
  }

  private async createTables(): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS users (
          id VARCHAR(36) PRIMARY KEY,
          username VARCHAR(50) UNIQUE NOT NULL,
          password VARCHAR(255) NOT NULL,
          api_key VARCHAR(36) UNIQUE NOT NULL,
          email VARCHAR(255),
          avatar_url VARCHAR(500),
          avatar_id VARCHAR(30) DEFAULT 'default',
          created_at BIGINT NOT NULL,
          settings JSONB DEFAULT '{"shareActivity":true,"shareProjectName":true,"shareLanguage":true,"autoPost":false,"postThreshold":2}'
        );

        CREATE TABLE IF NOT EXISTS friendships (
          user_id VARCHAR(36) REFERENCES users(id) ON DELETE CASCADE,
          friend_id VARCHAR(36) REFERENCES users(id) ON DELETE CASCADE,
          created_at BIGINT NOT NULL,
          PRIMARY KEY (user_id, friend_id)
        );

        CREATE TABLE IF NOT EXISTS friend_requests (
          id VARCHAR(36) PRIMARY KEY,
          from_user_id VARCHAR(36) REFERENCES users(id) ON DELETE CASCADE,
          to_user_id VARCHAR(36) REFERENCES users(id) ON DELETE CASCADE,
          status VARCHAR(20) DEFAULT 'pending',
          created_at BIGINT NOT NULL,
          responded_at BIGINT
        );

        CREATE TABLE IF NOT EXISTS daily_activities (
          id VARCHAR(72) PRIMARY KEY,
          user_id VARCHAR(36) REFERENCES users(id) ON DELETE CASCADE,
          date VARCHAR(10) NOT NULL,
          total_seconds INT DEFAULT 0,
          projects JSONB DEFAULT '{}',
          languages JSONB DEFAULT '{}',
          last_update BIGINT NOT NULL,
          UNIQUE(user_id, date)
        );

        CREATE TABLE IF NOT EXISTS hourly_activities (
          id VARCHAR(80) PRIMARY KEY,
          user_id VARCHAR(36) REFERENCES users(id) ON DELETE CASCADE,
          date VARCHAR(10) NOT NULL,
          hour INT NOT NULL,
          total_seconds INT DEFAULT 0,
          projects JSONB DEFAULT '{}',
          languages JSONB DEFAULT '{}',
          UNIQUE(user_id, date, hour)
        );

        CREATE TABLE IF NOT EXISTS achievements (
          id VARCHAR(36) PRIMARY KEY,
          name VARCHAR(100) NOT NULL,
          description VARCHAR(255) NOT NULL,
          icon VARCHAR(10) NOT NULL,
          category VARCHAR(30) NOT NULL,
          threshold_type VARCHAR(30) NOT NULL,
          threshold_value INT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS user_achievements (
          user_id VARCHAR(36) REFERENCES users(id) ON DELETE CASCADE,
          achievement_id VARCHAR(36) REFERENCES achievements(id) ON DELETE CASCADE,
          unlocked_at BIGINT NOT NULL,
          PRIMARY KEY (user_id, achievement_id)
        );

        CREATE TABLE IF NOT EXISTS messages (
          id VARCHAR(36) PRIMARY KEY,
          from_user_id VARCHAR(36) REFERENCES users(id) ON DELETE CASCADE,
          to_user_id VARCHAR(36) REFERENCES users(id) ON DELETE CASCADE,
          content TEXT NOT NULL,
          created_at BIGINT NOT NULL,
          read_at BIGINT
        );

        CREATE INDEX IF NOT EXISTS idx_users_api_key ON users(api_key);
        CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
        CREATE INDEX IF NOT EXISTS idx_daily_activities_user_date ON daily_activities(user_id, date);
        CREATE INDEX IF NOT EXISTS idx_friend_requests_to_user ON friend_requests(to_user_id, status);
        CREATE INDEX IF NOT EXISTS idx_hourly_user_date ON hourly_activities(user_id, date);
        CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(from_user_id, to_user_id, created_at);
        CREATE INDEX IF NOT EXISTS idx_messages_unread ON messages(to_user_id, read_at);
      `);

      // Add avatar_id column if not exists (for existing databases)
      await client.query(`
        ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_id VARCHAR(30) DEFAULT 'default';
      `);

      console.log("[DB] Tables created successfully");
    } finally {
      client.release();
    }
  }

  // ==================== USER OPERATIONS ====================

  async getUserByApiKey(apiKey: string): Promise<User | null> {
    const result = await this.pool.query(
      "SELECT * FROM users WHERE api_key = $1",
      [apiKey],
    );
    if (result.rows.length === 0) return null;
    return this.rowToUser(result.rows[0]);
  }

  async getUserById(id: string): Promise<User | null> {
    const result = await this.pool.query("SELECT * FROM users WHERE id = $1", [
      id,
    ]);
    if (result.rows.length === 0) return null;
    return this.rowToUser(result.rows[0]);
  }

  async getUserByUsername(username: string): Promise<User | null> {
    const result = await this.pool.query(
      "SELECT * FROM users WHERE LOWER(username) = LOWER($1)",
      [username],
    );
    if (result.rows.length === 0) return null;
    return this.rowToUser(result.rows[0]);
  }

  private async rowToUser(row: any): Promise<User> {
    // Get friends list
    const friendsResult = await this.pool.query(
      "SELECT friend_id FROM friendships WHERE user_id = $1",
      [row.id],
    );
    const friends = friendsResult.rows.map((r: any) => r.friend_id);

    return {
      id: row.id,
      username: row.username,
      password: row.password,
      apiKey: row.api_key,
      email: row.email,
      avatarUrl: row.avatar_url,
      avatarId: row.avatar_id || "default",
      friends,
      createdAt: parseInt(row.created_at),
      settings: row.settings || {
        shareActivity: true,
        shareProjectName: true,
        shareLanguage: true,
        autoPost: false,
        postThreshold: 2,
      },
    };
  }

  async createUser(
    username: string,
    password: string,
    email?: string,
  ): Promise<User> {
    const existingUser = await this.getUserByUsername(username);
    if (existingUser) {
      throw new Error("Username already taken");
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const id = uuidv4();
    const apiKey = uuidv4();
    const createdAt = Date.now();

    await this.pool.query(
      `INSERT INTO users (id, username, password, api_key, email, created_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [id, username, hashedPassword, apiKey, email || null, createdAt],
    );

    console.log(`[DB] New user created: ${username}`);

    return {
      id,
      username,
      password: hashedPassword,
      apiKey,
      email,
      avatarId: "default",
      friends: [],
      createdAt,
      settings: {
        shareActivity: true,
        shareProjectName: true,
        shareLanguage: true,
        autoPost: false,
        postThreshold: 2,
      },
    };
  }

  async verifyPassword(user: User, password: string): Promise<boolean> {
    return bcrypt.compare(password, user.password);
  }

  async updateUserSettings(
    userId: string,
    settings: Partial<User["settings"]>,
  ): Promise<void> {
    const user = await this.getUserById(userId);
    if (!user) throw new Error("User not found");

    const newSettings = { ...user.settings, ...settings };
    await this.pool.query("UPDATE users SET settings = $1 WHERE id = $2", [
      JSON.stringify(newSettings),
      userId,
    ]);
  }

  async searchUsers(query: string, excludeUserId: string): Promise<User[]> {
    const result = await this.pool.query(
      `SELECT * FROM users 
       WHERE LOWER(username) LIKE LOWER($1) AND id != $2 
       LIMIT 10`,
      [`%${query}%`, excludeUserId],
    );

    const users: User[] = [];
    for (const row of result.rows) {
      users.push(await this.rowToUser(row));
    }
    return users;
  }

  // ==================== FRIEND REQUESTS ====================

  async sendFriendRequest(
    fromUserId: string,
    toUsername: string,
  ): Promise<FriendRequest> {
    const toUser = await this.getUserByUsername(toUsername);
    if (!toUser) {
      throw new Error("User not found");
    }

    if (fromUserId === toUser.id) {
      throw new Error("Cannot send friend request to yourself");
    }

    // Check if already friends
    const friendshipCheck = await this.pool.query(
      "SELECT 1 FROM friendships WHERE user_id = $1 AND friend_id = $2",
      [fromUserId, toUser.id],
    );
    if (friendshipCheck.rows.length > 0) {
      throw new Error("Already friends");
    }

    // Check for existing pending request
    const existingRequest = await this.pool.query(
      `SELECT * FROM friend_requests 
       WHERE ((from_user_id = $1 AND to_user_id = $2) OR (from_user_id = $2 AND to_user_id = $1))
       AND status = 'pending'`,
      [fromUserId, toUser.id],
    );
    if (existingRequest.rows.length > 0) {
      throw new Error("Friend request already exists");
    }

    const request: FriendRequest = {
      id: uuidv4(),
      fromUserId,
      toUserId: toUser.id,
      status: "pending",
      createdAt: Date.now(),
    };

    await this.pool.query(
      `INSERT INTO friend_requests (id, from_user_id, to_user_id, status, created_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        request.id,
        request.fromUserId,
        request.toUserId,
        request.status,
        request.createdAt,
      ],
    );

    console.log(
      `[DB] Friend request sent: ${fromUserId} -> ${toUser.username}`,
    );
    return request;
  }

  async getIncomingFriendRequests(
    userId: string,
  ): Promise<(FriendRequest & { fromUsername: string })[]> {
    const result = await this.pool.query(
      `SELECT fr.*, u.username as from_username
       FROM friend_requests fr
       JOIN users u ON fr.from_user_id = u.id
       WHERE fr.to_user_id = $1 AND fr.status = 'pending'
       ORDER BY fr.created_at DESC`,
      [userId],
    );

    return result.rows.map((row: any) => ({
      id: row.id,
      fromUserId: row.from_user_id,
      toUserId: row.to_user_id,
      status: row.status,
      createdAt: parseInt(row.created_at),
      respondedAt: row.responded_at ? parseInt(row.responded_at) : undefined,
      fromUsername: row.from_username,
    }));
  }

  async acceptFriendRequest(requestId: string, userId: string): Promise<void> {
    const result = await this.pool.query(
      "SELECT * FROM friend_requests WHERE id = $1",
      [requestId],
    );

    if (result.rows.length === 0) {
      throw new Error("Friend request not found");
    }

    const request = result.rows[0];

    if (request.to_user_id !== userId) {
      throw new Error("Not authorized to accept this request");
    }

    if (request.status !== "pending") {
      throw new Error("Request already responded");
    }

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      // Update request status
      await client.query(
        "UPDATE friend_requests SET status = 'accepted', responded_at = $1 WHERE id = $2",
        [Date.now(), requestId],
      );

      // Create bidirectional friendship
      const now = Date.now();
      await client.query(
        `INSERT INTO friendships (user_id, friend_id, created_at) VALUES ($1, $2, $3)
         ON CONFLICT DO NOTHING`,
        [request.from_user_id, request.to_user_id, now],
      );
      await client.query(
        `INSERT INTO friendships (user_id, friend_id, created_at) VALUES ($1, $2, $3)
         ON CONFLICT DO NOTHING`,
        [request.to_user_id, request.from_user_id, now],
      );

      await client.query("COMMIT");
      console.log(`[DB] Friend request accepted: ${requestId}`);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async rejectFriendRequest(requestId: string, userId: string): Promise<void> {
    const result = await this.pool.query(
      "SELECT * FROM friend_requests WHERE id = $1",
      [requestId],
    );

    if (result.rows.length === 0) {
      throw new Error("Friend request not found");
    }

    const request = result.rows[0];

    if (request.to_user_id !== userId) {
      throw new Error("Not authorized to reject this request");
    }

    await this.pool.query(
      "UPDATE friend_requests SET status = 'rejected', responded_at = $1 WHERE id = $2",
      [Date.now(), requestId],
    );
  }

  async removeFriend(userId: string, friendId: string): Promise<void> {
    await this.pool.query(
      "DELETE FROM friendships WHERE (user_id = $1 AND friend_id = $2) OR (user_id = $2 AND friend_id = $1)",
      [userId, friendId],
    );
    console.log(`[DB] Friendship removed: ${userId} <-> ${friendId}`);
  }

  // ==================== ACTIVITY OPERATIONS ====================

  private getDateKey(timestamp?: number): string {
    const date = timestamp ? new Date(timestamp) : new Date();
    return date.toISOString().split("T")[0];
  }

  async updateActivity(
    userId: string,
    totalSeconds: number,
    projects: Map<string, number>,
    languages: Map<string, number>,
  ): Promise<void> {
    const date = this.getDateKey();
    const id = `${userId}-${date}`;
    const now = Date.now();

    const projectsObj = Object.fromEntries(projects);
    const languagesObj = Object.fromEntries(languages);

    // Get existing activity
    const existing = await this.pool.query(
      "SELECT * FROM daily_activities WHERE id = $1",
      [id],
    );

    if (existing.rows.length === 0) {
      // Create new
      await this.pool.query(
        `INSERT INTO daily_activities (id, user_id, date, total_seconds, projects, languages, last_update)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          id,
          userId,
          date,
          totalSeconds,
          JSON.stringify(projectsObj),
          JSON.stringify(languagesObj),
          now,
        ],
      );
    } else {
      // Update existing - merge data
      const existingRow = existing.rows[0];
      const existingProjects = existingRow.projects || {};
      const existingLanguages = existingRow.languages || {};

      // Merge projects
      for (const [proj, secs] of projects) {
        existingProjects[proj] = (existingProjects[proj] || 0) + secs;
      }

      // Merge languages
      for (const [lang, secs] of languages) {
        existingLanguages[lang] = (existingLanguages[lang] || 0) + secs;
      }

      const newTotal = existingRow.total_seconds + totalSeconds;

      await this.pool.query(
        `UPDATE daily_activities 
         SET total_seconds = $1, projects = $2, languages = $3, last_update = $4
         WHERE id = $5`,
        [
          newTotal,
          JSON.stringify(existingProjects),
          JSON.stringify(existingLanguages),
          now,
          id,
        ],
      );
    }

    // Also update hourly activity
    if (totalSeconds > 0) {
      await this.updateHourlyActivity(userId, totalSeconds, projects, languages);
    }
  }

  async getTodayActivity(userId: string): Promise<DailyActivity | null> {
    const date = this.getDateKey();
    const result = await this.pool.query(
      "SELECT * FROM daily_activities WHERE user_id = $1 AND date = $2",
      [userId, date],
    );

    if (result.rows.length === 0) return null;

    const row = result.rows[0];
    return {
      userId: row.user_id,
      date: row.date,
      totalSeconds: row.total_seconds,
      projects: new Map(Object.entries(row.projects || {})),
      languages: new Map(Object.entries(row.languages || {})),
      lastUpdate: parseInt(row.last_update),
    };
  }

  async getWeekActivity(userId: string): Promise<number> {
    const now = Date.now();
    const dates: string[] = [];
    for (let i = 0; i < 7; i++) {
      dates.push(this.getDateKey(now - i * 24 * 60 * 60 * 1000));
    }

    const result = await this.pool.query(
      `SELECT COALESCE(SUM(total_seconds), 0) as total
       FROM daily_activities
       WHERE user_id = $1 AND date = ANY($2)`,
      [userId, dates],
    );

    return parseInt(result.rows[0].total) || 0;
  }

  // ==================== FRIENDS ACTIVITY ====================

  async getFriendsActivity(userId: string): Promise<FriendActivity[]> {
    const today = this.getDateKey();
    const now = Date.now();
    const idleThreshold = 2 * 60 * 1000; // 2 minutes
    const offlineThreshold = 5 * 60 * 1000; // 5 minutes

    // Single JOIN query instead of N+1
    const result = await this.pool.query(
      `SELECT u.id, u.username, u.avatar_url, u.settings,
              da.total_seconds, da.projects, da.languages, da.last_update
       FROM friendships f
       JOIN users u ON u.id = f.friend_id
       LEFT JOIN daily_activities da ON da.user_id = f.friend_id AND da.date = $2
       WHERE f.user_id = $1`,
      [userId, today],
    );

    if (result.rows.length === 0) {
      return [];
    }

    const activities: FriendActivity[] = result.rows.map((row: any) => {
      const defaultSettings = {
        shareActivity: true,
        shareProjectName: true,
        shareLanguage: true,
      };
      const settings = { ...defaultSettings, ...(row.settings || {}) };

      if (settings.shareActivity === false) {
        return {
          id: row.id,
          username: row.username,
          avatarUrl: row.avatar_url,
          activeSeconds: 0,
          lastActive: 0,
          status: "offline" as const,
        };
      }

      const lastUpdate = row.last_update ? parseInt(row.last_update) : 0;
      const timeSinceActive = now - lastUpdate;

      let status: "online" | "idle" | "offline" = "offline";
      if (row.total_seconds && timeSinceActive < idleThreshold) {
        status = "online";
      } else if (row.total_seconds && timeSinceActive < offlineThreshold) {
        status = "idle";
      }

      let currentProject: string | undefined;
      let currentLanguage: string | undefined;

      if (settings.shareProjectName && row.projects) {
        const projects = row.projects;
        let maxSeconds = 0;
        for (const [proj, secs] of Object.entries(projects)) {
          if ((secs as number) > maxSeconds) {
            maxSeconds = secs as number;
            currentProject = proj;
          }
        }
      }

      if (settings.shareLanguage && row.languages) {
        const languages = row.languages;
        let maxSeconds = 0;
        for (const [lang, secs] of Object.entries(languages)) {
          if ((secs as number) > maxSeconds) {
            maxSeconds = secs as number;
            currentLanguage = lang;
          }
        }
      }

      return {
        id: row.id,
        username: row.username,
        avatarUrl: row.avatar_url,
        currentProject,
        currentLanguage,
        activeSeconds: row.total_seconds || 0,
        lastActive: lastUpdate,
        status,
      };
    });

    // Sort by status (online first) then by active seconds
    return activities.sort((a, b) => {
      const statusOrder = { online: 0, idle: 1, offline: 2 };
      if (statusOrder[a.status] !== statusOrder[b.status]) {
        return statusOrder[a.status] - statusOrder[b.status];
      }
      return b.activeSeconds - a.activeSeconds;
    });
  }

  // ==================== HOURLY ACTIVITY OPERATIONS ====================

  async updateHourlyActivity(
    userId: string,
    totalSeconds: number,
    projects: Map<string, number>,
    languages: Map<string, number>,
  ): Promise<void> {
    const now = new Date();
    const date = this.getDateKey();
    const hour = now.getUTCHours();
    const id = `${userId}-${date}-${hour}`;

    const projectsObj = Object.fromEntries(projects);
    const languagesObj = Object.fromEntries(languages);

    const existing = await this.pool.query(
      "SELECT * FROM hourly_activities WHERE id = $1",
      [id],
    );

    if (existing.rows.length === 0) {
      await this.pool.query(
        `INSERT INTO hourly_activities (id, user_id, date, hour, total_seconds, projects, languages)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [id, userId, date, hour, totalSeconds, JSON.stringify(projectsObj), JSON.stringify(languagesObj)],
      );
    } else {
      const existingRow = existing.rows[0];
      const existingProjects = existingRow.projects || {};
      const existingLanguages = existingRow.languages || {};

      for (const [proj, secs] of projects) {
        existingProjects[proj] = (existingProjects[proj] || 0) + secs;
      }
      for (const [lang, secs] of languages) {
        existingLanguages[lang] = (existingLanguages[lang] || 0) + secs;
      }

      const newTotal = existingRow.total_seconds + totalSeconds;
      await this.pool.query(
        `UPDATE hourly_activities SET total_seconds = $1, projects = $2, languages = $3 WHERE id = $4`,
        [newTotal, JSON.stringify(existingProjects), JSON.stringify(existingLanguages), id],
      );
    }
  }

  async getHourlyActivity(userId: string, days: number): Promise<HourlyActivity[]> {
    const dates: string[] = [];
    const now = Date.now();
    for (let i = 0; i < days; i++) {
      dates.push(this.getDateKey(now - i * 24 * 60 * 60 * 1000));
    }

    const result = await this.pool.query(
      `SELECT date, hour, total_seconds FROM hourly_activities
       WHERE user_id = $1 AND date = ANY($2)
       ORDER BY date DESC, hour ASC`,
      [userId, dates],
    );

    return result.rows.map((row: any) => ({
      date: row.date,
      hour: row.hour,
      totalSeconds: row.total_seconds,
    }));
  }

  async getDailyHistory(userId: string, days: number): Promise<{ date: string; totalSeconds: number }[]> {
    const dates: string[] = [];
    const now = Date.now();
    for (let i = 0; i < days; i++) {
      dates.push(this.getDateKey(now - i * 24 * 60 * 60 * 1000));
    }

    const result = await this.pool.query(
      `SELECT date, total_seconds FROM daily_activities
       WHERE user_id = $1 AND date = ANY($2)
       ORDER BY date ASC`,
      [userId, dates],
    );

    return result.rows.map((row: any) => ({
      date: row.date,
      totalSeconds: row.total_seconds,
    }));
  }

  async getLanguageDistribution(userId: string, days: number): Promise<LanguageStats[]> {
    const dates: string[] = [];
    const now = Date.now();
    for (let i = 0; i < days; i++) {
      dates.push(this.getDateKey(now - i * 24 * 60 * 60 * 1000));
    }

    const result = await this.pool.query(
      `SELECT languages FROM daily_activities
       WHERE user_id = $1 AND date = ANY($2)`,
      [userId, dates],
    );

    const langTotals = new Map<string, number>();
    let grandTotal = 0;

    for (const row of result.rows) {
      const langs = row.languages || {};
      for (const [lang, secs] of Object.entries(langs)) {
        const seconds = secs as number;
        langTotals.set(lang, (langTotals.get(lang) || 0) + seconds);
        grandTotal += seconds;
      }
    }

    const stats: LanguageStats[] = [];
    for (const [name, totalSeconds] of langTotals) {
      stats.push({
        name,
        totalSeconds,
        percentage: grandTotal > 0 ? Math.round((totalSeconds / grandTotal) * 100) : 0,
      });
    }

    return stats.sort((a, b) => b.totalSeconds - a.totalSeconds);
  }

  // ==================== ACHIEVEMENT OPERATIONS ====================

  private async seedAchievements(): Promise<void> {
    const achievements = [
      { id: "first_hour", name: "First Hour", description: "Code for 1 hour total", icon: "🎯", category: "time", thresholdType: "total_hours", thresholdValue: 1 },
      { id: "five_hours", name: "Getting Started", description: "Code for 5 hours total", icon: "🌱", category: "time", thresholdType: "total_hours", thresholdValue: 5 },
      { id: "ten_hours", name: "Dedicated", description: "Code for 10 hours total", icon: "💪", category: "time", thresholdType: "total_hours", thresholdValue: 10 },
      { id: "fifty_hours", name: "Committed", description: "Code for 50 hours total", icon: "🔥", category: "time", thresholdType: "total_hours", thresholdValue: 50 },
      { id: "hundred_hours", name: "Century", description: "Code for 100 hours total", icon: "💯", category: "time", thresholdType: "total_hours", thresholdValue: 100 },
      { id: "five_hundred_hours", name: "Legendary", description: "Code for 500 hours total", icon: "🏆", category: "time", thresholdType: "total_hours", thresholdValue: 500 },
      { id: "streak_3", name: "Consistent", description: "Code 3 days in a row", icon: "📅", category: "streak", thresholdType: "streak_days", thresholdValue: 3 },
      { id: "streak_7", name: "Week Warrior", description: "Code 7 days in a row", icon: "⚔️", category: "streak", thresholdType: "streak_days", thresholdValue: 7 },
      { id: "streak_14", name: "Unstoppable", description: "Code 14 days in a row", icon: "🚀", category: "streak", thresholdType: "streak_days", thresholdValue: 14 },
      { id: "streak_30", name: "Iron Will", description: "Code 30 days in a row", icon: "🛡️", category: "streak", thresholdType: "streak_days", thresholdValue: 30 },
      { id: "lang_2", name: "Bilingual", description: "Code in 2 different languages", icon: "🌐", category: "language", thresholdType: "language_count", thresholdValue: 2 },
      { id: "lang_5", name: "Polyglot", description: "Code in 5 different languages", icon: "🗣️", category: "language", thresholdType: "language_count", thresholdValue: 5 },
      { id: "lang_10", name: "Language Master", description: "Code in 10 different languages", icon: "👑", category: "language", thresholdType: "language_count", thresholdValue: 10 },
      { id: "friend_1", name: "First Friend", description: "Add your first friend", icon: "🤝", category: "social", thresholdType: "friend_count", thresholdValue: 1 },
      { id: "friend_5", name: "Social Butterfly", description: "Add 5 friends", icon: "🦋", category: "social", thresholdType: "friend_count", thresholdValue: 5 },
      { id: "friend_10", name: "Popular", description: "Add 10 friends", icon: "⭐", category: "social", thresholdType: "friend_count", thresholdValue: 10 },
      { id: "night_owl", name: "Night Owl", description: "Code between midnight and 5 AM", icon: "🦉", category: "special", thresholdType: "night_coding", thresholdValue: 1 },
      { id: "early_bird", name: "Early Bird", description: "Code between 5 AM and 7 AM", icon: "🐦", category: "special", thresholdType: "early_coding", thresholdValue: 1 },
      { id: "marathon", name: "Marathon", description: "Code for 8+ hours in one day", icon: "🏃", category: "special", thresholdType: "daily_hours", thresholdValue: 8 },
      { id: "weekend_warrior", name: "Weekend Warrior", description: "Code on both Saturday and Sunday", icon: "🎮", category: "special", thresholdType: "weekend_coding", thresholdValue: 1 },
    ];

    for (const ach of achievements) {
      await this.pool.query(
        `INSERT INTO achievements (id, name, description, icon, category, threshold_type, threshold_value)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (id) DO NOTHING`,
        [ach.id, ach.name, ach.description, ach.icon, ach.category, ach.thresholdType, ach.thresholdValue],
      );
    }
    console.log("[DB] Achievements seeded");
  }

  async getAllAchievements(): Promise<Achievement[]> {
    const result = await this.pool.query("SELECT * FROM achievements ORDER BY category, threshold_value");
    return result.rows.map((row: any) => ({
      id: row.id,
      name: row.name,
      description: row.description,
      icon: row.icon,
      category: row.category,
      thresholdType: row.threshold_type,
      thresholdValue: row.threshold_value,
    }));
  }

  async getUserAchievements(userId: string): Promise<UserAchievement[]> {
    const result = await this.pool.query(
      `SELECT ua.achievement_id, ua.unlocked_at, a.name, a.description, a.icon, a.category
       FROM user_achievements ua
       JOIN achievements a ON ua.achievement_id = a.id
       WHERE ua.user_id = $1
       ORDER BY ua.unlocked_at DESC`,
      [userId],
    );

    return result.rows.map((row: any) => ({
      achievementId: row.achievement_id,
      name: row.name,
      description: row.description,
      icon: row.icon,
      category: row.category,
      unlockedAt: parseInt(row.unlocked_at),
    }));
  }

  async checkAndUnlockAchievements(userId: string): Promise<UserAchievement[]> {
    const newlyUnlocked: UserAchievement[] = [];
    const user = await this.getUserById(userId);
    if (!user) return newlyUnlocked;

    const existingAchievements = await this.getUserAchievements(userId);
    const unlockedIds = new Set(existingAchievements.map((a) => a.achievementId));

    const allAchievements = await this.getAllAchievements();

    for (const ach of allAchievements) {
      if (unlockedIds.has(ach.id)) continue;

      let earned = false;

      switch (ach.thresholdType) {
        case "total_hours": {
          // Sum all daily activities
          const result = await this.pool.query(
            "SELECT COALESCE(SUM(total_seconds), 0) as total FROM daily_activities WHERE user_id = $1",
            [userId],
          );
          const totalHours = parseInt(result.rows[0].total) / 3600;
          earned = totalHours >= ach.thresholdValue;
          break;
        }
        case "streak_days": {
          // Check consecutive days
          const result = await this.pool.query(
            "SELECT DISTINCT date FROM daily_activities WHERE user_id = $1 AND total_seconds > 0 ORDER BY date DESC",
            [userId],
          );
          let streak = 0;
          const today = this.getDateKey();
          let expectedDate = today;
          for (const row of result.rows) {
            if (row.date === expectedDate) {
              streak++;
              const d = new Date(expectedDate);
              d.setDate(d.getDate() - 1);
              expectedDate = d.toISOString().split("T")[0];
            } else {
              break;
            }
          }
          earned = streak >= ach.thresholdValue;
          break;
        }
        case "language_count": {
          const result = await this.pool.query(
            "SELECT languages FROM daily_activities WHERE user_id = $1",
            [userId],
          );
          const allLangs = new Set<string>();
          for (const row of result.rows) {
            if (row.languages) {
              for (const lang of Object.keys(row.languages)) {
                allLangs.add(lang);
              }
            }
          }
          earned = allLangs.size >= ach.thresholdValue;
          break;
        }
        case "friend_count": {
          earned = user.friends.length >= ach.thresholdValue;
          break;
        }
        case "night_coding": {
          const result = await this.pool.query(
            "SELECT 1 FROM hourly_activities WHERE user_id = $1 AND hour >= 0 AND hour < 5 AND total_seconds > 0 LIMIT 1",
            [userId],
          );
          earned = result.rows.length > 0;
          break;
        }
        case "early_coding": {
          const result = await this.pool.query(
            "SELECT 1 FROM hourly_activities WHERE user_id = $1 AND hour >= 5 AND hour < 7 AND total_seconds > 0 LIMIT 1",
            [userId],
          );
          earned = result.rows.length > 0;
          break;
        }
        case "daily_hours": {
          const result = await this.pool.query(
            "SELECT 1 FROM daily_activities WHERE user_id = $1 AND total_seconds >= $2 LIMIT 1",
            [userId, ach.thresholdValue * 3600],
          );
          earned = result.rows.length > 0;
          break;
        }
        case "weekend_coding": {
          // Check if there's activity on both Saturday(6) and Sunday(0)
          const result = await this.pool.query(
            "SELECT date FROM daily_activities WHERE user_id = $1 AND total_seconds > 0",
            [userId],
          );
          let hasSaturday = false;
          let hasSunday = false;
          for (const row of result.rows) {
            const day = new Date(row.date).getDay();
            if (day === 6) hasSaturday = true;
            if (day === 0) hasSunday = true;
          }
          earned = hasSaturday && hasSunday;
          break;
        }
      }

      if (earned) {
        const now = Date.now();
        await this.pool.query(
          `INSERT INTO user_achievements (user_id, achievement_id, unlocked_at)
           VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
          [userId, ach.id, now],
        );
        newlyUnlocked.push({
          achievementId: ach.id,
          name: ach.name,
          description: ach.description,
          icon: ach.icon,
          category: ach.category,
          unlockedAt: now,
        });
        console.log(`[DB] Achievement unlocked: ${user.username} -> ${ach.name}`);
      }
    }

    return newlyUnlocked;
  }

  // ==================== MESSAGE OPERATIONS ====================

  async saveMessage(fromUserId: string, toUserId: string, content: string): Promise<ChatMessage> {
    const id = uuidv4();
    const now = Date.now();

    await this.pool.query(
      `INSERT INTO messages (id, from_user_id, to_user_id, content, created_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [id, fromUserId, toUserId, content, now],
    );

    // Get sender username
    const senderResult = await this.pool.query("SELECT username FROM users WHERE id = $1", [fromUserId]);
    const fromUsername = senderResult.rows[0]?.username;

    return {
      id,
      fromUserId,
      toUserId,
      content,
      createdAt: now,
      fromUsername,
    };
  }

  async getMessages(
    userId1: string,
    userId2: string,
    limit: number = 50,
    before?: number,
  ): Promise<ChatMessage[]> {
    let query = `
      SELECT m.*, u.username as from_username
      FROM messages m
      JOIN users u ON m.from_user_id = u.id
      WHERE ((m.from_user_id = $1 AND m.to_user_id = $2)
        OR (m.from_user_id = $2 AND m.to_user_id = $1))
    `;
    const params: any[] = [userId1, userId2];

    if (before) {
      query += ` AND m.created_at < $3`;
      params.push(before);
    }

    query += ` ORDER BY m.created_at DESC LIMIT $${params.length + 1}`;
    params.push(limit);

    const result = await this.pool.query(query, params);

    return result.rows.map((row: any) => ({
      id: row.id,
      fromUserId: row.from_user_id,
      toUserId: row.to_user_id,
      content: row.content,
      createdAt: parseInt(row.created_at),
      readAt: row.read_at ? parseInt(row.read_at) : undefined,
      fromUsername: row.from_username,
    })).reverse(); // Return in chronological order
  }

  async getUnreadCounts(userId: string): Promise<{ fromUserId: string; fromUsername: string; count: number }[]> {
    const result = await this.pool.query(
      `SELECT m.from_user_id, u.username as from_username, COUNT(*) as count
       FROM messages m
       JOIN users u ON m.from_user_id = u.id
       WHERE m.to_user_id = $1 AND m.read_at IS NULL
       GROUP BY m.from_user_id, u.username`,
      [userId],
    );

    return result.rows.map((row: any) => ({
      fromUserId: row.from_user_id,
      fromUsername: row.from_username,
      count: parseInt(row.count),
    }));
  }

  async markMessagesRead(userId: string, fromUserId: string): Promise<void> {
    const now = Date.now();
    await this.pool.query(
      `UPDATE messages SET read_at = $1
       WHERE to_user_id = $2 AND from_user_id = $3 AND read_at IS NULL`,
      [now, userId, fromUserId],
    );
  }

  // ==================== AVATAR OPERATIONS ====================

  async updateUserAvatar(userId: string, avatarId: string): Promise<void> {
    const validAvatar = PREDEFINED_AVATARS.find((a) => a.id === avatarId);
    if (!validAvatar) {
      throw new Error("Invalid avatar ID");
    }
    await this.pool.query("UPDATE users SET avatar_id = $1 WHERE id = $2", [avatarId, userId]);
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

// Export singleton
export const db = new PostgresDatabase();
