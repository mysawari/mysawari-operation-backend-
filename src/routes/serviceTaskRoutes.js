import express from "express";
import protect from "../middlewares/auth.middleware.js";
import {
  addHandoverPayment,
  addHandoverRefund,
  assignServiceTask,
  cancelServiceTask,
  completeServiceTask,
  getHandoverBill,
  getServiceTaskById,
  getServiceTasks,
  getTasksForBookings,
  getTeamMembers,
  reachServiceTask,
  saveDropTask,
  startServiceTask,
  updateDropCharge,
} from "../controllers/serviceTaskController.js";

const router = express.Router();

// Fixed paths FIRST, so they are not treated as an :id
router.get("/", protect, getServiceTasks);
router.get("/team-members", protect, getTeamMembers);
router.get("/by-bookings", protect, getTasksForBookings); // Receive Desk

// Team leader: Add / Edit Drop (Receive Desk popup) — also sets drop price
router.post("/drop-task", protect, saveDropTask);

// NEW — Bill & payments on a handover
router.get("/handover/:handoverId/bill", protect, getHandoverBill); // leader / driver
router.patch("/handover/:handoverId/drop-charge", protect, updateDropCharge); // leader
router.post("/handover/:handoverId/payment", protect, addHandoverPayment); // leader / driver
router.post("/handover/:handoverId/refund", protect, addHandoverRefund); // leader

router.get("/:id", protect, getServiceTaskById);

// Team leader
router.patch("/:id/assign", protect, assignServiceTask);

// Assigned member: Start → Reached → Complete
router.patch("/:id/start", protect, startServiceTask);
router.patch("/:id/reach", protect, reachServiceTask);
router.patch("/:id/complete", protect, completeServiceTask);

// Driver (own task) or team leader — a cancelled drop removes its price
router.patch("/:id/cancel", protect, cancelServiceTask);

export default router;