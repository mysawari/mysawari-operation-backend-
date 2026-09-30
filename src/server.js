import dotenv from "dotenv";
import app from "./app.js";
import connectDB from "./config/db.js";
import mongoose from "mongoose";

dotenv.config();

const PORT = process.env.PORT || 5000;

connectDB();

const server = app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

server.keepAliveTimeout = 65000;
server.headersTimeout = 66000;
server.requestTimeout = 60000;
server.maxRequestsPerSocket = 1000;

// Prevent server crash on unhandled promise rejections
process.on('unhandledRejection', (err) => {
  console.error('[unhandledRejection]', err);
});

let shuttingDown = false;


function shutdown(signal, exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${signal} received — finishing in-flight requests, then exiting.`);
  server.close(async () => {
    try { await mongoose.connection.close(false); } catch (e) { /* already closed */ }
    process.exit(exitCode);
  });
  setTimeout(() => process.exit(exitCode), 15 * 1000).unref();
}

process.on('uncaughtException', (err) => {
  console.error('[uncaughtException] 💥', err);
  shutdown('uncaughtException', 1);
});
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));