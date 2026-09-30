import express from "express";
import protect from "../middlewares/auth.middleware.js";
import {
  createExtensionRequest,
  getAllExtensionRequests,
  updateExtensionStatus
} from "../controllers/extendBooking.controller.js";

const router = express.Router();

router.use(protect); // secure all routes

router.post("/", createExtensionRequest);
router.get("/", getAllExtensionRequests);
router.put("/:id/status", updateExtensionStatus);

export default router;
