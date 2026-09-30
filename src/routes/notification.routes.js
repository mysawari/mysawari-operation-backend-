import express from "express";
import {
  sendNotification,
  getNotifications,
  getCustomersForNotification
} from "../controllers/notification.controller.js";
import protect from "../middlewares/auth.middleware.js";

const router = express.Router();

router.use(protect);

router.get("/customers", getCustomersForNotification);
router.post("/send", sendNotification);
router.get("/", getNotifications);

export default router;
