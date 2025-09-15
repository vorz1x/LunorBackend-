#include <algorithm>
#include "Report.h"
#include "User.h"
#include "HWIDBan.h"

// Whitelisted sources for Lunor custom PAKs
const std::unordered_set<std::string> LUNOR_CUSTOM_WHITELIST = {
    "lunor_custom_cosmatics.pak",
    "lunor_custom_cosmatics.sig"
    // Add additional trusted Lunor custom pack identifiers here
};

// Blocked/unauthorized client sources or signatures (extended aggressively)
const std::unordered_set<std::string> BLOCKED_SOURCES = {
    "src_cheat",
    "modded_client",
    "unauthorized_debug",
    "1hack",
    "esp",
    "esp_hack",
    "aimbot",
    "wallhack",
    "speedhack",
    "teleporthack",
    "itemdupe",
    "memorytamper",
    "packetforge",
    "injector",
    "dllhack",
    "overlaycheat",
    "silentaim",
    "spinbot",
    "flyhack",
    "noclip",
    "godmode",
    "radarhack",
    "triggerbot",
    "autoclicker",
    "macro",
    "recoilscript",
    "antirecoil",
    "bypass",
    "cheatengine",
    "trainer",
    "hvh",
    "luaexecutor",
    "pythoninject",
    "externaloverlay",
    "minimap",
    "statchanger",
    "fovchanger",
    "inventoryhack",
    "skinchanger",
    "glowesp",
    "chams",
    "backtrack",
    "hitboxexpander",
    "superjump",
    "superrun",
    "teleport",
    "moneyhack",
    "scorehack",
    "xpboost",
    "damagehack",
    "drophack",
    "crashserver",
    "forcekick",
    "spoof",
    "hook",
    "hooklib",
    "hookmod",
    "hookdll",
    "hookinject",
    "overlaymod",
    "overlaydll",
    "overlayinject",
    "modmenu",
    "menuhack",
    "modtool",
    "modkit",
    "modscript"
    // Add others as discovered
};

// Thresholds
const double MAX_ALLOWED_SPEED = 100.0;
const double MAX_ALLOWED_TELEPORT_DIST = 50.0;
const int MIN_FIRE_INTERVAL_MS = 100;
const int HWID_BAN_RETENTION_DAYS = 365;

// PlayerState struct
struct PlayerState {
    std::string userId;
    double speed;
    struct {
        double x;
        double y;
    } position;
    std::string src;
    std::string hwid;

    // Anti-cheat signals
    bool hasESP;
    bool hasWallhack;
    bool hasInjector;
    bool hasOverlay;
    bool abnormalInput;
    bool memoryTamper;
    bool hasSpeedhack;
    bool hasTeleport;
    bool hasAimbot;
    bool hasPacketForge;
    bool hasItemDupe;

    // Telemetry for ML/statistics
    double movementEntropy;
    double aimSmoothness;
    double serverTickDelta;
    int suspiciousEventCount;
    double hitMissRatio;

    // Session/connection info
    std::string ipAddress;
    std::string sessionId;
    long long lastActionTimestamp;
};

// Payload struct
struct AimPayload {
    double angle;
    long long timestamp;
    double hitRate;
    int shots;
    bool isPerfectSnap;
};

struct FirePayload {
    std::vector<long long> fireTimestamps;
    bool isRapidFire;
};

struct Payload {
    AimPayload aim;
    FirePayload fire;
    bool isESPActive;
    bool isWallhackActive;
    bool isTeleportActive;
    bool isItemDupeAttempt;
    bool isPacketForgeAttempt;
    bool isMemoryTamperAttempt;
    // Extend with additional cheat signals as needed
};

// Validation result
struct ValidationResult {
    bool valid;
    std::string reason;
};

// Helper functions
void logSuspicious(const std::string& userId, const std::string& reason, const std::string& details) {
    Report report(userId, reason, details, std::time(nullptr));
    report.save();
}

void banHWID(const std::string& hwid, const std::string& reason, const std::string& userId) {
    HWIDBan::ban(hwid, reason, userId, std::time(nullptr), std::time(nullptr) + HWID_BAN_RETENTION_DAYS * 86400);
}

bool isHWIDBanned(const std::string& hwid) {
    return HWIDBan::isBanned(hwid, std::time(nullptr));
}

void blockUser(const std::string& userId, const std::string& reason, const std::string& hwid) {
    User::ban(userId, reason, std::time(nullptr));
    if (!hwid.empty()) {
        banHWID(hwid, reason, userId);
    }
    // Implement disconnect logic and admin notification as needed
}

void logAndBlock(const PlayerState& playerState, const std::string& reason, const std::string& details) {
    logSuspicious(playerState.userId, reason, details);
    blockUser(playerState.userId, reason, playerState.hwid);
}

// Check if source is whitelisted for Lunor custom paks
bool isLunorCustomAllowed(const std::string& src) {
    std::string lowerSrc = src;
    std::transform(lowerSrc.begin(), lowerSrc.end(), lowerSrc.begin(), ::tolower);
    for (const auto& allowed : LUNOR_CUSTOM_WHITELIST) {
        if (lowerSrc.find(allowed) != std::string::npos) return true;
    }
    return false;
}

// Detect any blocked/cheat client source strictly, but allow Lunor custom paks
bool isBlockedSource(const std::string& src) {
    if (isLunorCustomAllowed(src)) return false;
    std::string lowerSrc = src;
    std::transform(lowerSrc.begin(), lowerSrc.end(), lowerSrc.begin(), ::tolower);
    for (const auto& blocked : BLOCKED_SOURCES) {
        if (lowerSrc.find(blocked) != std::string::npos) return true;
    }
    return false;
}

// ESP/wallhack/injector detection based on signals
bool detectESPWallhack(const PlayerState& playerState, const Payload& payload) {
    return playerState.hasESP || playerState.hasWallhack || playerState.hasInjector || playerState.hasOverlay ||
           payload.isESPActive || payload.isWallhackActive;
}

// Aimbot detector: impossible aim changes, perfect snaps, impossible hit rate
bool detectAimbot(const PlayerState& playerState, const PlayerState& previousState, const Payload& payload) {
    double angleDelta = std::abs(payload.aim.angle - previousState.position.x); // Adjust angle source as needed
    long long timeDelta = payload.aim.timestamp - previousState.position.y; // Adjust timestamp source as needed
    if (payload.aim.isPerfectSnap) return true;
    if (playerState.hasAimbot) return true;
    if (angleDelta > 45.0 && timeDelta < 50) return true;
    if (payload.aim.hitRate > 0.99 && payload.aim.shots > 20) return true;
    return false;
}

// Rapid fire detector
bool detectRapidFire(const PlayerState& playerState, const Payload& payload) {
    if (payload.fire.isRapidFire) return true;
    if (playerState.abnormalInput) return true;
    if (payload.fire.fireTimestamps.size() < 2) return false;
    long long minInterval = LLONG_MAX;
    for (size_t i = 1; i < payload.fire.fireTimestamps.size(); ++i) {
        long long interval = payload.fire.fireTimestamps[i] - payload.fire.fireTimestamps[i - 1];
        if (interval < minInterval) minInterval = interval;
    }
    return minInterval < MIN_FIRE_INTERVAL_MS;
}

// Other cheat detectors
bool detectTeleport(const PlayerState& playerState, const Payload& payload) {
    return playerState.hasTeleport || payload.isTeleportActive;
}

bool detectItemDupe(const PlayerState& playerState, const Payload& payload) {
    return playerState.hasItemDupe || payload.isItemDupeAttempt;
}

bool detectPacketForge(const PlayerState& playerState, const Payload& payload) {
    return playerState.hasPacketForge || payload.isPacketForgeAttempt;
}

bool detectMemoryTamper(const PlayerState& playerState, const Payload& payload) {
    return playerState.memoryTamper || payload.isMemoryTamperAttempt;
}

// Main anti-cheat validation function
ValidationResult validatePlayerAction(
    const PlayerState& playerState,
    const PlayerState& previousState,
    const std::string& actionType,
    const Payload& payload
) {
    if (playerState.speed > MAX_ALLOWED_SPEED || playerState.hasSpeedhack) {
        logAndBlock(playerState, "Speed Hack", "speed: " + std::to_string(playerState.speed));
        return {false, "Speed hack detected. Action blocked."};
    }

    double dist = std::sqrt(
        std::pow(playerState.position.x - previousState.position.x, 2) +
        std::pow(playerState.position.y - previousState.position.y, 2)
    );
    if (dist > MAX_ALLOWED_TELEPORT_DIST || detectTeleport(playerState, payload)) {
        logAndBlock(playerState, "Teleport/Position Tampering", "distance: " + std::to_string(dist));
        return {false, "Teleport/position tampering detected."};
    }

    if (isBlockedSource(playerState.src)) {
        logAndBlock(playerState, "Blocked Client Source", "src: " + playerState.src);
        return {false, "Blocked client source: " + playerState.src};
    }

    if (detectESPWallhack(playerState, payload)) {
        logAndBlock(playerState, "ESP/Wallhack/Injector/Overlay", "ESP/Wallhack/Injector/Overlay signals detected.");
        return {false, "ESP/Wallhack/Injector/Overlay detected."};
    }

    if (detectAimbot(playerState, previousState, payload)) {
        logAndBlock(playerState, "Aimbot Detected", "aimData");
        return {false, "Aimbot-like behavior detected."};
    }

    if (detectRapidFire(playerState, payload)) {
        logAndBlock(playerState, "Rapid Fire", "fireData");
        return {false, "Rapid fire detected."};
    }

    if (detectItemDupe(playerState, payload)) {
        logAndBlock(playerState, "Item Duplication Cheat", "item dupe detected");
        return {false, "Item duplication cheat detected."};
    }

    if (detectPacketForge(playerState, payload)) {
        logAndBlock(playerState, "Packet Forging", "packet forging detected");
        return {false, "Packet forging detected."};
    }

    if (detectMemoryTamper(playerState, payload)) {
        logAndBlock(playerState, "Memory Tampering", "memory tampering detected");
        return {false, "Memory tampering detected."};
    }

    if (isHWIDBanned(playerState.hwid)) {
        logAndBlock(playerState, "HWID Ban", "hwid: " + playerState.hwid);
        return {false, "Device banned."};
    }

    return {true, ""};
}