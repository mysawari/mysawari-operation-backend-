import express from "express";
import protect from "../middlewares/auth.middleware.js";
import { singleImageUpload } from "../middlewares/upload.middleware.js";
import {
  getOffers,
  createOffer,
  updateOffer,
  deleteOffer,
} from "../controllers/offer.controller.js";

const router = express.Router();

// Public route for fetching offers (so unauthenticated users can see them)
router.get("/", getOffers);

// Protect all following routes (admin only)
router.use(protect);

router.post("/", singleImageUpload, createOffer);

router.route("/:id")
  .put(singleImageUpload, updateOffer)
  .delete(deleteOffer);

export default router;
