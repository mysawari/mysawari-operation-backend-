import express from "express";
import protect from "../middlewares/auth.middleware.js";
import { assignServiceTask, getServiceTaskById, getServiceTasks, getTeamMembers } from "../controllers/serviceTaskController.js";

const router = express.Router();

router.get("/", protect, getServiceTasks);
router.get("/team-members", protect, getTeamMembers);

router.get("/:id", protect, getServiceTaskById);
router.patch("/:id/assign", protect, assignServiceTask);

export default router;