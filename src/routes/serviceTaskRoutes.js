import express from "express";

import protect from "../middlewares/auth.middleware.js";
import { getServiceTaskById, getServiceTasks } from "../controllers/serviceTaskController.js";

const router = express.Router();

router.get("/", protect, getServiceTasks);
router.get("/:id", protect, getServiceTaskById);

export default router;