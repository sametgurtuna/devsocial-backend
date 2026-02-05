import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import helmet from "helmet";
import dotenv from "dotenv";
import jwt from "jsonwebtoken";
import rateLimit from "express-rate-limit";
import { db } from "./database-pg";
import { SyncRequest, SyncResponse } from "./types";
import {
  generateSocialPost,
  generateWeeklySummary,
  generateMilestonePost,
} from "./postGenerator";

// Load .env file
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET =
  process.env.JWT_SECRET || "devsocial-secret-key-change-in-production";

// Production environment check
const isProduction = process.env.NODE_ENV === "production";

// CORS configuration
const corsOrigins = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(",").map((origin) => origin.trim())
  : ["*"];

const corsOptions: cors.CorsOptions = {
  origin: isProduction ? corsOrigins : true, // Development'ta tüm origin'lere izin ver
  methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "x-api-key", "Authorization"],
  credentials: true,
  maxAge: 86400, // 24 saat preflight cache
};

// Rate limiting configuration
const rateLimitWindowMs = parseInt(process.env.RATE_LIMIT_WINDOW_MS || "60000"); // Default: 1 dakika
const rateLimitMaxRequests = parseInt(
  process.env.RATE_LIMIT_MAX_REQUESTS || "100",
); // Default: 100 istek

const apiLimiter = rateLimit({
  windowMs: rateLimitWindowMs,
  max: rateLimitMaxRequests,
  message: {
    success: false,
    message: "Çok fazla istek gönderdiniz. Lütfen biraz bekleyin.",
  },
  standardHeaders: true,
  legacyHeaders: false,
  validate: { xForwardedForHeader: false },
  // API key başına rate limit
  keyGenerator: (req) => {
    const apiKey = req.headers["x-api-key"] as string;
    return apiKey || "anonymous";
  },
  skip: (req) => {
    // Health check endpoint'i rate limit'ten muaf
    return req.path === "/api/health";
  },
});

// Auth endpoint'leri için daha sıkı rate limit
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 dakika
  max: 10, // 15 dakikada max 10 login/register denemesi
  message: {
    success: false,
    message: "Çok fazla giriş denemesi. 15 dakika sonra tekrar deneyin.",
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Middleware
app.use(
  helmet({
    contentSecurityPolicy: isProduction ? undefined : false,
    crossOriginEmbedderPolicy: false,
  }),
);
app.use(cors(corsOptions));
app.use(express.json({ limit: "1mb" }));

// Apply rate limiting to all API routes
app.use("/api/", apiLimiter);

// Request logging
app.use((req: Request, res: Response, next: NextFunction) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

// API Key authentication middleware
async function authenticateApiKey(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const apiKey = req.headers["x-api-key"] as string;

  if (!apiKey) {
    res.status(401).json({ success: false, message: "API key required" });
    return;
  }

  try {
    const user = await db.getUserByApiKey(apiKey);
    if (!user) {
      res.status(401).json({ success: false, message: "Invalid API key" });
      return;
    }

    // Add user to request
    (req as any).user = user;
    next();
  } catch (error) {
    console.error("[AUTH ERROR]", error);
    res.status(500).json({ success: false, message: "Authentication error" });
  }
}

// ==================== API ROUTES ====================

/**
 * Health check
 */
app.get("/api/health", (req: Request, res: Response) => {
  res.json({
    status: "ok",
    timestamp: Date.now(),
    version: "1.0.2",
    database: "postgresql",
  });
});

/**
 * Aktivite senkronizasyonu
 * VS Code extension'dan gelen verileri işler
 */
app.post(
  "/api/activity/sync",
  authenticateApiKey,
  async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      const { summary, heartbeats }: SyncRequest = req.body;

      console.log(
        `[SYNC] User: ${user.username}, Heartbeats: ${heartbeats?.length || 0}`,
      );

      // Security: Only accept metadata, no code content
      if (!summary || typeof summary.totalActiveSeconds !== "number") {
        res.status(400).json({
          success: false,
          message: "Invalid data format",
        });
        return;
      }

      // Update activity
      const projectsMap = new Map<string, number>();
      const languagesMap = new Map<string, number>();

      summary.projects?.forEach((p) => {
        projectsMap.set(p.projectName, p.activeSeconds);
      });

      summary.languages?.forEach((l) => {
        languagesMap.set(l.language, l.activeSeconds);
      });

      await db.updateActivity(
        user.id,
        summary.totalActiveSeconds,
        projectsMap,
        languagesMap,
      );

      // Get updated data
      const todayActivity = await db.getTodayActivity(user.id);
      const weekTotal = await db.getWeekActivity(user.id);
      const friendsActivity = await db.getFriendsActivity(user.id);

      // Response
      const response: SyncResponse = {
        success: true,
        message: "Sync successful",
        data: {
          todayTotal: todayActivity?.totalSeconds || 0,
          weekTotal: weekTotal,
          friendsActivity: friendsActivity,
        },
      };

      res.json(response);
    } catch (error) {
      console.error("[SYNC ERROR]", error);
      res.status(500).json({
        success: false,
        message: "Server error",
      });
    }
  },
);

/**
 * Get friends activity
 */
app.get(
  "/api/activity/friends",
  authenticateApiKey,
  async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      const friendsActivity = await db.getFriendsActivity(user.id);

      res.json({
        success: true,
        friends: friendsActivity,
      });
    } catch (error) {
      console.error("[FRIENDS ERROR]", error);
      res.status(500).json({
        success: false,
        message: "Server error",
      });
    }
  },
);

/**
 * Get user statistics
 */
app.get(
  "/api/activity/stats",
  authenticateApiKey,
  async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      const todayActivity = await db.getTodayActivity(user.id);
      const weekTotal = await db.getWeekActivity(user.id);

      res.json({
        success: true,
        stats: {
          today: {
            totalSeconds: todayActivity?.totalSeconds || 0,
            projects: todayActivity
              ? Object.fromEntries(todayActivity.projects)
              : {},
            languages: todayActivity
              ? Object.fromEntries(todayActivity.languages)
              : {},
          },
          week: {
            totalSeconds: weekTotal,
          },
        },
      });
    } catch (error) {
      console.error("[STATS ERROR]", error);
      res.status(500).json({
        success: false,
        message: "Server error",
      });
    }
  },
);

/**
 * Generate social media post (preview)
 */
app.get(
  "/api/post/preview",
  authenticateApiKey,
  async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      const platform = (req.query.platform as string) || "twitter";
      const todayActivity = await db.getTodayActivity(user.id);

      if (!todayActivity || todayActivity.totalSeconds < 60) {
        res.json({
          success: false,
          message: "Not enough activity data (minimum 1 minute required)",
        });
        return;
      }

      const post = generateSocialPost(user.username, todayActivity, {
        includeProject: user.settings.shareProjectName,
        includeLanguages: user.settings.shareLanguage,
        platform: platform as any,
      });

      res.json({
        success: true,
        post: post,
        platform: platform,
        characterCount: post.length,
      });
    } catch (error) {
      console.error("[POST PREVIEW ERROR]", error);
      res.status(500).json({
        success: false,
        message: "Server error",
      });
    }
  },
);

/**
 * Weekly summary post
 */
app.get(
  "/api/post/weekly",
  authenticateApiKey,
  async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      const weekTotal = await db.getWeekActivity(user.id);
      const todayActivity = await db.getTodayActivity(user.id);

      if (weekTotal < 60) {
        res.json({
          success: false,
          message: "Not enough weekly activity data",
        });
        return;
      }

      // Simplified version (real app would aggregate weekly data)
      const topProjects: { name: string; seconds: number }[] = [];
      const topLanguages: { name: string; seconds: number }[] = [];

      if (todayActivity) {
        todayActivity.projects.forEach((seconds, name) => {
          topProjects.push({ name, seconds });
        });
        todayActivity.languages.forEach((seconds, name) => {
          topLanguages.push({ name, seconds });
        });
      }

      topProjects.sort((a, b) => b.seconds - a.seconds);
      topLanguages.sort((a, b) => b.seconds - a.seconds);

      const post = generateWeeklySummary(
        user.username,
        weekTotal,
        topProjects,
        topLanguages,
      );

      res.json({
        success: true,
        post: post,
        weekTotal: weekTotal,
      });
    } catch (error) {
      console.error("[WEEKLY POST ERROR]", error);
      res.status(500).json({
        success: false,
        message: "Sunucu hatası",
      });
    }
  },
);

/**
 * Kullanıcı bilgilerini getir
 */
app.get("/api/user/me", authenticateApiKey, (req: Request, res: Response) => {
  const user = (req as any).user;

  res.json({
    success: true,
    user: {
      id: user.id,
      username: user.username,
      email: user.email,
      settings: user.settings,
      friendCount: user.friends.length,
    },
  });
});

/**
 * Kullanıcı ayarlarını güncelle
 */
app.patch(
  "/api/user/settings",
  authenticateApiKey,
  (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      const { settings } = req.body;

      if (settings) {
        // Güvenli güncelleme
        if (typeof settings.shareActivity === "boolean") {
          user.settings.shareActivity = settings.shareActivity;
        }
        if (typeof settings.shareProjectName === "boolean") {
          user.settings.shareProjectName = settings.shareProjectName;
        }
        if (typeof settings.shareLanguage === "boolean") {
          user.settings.shareLanguage = settings.shareLanguage;
        }
        if (typeof settings.autoPost === "boolean") {
          user.settings.autoPost = settings.autoPost;
        }
        if (typeof settings.postThreshold === "number") {
          user.settings.postThreshold = Math.max(
            1,
            Math.min(24, settings.postThreshold),
          );
        }
      }

      res.json({
        success: true,
        message: "Ayarlar güncellendi",
        settings: user.settings,
      });
    } catch (error) {
      console.error("[SETTINGS ERROR]", error);
      res.status(500).json({
        success: false,
        message: "Server error",
      });
    }
  },
);

// ==================== FRIENDS API ====================

/**
 * Search users (for adding friends)
 */
app.get(
  "/api/users/search",
  authenticateApiKey,
  async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      const query = req.query.q as string;

      if (!query || query.length < 2) {
        res.json({
          success: true,
          users: [],
        });
        return;
      }

      const results = await db.searchUsers(query, user.id);

      res.json({
        success: true,
        users: results.map((u) => ({
          id: u.id,
          username: u.username,
          avatarUrl: u.avatarUrl,
        })),
      });
    } catch (error) {
      console.error("[SEARCH ERROR]", error);
      res.status(500).json({
        success: false,
        message: "Server error",
      });
    }
  },
);

/**
 * Send friend request
 */
app.post(
  "/api/friends/request",
  authenticateApiKey,
  async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      const { userId, username } = req.body;

      let targetUser;
      if (userId) {
        targetUser = await db.getUserById(userId);
      } else if (username) {
        targetUser = await db.getUserByUsername(username);
      }

      if (!targetUser) {
        res.status(404).json({
          success: false,
          message: "User not found",
        });
        return;
      }

      if (targetUser.id === user.id) {
        res.status(400).json({
          success: false,
          message: "Cannot send friend request to yourself",
        });
        return;
      }

      const request = await db.sendFriendRequest(user.id, targetUser.username);

      res.json({
        success: true,
        message: `Friend request sent to ${targetUser.username}`,
        request: {
          id: request.id,
          toUsername: targetUser.username,
          status: request.status,
          createdAt: request.createdAt,
        },
      });
    } catch (error: any) {
      console.error("[FRIEND REQUEST ERROR]", error);
      res.status(400).json({
        success: false,
        message: error.message || "Failed to send request",
      });
    }
  },
);

/**
 * Get incoming friend requests
 */
app.get(
  "/api/friends/requests/incoming",
  authenticateApiKey,
  async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      const requests = await db.getIncomingFriendRequests(user.id);

      res.json({
        success: true,
        requests: requests.map((r) => ({
          id: r.id,
          fromUserId: r.fromUserId,
          fromUsername: r.fromUsername,
          createdAt: r.createdAt,
        })),
      });
    } catch (error) {
      console.error("[INCOMING REQUESTS ERROR]", error);
      res.status(500).json({
        success: false,
        message: "Server error",
      });
    }
  },
);

/**
 * Accept friend request
 */
app.post(
  "/api/friends/requests/:requestId/accept",
  authenticateApiKey,
  async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      const { requestId } = req.params;

      await db.acceptFriendRequest(requestId, user.id);

      res.json({
        success: true,
        message: "Friend request accepted",
      });
    } catch (error: any) {
      console.error("[ACCEPT REQUEST ERROR]", error);
      res.status(400).json({
        success: false,
        message: error.message || "Failed to accept request",
      });
    }
  },
);

/**
 * Reject friend request
 */
app.post(
  "/api/friends/requests/:requestId/reject",
  authenticateApiKey,
  async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      const { requestId } = req.params;

      await db.rejectFriendRequest(requestId, user.id);

      res.json({
        success: true,
        message: "Friend request rejected",
      });
    } catch (error: any) {
      console.error("[REJECT REQUEST ERROR]", error);
      res.status(400).json({
        success: false,
        message: error.message || "Failed to reject request",
      });
    }
  },
);

/**
 * Remove friend
 */
app.delete(
  "/api/friends/:friendId",
  authenticateApiKey,
  async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      const { friendId } = req.params;

      await db.removeFriend(user.id, friendId);

      res.json({
        success: true,
        message: "Friend removed",
      });
    } catch (error: any) {
      console.error("[REMOVE FRIEND ERROR]", error);
      res.status(400).json({
        success: false,
        message: error.message || "Failed to remove friend",
      });
    }
  },
);

// ==================== USER REGISTRATION & LOGIN ====================

/**
 * Register new user
 */
app.post(
  "/api/auth/register",
  authLimiter,
  async (req: Request, res: Response) => {
    try {
      const { username, password, email } = req.body;

      if (!username || username.length < 3) {
        res.status(400).json({
          success: false,
          message: "Username must be at least 3 characters",
        });
        return;
      }

      if (!password || password.length < 6) {
        res.status(400).json({
          success: false,
          message: "Password must be at least 6 characters",
        });
        return;
      }

      if (!/^[a-zA-Z0-9_]+$/.test(username)) {
        res.status(400).json({
          success: false,
          message: "Username can only contain letters, numbers and underscores",
        });
        return;
      }

      const user = await db.createUser(username, password, email);

      // Create JWT token
      const token = jwt.sign(
        { userId: user.id, username: user.username },
        JWT_SECRET,
        { expiresIn: "30d" },
      );

      res.json({
        success: true,
        message: "Registration successful!",
        user: {
          id: user.id,
          username: user.username,
          apiKey: user.apiKey,
          email: user.email,
        },
        token,
      });
    } catch (error: any) {
      console.error("[REGISTER ERROR]", error);
      res.status(400).json({
        success: false,
        message: error.message || "Registration failed",
      });
    }
  },
);

/**
 * User login
 */
app.post(
  "/api/auth/login",
  authLimiter,
  async (req: Request, res: Response) => {
    try {
      const { username, password } = req.body;

      if (!username || !password) {
        res.status(400).json({
          success: false,
          message: "Username and password required",
        });
        return;
      }

      const user = await db.getUserByUsername(username);

      if (!user) {
        res.status(401).json({
          success: false,
          message: "Invalid username or password",
        });
        return;
      }

      const isValid = await db.verifyPassword(user, password);
      if (!isValid) {
        res.status(401).json({
          success: false,
          message: "Invalid username or password",
        });
        return;
      }

      // Create JWT token
      const token = jwt.sign(
        { userId: user.id, username: user.username },
        JWT_SECRET,
        { expiresIn: "30d" },
      );

      res.json({
        success: true,
        message: "Login successful!",
        user: {
          id: user.id,
          username: user.username,
          apiKey: user.apiKey,
          email: user.email,
        },
        token,
      });
    } catch (error: any) {
      console.error("[LOGIN ERROR]", error);
      res.status(500).json({
        success: false,
        message: "Server error",
      });
    }
  },
);

// 404 handler
app.use((req: Request, res: Response) => {
  res.status(404).json({
    success: false,
    message: "Endpoint not found",
  });
});

// Error handler
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  console.error("[ERROR]", err);
  res.status(500).json({
    success: false,
    message: "Server error",
  });
});

// Start server with database initialization
async function startServer() {
  try {
    // Initialize PostgreSQL database
    await db.initialize();
    console.log("[DB] PostgreSQL connected successfully");

    // Start Express server
    const port = typeof PORT === "string" ? parseInt(PORT, 10) : PORT;
    app.listen(port, "0.0.0.0", () => {
      console.log("╔════════════════════════════════════════════════════╗");
      console.log("║            DevSocial Backend API                   ║");
      console.log("╠════════════════════════════════════════════════════╣");
      console.log(`║  Server running on port ${port}                        ║`);
      console.log(`║  http://localhost:${port}/api                          ║`);
      console.log(
        `║  Mode: ${isProduction ? "PRODUCTION" : "DEVELOPMENT"}                              ║`,
      );
      console.log("║  Database: PostgreSQL (Neon)                       ║");
      console.log("╚════════════════════════════════════════════════════╝");
    });
  } catch (error) {
    console.error("[FATAL] Failed to start server:", error);
    process.exit(1);
  }
}

startServer();

export default app;
