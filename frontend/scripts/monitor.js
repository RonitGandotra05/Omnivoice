require("dotenv").config();
const fs = require("fs");
const path = require("path");
const http = require("http");
const { execSync } = require("child_process");

// Configuration
const config = {
  logDir: process.env.LOG_DIR || "./logs",
  healthEndpoint:
    process.env.HEALTH_ENDPOINT || "http://localhost:3000/api/health",
  checkInterval: process.env.CHECK_INTERVAL
    ? parseInt(process.env.CHECK_INTERVAL)
    : 60000, // 1 minute
  alertThreshold: process.env.ALERT_THRESHOLD
    ? parseInt(process.env.ALERT_THRESHOLD)
    : 3,
  maxLogSize: process.env.MAX_LOG_SIZE
    ? parseInt(process.env.MAX_LOG_SIZE)
    : 10 * 1024 * 1024, // 10MB
  statusCodes: {
    OK: "OK",
    WARNING: "WARNING",
    ERROR: "ERROR",
  },
};

// Ensure log directory exists
if (!fs.existsSync(config.logDir)) {
  fs.mkdirSync(config.logDir, { recursive: true });
}

// Log file paths
const logFiles = {
  health: path.join(config.logDir, "health.log"),
  error: path.join(config.logDir, "error.log"),
  performance: path.join(config.logDir, "performance.log"),
};

// Initialize logger
function writeLog(file, message) {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] ${message}\n`;

  try {
    // Rotate log if needed
    if (fs.existsSync(file) && fs.statSync(file).size > config.maxLogSize) {
      const backupFile = `${file}.${timestamp.replace(/[:.]/g, "-")}`;
      fs.renameSync(file, backupFile);
    }

    fs.appendFileSync(file, logMessage);
  } catch (error) {
    console.error(`Failed to write to log file ${file}:`, error);
  }
}

// Health check function
function checkHealth() {
  return new Promise((resolve) => {
    http
      .get(config.healthEndpoint, (res) => {
        let data = "";

        res.on("data", (chunk) => {
          data += chunk;
        });

        res.on("end", () => {
          if (res.statusCode === 200) {
            try {
              const result = JSON.parse(data);
              writeLog(
                logFiles.health,
                `Status: ${config.statusCodes.OK} - ${JSON.stringify(result)}`,
              );
              resolve({ status: config.statusCodes.OK, data: result });
            } catch (e) {
              writeLog(
                logFiles.health,
                `Status: ${config.statusCodes.WARNING} - Invalid response format`,
              );
              resolve({
                status: config.statusCodes.WARNING,
                error: "Invalid response format",
              });
            }
          } else {
            writeLog(
              logFiles.health,
              `Status: ${config.statusCodes.ERROR} - HTTP ${res.statusCode}`,
            );
            resolve({
              status: config.statusCodes.ERROR,
              error: `HTTP ${res.statusCode}`,
            });
          }
        });
      })
      .on("error", (error) => {
        writeLog(logFiles.error, `Health check failed: ${error.message}`);
        resolve({ status: config.statusCodes.ERROR, error: error.message });
      });
  });
}

// Check system resources
function checkSystemResources() {
  try {
    const memoryUsage = execSync("free -m | grep Mem").toString().trim();
    const diskUsage = execSync("df -h / | tail -1").toString().trim();
    const cpuUsage = execSync(
      'top -bn1 | grep "Cpu(s)" | sed "s/.*, *\\([0-9.]*\\)%* id.*/\\1/" | awk \'{print 100 - $1"%"}\'',
    )
      .toString()
      .trim();

    const perfData = {
      memory: memoryUsage,
      disk: diskUsage,
      cpu: cpuUsage,
    };

    writeLog(logFiles.performance, JSON.stringify(perfData));
    return perfData;
  } catch (error) {
    writeLog(logFiles.error, `System resource check failed: ${error.message}`);
    return { error: error.message };
  }
}

// Main monitoring function
async function monitor() {
  console.log(
    `Starting monitoring with ${config.checkInterval / 1000}s interval`,
  );
  console.log(`Logs will be stored in ${config.logDir}`);

  let consecutiveErrors = 0;

  // Initial checks
  await checkHealth();
  checkSystemResources();

  // Set up monitoring interval
  setInterval(async () => {
    const healthResult = await checkHealth();

    // Count consecutive errors for alerting
    if (healthResult.status === config.statusCodes.ERROR) {
      consecutiveErrors++;

      if (consecutiveErrors >= config.alertThreshold) {
        // This would be where you send alerts (email, SMS, etc.)
        console.error(
          `ALERT: Service has been unhealthy for ${consecutiveErrors} consecutive checks`,
        );
        writeLog(
          logFiles.error,
          `ALERT: Service has been unhealthy for ${consecutiveErrors} consecutive checks`,
        );
      }
    } else {
      consecutiveErrors = 0;
    }

    // Check system resources every 5 health checks
    if (global.checkCount % 5 === 0) {
      checkSystemResources();
    }

    global.checkCount++;
  }, config.checkInterval);
}

// Initialize global counter
global.checkCount = 1;

// Start monitoring
monitor().catch((error) => {
  console.error("Monitoring failed to start:", error);
  writeLog(logFiles.error, `Monitoring failed to start: ${error.message}`);
  process.exit(1);
});
