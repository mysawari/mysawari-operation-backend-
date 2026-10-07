import express from "express";
import protect from "../middlewares/auth.middleware.js";
import {
  assignServiceTask,
  cancelServiceTask,
  completeServiceTask,
  getServiceTaskById,
  getServiceTasks,
  getTasksForBookings,
  getTeamMembers,
  reachServiceTask,
  saveDropTask,
  startServiceTask,
} from "../controllers/serviceTaskController.js";

const router = express.Router();

// Fixed paths FIRST, so they are not treated as an :id
router.get("/", protect, getServiceTasks);
router.get("/team-members", protect, getTeamMembers);
router.get("/by-bookings", protect, getTasksForBookings); // Receive Desk

// Team leader: Add / Edit Drop (Receive Desk popup)
router.post("/drop-task", protect, saveDropTask);

router.get("/:id", protect, getServiceTaskById);

// Team leader
router.patch("/:id/assign", protect, assignServiceTask);

// Assigned member: Start → Reached → Complete
router.patch("/:id/start", protect, startServiceTask);
router.patch("/:id/reach", protect, reachServiceTask);
router.patch("/:id/complete", protect, completeServiceTask);

// Driver (own task) or team leader
router.patch("/:id/cancel", protect, cancelServiceTask);

export default router;